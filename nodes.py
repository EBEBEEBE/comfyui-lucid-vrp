"""M1 backend-only Anima VRP proof node."""

from __future__ import annotations

import base64
from io import BytesIO
import logging
import numpy as np
import torch
from PIL import Image

from .anima_regional import RegionConditioning, WRAPPER_KEY, install_m1_patch
from .anima_regional import _validate_anima_model, _masks_to_token_masks
from .region_state import parse_state, serialize_state
from .user_config import CONFIG, frontend_config
from .geometry import bbox_to_mask
from .canvas import validate_descriptor
from .advanced_settings import (
    ADVANCED_SETTINGS_TYPE,
    BASE_MODES,
    DEFAULT_ADVANCED_SETTINGS,
    PRESETS,
    make_advanced_settings,
    settings_for_preset,
    validate_advanced_settings,
)
from .region_authoring import (
    AUTHORING_MODES,
    DEFAULT_AUTHORING_STATE,
    load_mask_image,
    parse_authoring_state,
)
from .region_pipeline import (
    REGION_TYPE,
    REGIONS_TYPE,
    append_region,
    canvas_metadata,
    check_canvas_compatibility,
    make_region,
    mask_to_anima_spatial,
    merge_regions,
    validate_regions,
)


logger = logging.getLogger(__name__)


def _preview_provenance(extra_pnginfo, unique_id):
    """Echo only this node's queued frontend snapshot, never receipt-time state."""
    if not isinstance(extra_pnginfo, dict):
        return {}
    workflow = extra_pnginfo.get('workflow', {})
    if not isinstance(workflow, dict):
        return {}
    extra = workflow.get('extra', {})
    records = extra.get('anima_vrp_preview', {}) if isinstance(extra, dict) else {}
    value = records.get(str(unique_id), {}) if isinstance(records, dict) else {}
    return value if isinstance(value, dict) else {}


def _encode(clip, text: str):
    tokens = clip.tokenize(text)
    return clip.encode_from_tokens_scheduled(tokens)


def _rectangular_mask(height: int, width: int, x0: float, x1: float) -> torch.Tensor:
    if height < 1 or width < 2:
        raise RuntimeError("M1 requires a non-empty latent with width >= 2.")
    mask = torch.zeros((1, height, width), dtype=torch.float32)
    left = max(0, min(width, int(width * x0)))
    right = max(left + 1, min(width, int(width * x1)))
    mask[:, :, left:right] = 1.0
    return mask


class AnimaVRPM1Proof:
    """Fixed two-region Anima regional-conditioning proof.

    This intentionally has no frontend editor or serialized region state.
    It creates two fixed side-by-side bbox masks and passes its outputs to a
    normal external KSampler.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "latent_image": ("LATENT",),
                "global_prompt": (
                    "STRING",
                    {
                        "default": "two characters in a shared scene, balanced composition, coherent background",
                        "multiline": True,
                    },
                ),
                "negative_prompt": (
                    "STRING",
                    {
                        "default": "worst quality, blurry, malformed anatomy, extra limbs",
                        "multiline": True,
                    },
                ),
                "region_1_prompt": (
                    "STRING",
                    {
                        "default": "character one, a woman, detailed outfit, distinct identity",
                        "multiline": True,
                    },
                ),
                "region_2_prompt": (
                    "STRING",
                    {
                        "default": "character two, a man, detailed outfit, distinct identity",
                        "multiline": True,
                    },
                ),
            }
        }

    RETURN_TYPES = ("MODEL", "CONDITIONING", "CONDITIONING", "LATENT")
    RETURN_NAMES = ("patched_model", "positive", "negative", "latent_image")
    FUNCTION = "execute"
    CATEGORY = "Anima VRP"

    def execute(
        self,
        model,
        clip,
        latent_image,
        global_prompt,
        negative_prompt,
        region_1_prompt,
        region_2_prompt,
    ):
        if not isinstance(latent_image, dict) or not torch.is_tensor(latent_image.get("samples")):
            raise RuntimeError("M1 expects a standard ComfyUI LATENT input.")
        samples = latent_image["samples"]
        if samples.ndim not in (4, 5):
            raise RuntimeError("M1 expects LATENT samples shaped [B,C,H,W] or [B,C,T,H,W].")

        latent_height = int(samples.shape[-2])
        latent_width = int(samples.shape[-1])
        masks = [
            _rectangular_mask(latent_height, latent_width, 0.05, 0.48),
            _rectangular_mask(latent_height, latent_width, 0.52, 0.95),
        ]

        positive = _encode(clip, global_prompt)
        negative = _encode(clip, negative_prompt)
        region_conditionings = [
            RegionConditioning(masks[0], _encode(clip, region_1_prompt)),
            RegionConditioning(masks[1], _encode(clip, region_2_prompt)),
        ]
        patched_model = install_m1_patch(model, region_conditionings)
        return patched_model, positive, negative, latent_image


DEFAULT_STATE = serialize_state({
    'version': 2, 'canvas': {'width': 1024, 'height': 1024}, 'regions': CONFIG['default_regions'],
})


def _internal_canonical_regions(state, canvas, expected_mask_shape):
    """Compile M4 normalized bboxes into the M4.5 canonical region contract."""
    metadata = canvas_metadata(canvas)
    regions = []
    for region in state['regions']:
        mask = bbox_to_mask(region, *expected_mask_shape)
        regions.append(make_region(
            region_id=region['id'],
            label=region['label'],
            mask=mask,
            positive_prompt=region['prompt'],
            negative_prompt=region['negative_prompt'],
            weight=region['weight'],
            canvas=metadata,
            source={'type': 'bbox', 'geometry': 'axis_aligned', 'owner': 'AnimaVRP'},
        ))
    return regions


def _active_conditioning_regions(canonical_regions, expected_mask_shape, dit):
    active = []
    for region in canonical_regions:
        if region['weight'] == 0:
            continue
        if not region['mask'].any() and region['source'].get('type') != 'bbox':
            raise ValueError(f"Region {region['label']!r} has an empty mask; draw a region mask or bypass its Region node")
        tokens = _masks_to_token_masks(
            [region['mask']], *expected_mask_shape, dit.patch_spatial, 1
        )
        if not tokens.any():
            raise ValueError(
                f"Region {region['label']!r} is too small at this resolution; enlarge its mask to cover an Anima token"
            )
        active.append(region)
    return active


def _external_region_preview(regions, canvas):
    """Serialize canonical external masks for the classic-node read-only view."""
    metadata = canvas_metadata(canvas)
    rendered = []
    for region in regions:
        mask = region['mask'][0].detach().float().cpu().numpy()
        alpha = np.rint(np.clip(mask, 0.0, 1.0) * 255.0).astype(np.uint8)
        rgba = np.full((*alpha.shape, 4), 255, dtype=np.uint8)
        rgba[:, :, 3] = alpha
        stream = BytesIO()
        Image.fromarray(rgba, mode='RGBA').save(stream, format='PNG', optimize=True)
        ys, xs = np.nonzero(alpha)
        bounds = None
        if len(xs):
            bounds = {
                'x': float(xs.min()) / alpha.shape[1],
                'y': float(ys.min()) / alpha.shape[0],
                'width': float(xs.max() + 1 - xs.min()) / alpha.shape[1],
                'height': float(ys.max() + 1 - ys.min()) / alpha.shape[0],
            }
        rendered.append({
            'region_id': region['region_id'],
            'label': region['label'],
            'mask_png': base64.b64encode(stream.getvalue()).decode('ascii'),
            'bounds': bounds,
            'source': dict(region['source']),
            'weight': region['weight'],
        })
    return {
        'version': 1,
        'canvas': metadata,
        'regions': rendered,
    }


class VRPAdvancedSettings:
    """Expert-only structured settings for Anima regional routing."""

    @classmethod
    def INPUT_TYPES(cls):
        defaults = DEFAULT_ADVANCED_SETTINGS
        return {"required": {
            "preset": (list(PRESETS), {"default": "VRP Recommended", "vrp_presets": {
                name: settings_for_preset(name) for name in PRESETS if name != "Custom"
            }}),
            "base_mode": (list(BASE_MODES), {"default": defaults["base_mode"]}),
            "base_strength": ("FLOAT", {"default": defaults["base_strength"], "min": 0.0, "max": 10.0, "step": 0.01}),
            "start_percent": ("FLOAT", {"default": defaults["start_percent"], "min": 0.0, "max": 1.0, "step": 0.001}),
            "end_percent": ("FLOAT", {"default": defaults["end_percent"], "min": 0.0, "max": 1.0, "step": 0.001}),
            "cross_mask_strength": ("FLOAT", {"default": defaults["cross_mask_strength"], "min": 0.0, "max": 1.0, "step": 0.01}),
            "self_mask_strength": ("FLOAT", {"default": defaults["self_mask_strength"], "min": 0.0, "max": 1.0, "step": 0.01}),
            "base_ratio": ("FLOAT", {"default": defaults["base_ratio"], "min": 0.0, "max": 1.0, "step": 0.01}),
            "cross_inject_every": ("INT", {"default": defaults["cross_inject_every"], "min": 1, "max": 100, "step": 1}),
            "self_inject_every": ("INT", {"default": defaults["self_inject_every"], "min": 1, "max": 100, "step": 1}),
        }}

    RETURN_TYPES = (ADVANCED_SETTINGS_TYPE,)
    RETURN_NAMES = ("settings",)
    FUNCTION = "build"
    CATEGORY = "LuCiD VRP"

    def build(
        self,
        preset,
        base_mode,
        base_strength,
        start_percent,
        end_percent,
        cross_mask_strength,
        self_mask_strength,
        base_ratio,
        cross_inject_every,
        self_inject_every,
    ):
        return (make_advanced_settings(
            preset,
            base_mode,
            base_strength,
            start_percent,
            end_percent,
            cross_mask_strength,
            self_mask_strength,
            base_ratio,
            cross_inject_every,
            self_inject_every,
        ),)


class AnimaVRP:
    """Anima regional node with legacy bbox migration and canonical regions."""

    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {
            'model': ('MODEL',), 'clip': ('CLIP',), 'latent_image': ('LATENT',),
            'vrp_state': ('STRING', {'default': DEFAULT_STATE, 'multiline': True, 'vrp_config': frontend_config()}),
            'prompt_mix': ('BOOLEAN', {'default': True}),
        }, 'optional': {
            'canvas': ('VRP_CANVAS',),
            'regions': (REGIONS_TYPE,),
            'global_positive': ('STRING', {'forceInput': True, 'multiline': True}),
            'global_negative': ('STRING', {'forceInput': True, 'multiline': True}),
            'advanced_settings': (ADVANCED_SETTINGS_TYPE,),
        }, 'hidden': {'extra_pnginfo': 'EXTRA_PNGINFO', 'unique_id': 'UNIQUE_ID'}}

    RETURN_TYPES = ('MODEL', 'CONDITIONING', 'CONDITIONING', 'LATENT', 'STRING', 'STRING')
    RETURN_NAMES = ('patched_model', 'positive', 'negative', 'latent_image', 'combined_prompt', 'global_prompt_passthrough')
    FUNCTION = 'execute'
    CATEGORY = 'LuCiD VRP'

    @classmethod
    def VALIDATE_INPUTS(cls, vrp_state):
        try:
            parse_state(vrp_state)
        except ValueError as exc:
            return str(exc)
        return True

    def execute(
        self,
        model,
        clip,
        latent_image,
        vrp_state,
        canvas=None,
        advanced_settings=None,
        regions=None,
        global_positive=None,
        global_negative=None,
        prompt_mix=True,
        extra_pnginfo=None,
        unique_id=None,
    ):
        state = parse_state(vrp_state)
        if canvas is not None:
            dimensions = validate_descriptor(canvas)
            if dimensions != (state['canvas']['width'], state['canvas']['height']):
                raise ValueError('Canvas Builder dimensions disagree with VRP state; update its canvas snapshot')
        dit = _validate_anima_model(model)
        if not isinstance(latent_image, dict):
            raise ValueError('Expected a ComfyUI LATENT')
        samples = latent_image.get('samples')
        if not torch.is_tensor(samples) or samples.ndim not in (4, 5):
            raise ValueError('LATENT must have [B,C,H,W] or [B,C,1,H,W] samples')
        if min(samples.shape) < 1 or (samples.ndim == 5 and samples.shape[2] != 1):
            raise ValueError('M2 supports nonempty image latents only')
        if 'noise_mask' in latent_image:
            raise ValueError('Masked/inpainting latents are outside M2 scope')
        # Current Anima uses Wan21: spatial downscale 8. EmptyLatentImage also uses 8.
        expected = (state['canvas']['height'] // 8, state['canvas']['width'] // 8)
        if tuple(samples.shape[-2:]) != expected:
            raise ValueError(f'Canvas/latent mismatch: expected H,W={expected}, got {tuple(samples.shape[-2:])}')
        if latent_image.get('downscale_ratio_spacial', 8) != 8:
            raise ValueError('M2 requires Anima spatial downscale 8')
        current_canvas = canvas if canvas is not None else {
            'version': 1,
            'width': state['canvas']['width'],
            'height': state['canvas']['height'],
            'revision': 0,
        }
        expected = (state['canvas']['height'] // 8, state['canvas']['width'] // 8)
        if regions is not None:
            if canvas is None:
                raise ValueError(
                    'External VRP_REGIONS require a connected VRP_CANVAS for canvas/revision validation'
                )
            external = validate_regions(regions, expected)
            check_canvas_compatibility(external['regions'], canvas, expected)
        else:
            external = None
        effective_settings = validate_advanced_settings(
            advanced_settings if advanced_settings is not None else DEFAULT_ADVANCED_SETTINGS
        )
        source = 'VRP Advanced Settings' if advanced_settings is not None else 'internal defaults'
        logger.debug(
            "VRP effective regional settings:\n"
            "  source: %s\n"
            "  base_mode: %s\n"
            "  base_strength: %s\n"
            "  start_percent: %s\n"
            "  end_percent: %s\n"
            "  cross_mask_strength: %s\n"
            "  self_mask_strength: %s\n"
            "  base_ratio: %s\n"
            "  cross_inject_every: %s\n"
            "  self_inject_every: %s",
            source,
            effective_settings['base_mode'],
            effective_settings['base_strength'],
            effective_settings['start_percent'],
            effective_settings['end_percent'],
            effective_settings['cross_mask_strength'],
            effective_settings['self_mask_strength'],
            effective_settings['base_ratio'],
            effective_settings['cross_inject_every'],
            effective_settings['self_inject_every'],
        )
        canonical = merge_regions(
            _internal_canonical_regions(state, current_canvas, expected),
            external,
        )
        active = _active_conditioning_regions(canonical, expected, dit)
        global_text = '' if global_positive is None else str(global_positive)
        combined = '\n'.join(text for text in [global_text, *(r['positive_prompt'] for r in active)] if text.strip())
        processed = combined if prompt_mix else global_text
        positive = _encode(clip, processed)
        negative = _encode(clip, '' if global_negative is None else str(global_negative))
        regions = []
        for region in active:
            conditioning = _encode(clip, region['positive_prompt'])
            if len(conditioning) != 1:
                raise ValueError('Scheduled regional conditioning is not supported in M2')
            regional_negative = None
            if region['negative_prompt']:
                regional_negative = _encode(clip, region['negative_prompt'])
                if len(regional_negative) != 1:
                    raise ValueError('Scheduled regional negative conditioning is not supported in M4.4')
            regions.append(RegionConditioning(
                region['mask'],
                conditioning,
                region['weight'],
                regional_negative,
            ))
        patched = install_m1_patch(
            model,
            regions,
            expected_latent_shape=expected,
            advanced_settings=effective_settings,
        )
        # Keep the effective canonical roster attached as metadata for
        # inspection. Routing continues to consume the same RegionConditioning
        # objects as before; the wrapper never reads this view-only field.
        patch = patched.model_options.get('transformer_options', {}).get(WRAPPER_KEY)
        if patch is not None:
            patch.region_roster = canonical
        result = (patched, positive, negative, latent_image, combined, processed)
        ui = {'vrp_preview_provenance': [_preview_provenance(extra_pnginfo, unique_id)],
              'vrp_prompt_status': [{'global_positive_empty': not bool(global_text.strip()),
                                    'active_regions': len(active)}]}
        if external is not None:
            preview_regions = [
                region for region in canonical
                if region['source'].get('owner') != 'AnimaVRP'
            ]
            preview = _external_region_preview(preview_regions, current_canvas)
            ui['vrp_region_preview'] = [preview]
        return {'ui': ui, 'result': result}


class VRPRegion:
    """Canvas-bound authored/external region node with a linear pass-through."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            'required': {
                'canvas': ("VRP_CANVAS",),
                'region_id': ("STRING", {'default': 'region-1'}),
                'label': ("STRING", {'default': 'Region'}),
                'positive_prompt': ("STRING", {'default': '', 'multiline': True}),
                'negative_prompt': ("STRING", {'default': '', 'multiline': True}),
                'weight': ("FLOAT", {'default': 1.0, 'min': 0.0, 'max': 1.0, 'step': 0.01}),
                'authoring_mode': (list(AUTHORING_MODES),),
                'authoring_state': ("STRING", {'default': DEFAULT_AUTHORING_STATE, 'vrp_config': frontend_config()}),
                # Keep the legacy positional value for saved M4.7 workflows,
                # but do not name it `image`: current ComfyUI frontends keep
                # that special Mask Editor widget in a separate value store,
                # which overrides the temporary node.images source.
                'legacy_editor_image': ("STRING", {'default': ''}),
            },
            'optional': {
                'previous_regions': (REGIONS_TYPE,),
                'external_mask': ("MASK",),
            },
            'hidden': {'extra_pnginfo': 'EXTRA_PNGINFO', 'unique_id': 'UNIQUE_ID'},
        }

    RETURN_TYPES = ("VRP_CANVAS", REGIONS_TYPE)
    RETURN_NAMES = ('canvas', 'regions')
    FUNCTION = 'execute'
    CATEGORY = 'LuCiD VRP'

    def execute(self, **inputs):
        provenance = _preview_provenance(inputs.pop('extra_pnginfo', None), inputs.pop('unique_id', None))
        # Public socket name is explicit; canonical mask resolution is unchanged.
        if 'external_mask' in inputs:
            inputs['mask'] = inputs.pop('external_mask')
        bundle, canvas = self.build(**inputs)
        return {'ui': {'vrp_preview_provenance': [provenance],
                       'vrp_region_preview': [_external_region_preview(bundle['regions'][-1:], canvas)]},
                'result': (canvas, bundle)}

    def build(
        self,
        canvas,
        mask=None,
        region_id='region-1',
        label='Region',
        positive_prompt='',
        negative_prompt='',
        weight=1.0,
        previous_regions=None,
        # Direct legacy Python callers that still pass only a MASK retain the
        # former behavior. Newly created UI nodes explicitly serialize BBox.
        authoring_mode='External MASK',
        authoring_state=DEFAULT_AUTHORING_STATE,
        legacy_editor_image='',
        # Accept old API-format workflows which still send the former widget.
        image='',
    ):
        validate_descriptor(canvas)
        metadata = canvas_metadata(canvas)
        expected = (metadata['height'] // 8, metadata['width'] // 8)
        if previous_regions is not None:
            prior = validate_regions(previous_regions, expected)
            check_canvas_compatibility(prior['regions'], canvas, expected)
        else:
            prior = None
        if authoring_mode not in AUTHORING_MODES:
            raise ValueError(f"Unknown VRP Region authoring mode {authoring_mode!r}")
        authored = parse_authoring_state(authoring_state)
        unauthored = (
            (authoring_mode == 'BBox' and authored['bbox'] is None)
            or (authoring_mode == 'Painted Mask' and not authored['painted_mask']['image_ref'])
            or (authoring_mode == 'External MASK' and mask is None)
        )
        if weight == 0 and unauthored:
            resolved_mask = torch.zeros((1, *expected), dtype=torch.float32)
            source = {'type': 'bbox' if authoring_mode == 'BBox' else 'mask',
                      'geometry': {'BBox':'bbox', 'Painted Mask':'painted', 'External MASK':'external'}[authoring_mode],
                      'owner': 'VRPRegion'}
        elif authoring_mode == 'BBox':
            bbox = authored['bbox']
            if bbox is None:
                raise ValueError(f"Region {label!r} needs a bbox; draw one in its preview or bypass the node")
            resolved_mask = bbox_to_mask(bbox, expected[0], expected[1])
            source = {'type': 'bbox', 'geometry': 'bbox', 'owner': 'VRPRegion'}
        elif authoring_mode == 'Painted Mask':
            # ``authoring_state.painted_mask.image_ref`` is the last
            # user-saved mask. ``image`` is only the temporary combined raster
            # used to initialize Mask Editor; using it here would accumulate
            # resampling when edit is opened repeatedly without saving.
            mask_ref = authored['painted_mask']['image_ref']
            if not mask_ref:
                raise ValueError(f"Region {label!r} needs a painted mask; press Edit region mask and save, or bypass the node")
            views = (dict(saved_view=authored['painted_mask']['view'], active_view=canvas['alignment'])
                     if 'view' in authored['painted_mask'] and 'alignment' in canvas else {})
            full_mask, authored_size = load_mask_image(mask_ref, metadata['width'], metadata['height'], **views)
            resolved_mask = mask_to_anima_spatial(full_mask, metadata)
            source = {
                'type': 'mask', 'geometry': 'painted', 'owner': 'VRPRegion',
                'authored_width': int(authored_size[0]), 'authored_height': int(authored_size[1]),
            }
        else:
            if mask is None:
                raise ValueError(f'Region {label!r}: External MASK mode requires a connected MASK input')
            resolved_mask = mask_to_anima_spatial(mask, metadata)
            source = {'type': 'mask', 'geometry': 'external', 'owner': 'VRPRegion'}
        region = make_region(
            region_id=region_id,
            label=label,
            mask=resolved_mask,
            positive_prompt=positive_prompt,
            negative_prompt=negative_prompt,
            weight=weight,
            canvas=metadata,
            source=source,
        )
        return append_region(prior, region, expected), canvas


# Public registrations are assembled centrally in __init__.py from user config.
