"""Experimental MOSS layout compiler with optional native-style CLIP encoding.

Uses the existing version-2 VRP bbox state and version-1 region chain. Import
this as a package module; see experiments/moss_bbox/README.md for usage.
"""
from __future__ import annotations

import json
import math

import torch

from .region_pipeline import canvas_metadata, check_canvas_compatibility, validate_regions
from .region_state import parse_state
from .prompt_combine import join_prompts


NODE_ID = 'MOSSVisualRegionalPromptExperimental'
DEFAULT_STATE = '{"version":2,"canvas":{"width":1024,"height":1024},"regions":[]}'


def _threshold(value):
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value < 1:
        raise ValueError('Mask threshold must be finite and between 0 (inclusive) and 1 (exclusive)')
    return float(value)


def mask_bbox(mask, canvas, threshold=0.5):
    """One enclosing normalized box; disconnected islands remain one item.

    Coverage is strictly greater than threshold. The upper bounds include the
    last occupied pixel. Accept only full-canvas or existing VRP 1/8-grid masks.
    Caller supplies a region-normalized [1,H,W] finite tensor.
    """
    threshold = _threshold(threshold)
    height, width = mask.shape[-2:]
    full = (canvas['height'], canvas['width'])
    if (height, width) not in (full, (full[0] // 8, full[1] // 8)):
        raise ValueError(f'Region mask dimensions {(height, width)} do not match canvas {full} or VRP 1/8 grid')
    coverage = mask[0] > threshold
    # Axis reductions avoid constructing a potentially full-canvas Nx2 index array.
    ys = torch.where(coverage.any(dim=1))[0]
    xs = torch.where(coverage.any(dim=0))[0]
    if not len(xs) or not len(ys):
        raise ValueError('Mask has no coverage above threshold; lower threshold or paint a region')
    x0, x1 = int(xs[0]), int(xs[-1]) + 1
    y0, y1 = int(ys[0]), int(ys[-1]) + 1
    return dict(x=x0 / width, y=y0 / height, width=(x1 - x0) / width, height=(y1 - y0) / height)


def moss_bbox(box, width, height):
    """Normalized xywh -> integer, center-origin yxyx, enclosing pixel edges."""
    x0 = max(0, min(width - 1, math.floor(box['x'] * width + 1e-9)))
    y0 = max(0, min(height - 1, math.floor(box['y'] * height + 1e-9)))
    x1 = max(x0 + 1, min(width, math.ceil((box['x'] + box['width']) * width - 1e-9)))
    y1 = max(y0 + 1, min(height, math.ceil((box['y'] + box['height']) * height - 1e-9)))
    return [y0 - height // 2, x0 - width // 2, y1 - height // 2, x1 - width // 2]


def compile_layout(canvas, vrp_state=DEFAULT_STATE, regions=None, global_positive='', mask_threshold=0.5):
    """Return (layout, warnings, preview); never mutate caller bundles/tensors.

    Internal boxes precede the external chain, preserving both input orders.
    VRP labels are editor names; MOSS item.label is the semantic type "object".
    Regional negatives and fractional weights are reported, never invented as
    undocumented layout fields. Weight zero disables the item.
    """
    current = canvas_metadata(canvas)
    width, height = current['width'], current['height']
    if width % 16 or height % 16:
        raise ValueError('MOSS requires canvas width and height to be multiples of 16; resize the Canvas')
    threshold = _threshold(mask_threshold)
    if not isinstance(global_positive, str):
        raise ValueError('Global scene prompt must be a string')
    state = parse_state(vrp_state)
    # validate_regions normalizes dictionary fields in place; use fresh records.
    external = []
    if regions is not None:
        if not isinstance(regions, dict) or not isinstance(regions.get('regions'), list):
            raise ValueError('Expected a VRP_REGIONS bundle')
        copied = dict(regions, regions=[dict(item) if isinstance(item, dict) else item for item in regions['regions']])
        external = validate_regions(copied)['regions']
        check_canvas_compatibility(external, current)
    used = set()
    for identity in [r['id'] for r in state['regions']] + [r['region_id'] for r in external]:
        if identity in used:
            raise ValueError(f'Duplicate effective region ID {identity!r}; rename one region')
        used.add(identity)
    warnings, items, preview = [], [], []

    def append(identity, label, prompt, negative, weight, bounds, source):
        if negative.strip():
            warnings.append(f'{label}: regional negative prompt is not represented in MOSS layout JSON.')
        if weight != 1:
            warnings.append(f'{label}: weight {weight:g} exports as enabled; MOSS layout has no regional strength field.')
        if not prompt.strip():
            warnings.append(f'{label}: empty positive prompt; item omitted.')
            return
        items.append({'label': 'object', 'caption': prompt, 'bbox': moss_bbox(bounds, width, height)})
        preview.append({'region_id': identity, 'label': label, 'bounds': bounds, 'source': source})

    for region in state['regions']:
        if region['weight'] == 0:
            continue
        append(region['id'], region['label'], region['prompt'], region['negative_prompt'], region['weight'],
               {key: region[key] for key in ('x', 'y', 'width', 'height')}, 'internal')
    for region in external:
        if region['weight'] == 0:
            continue
        try:
            bounds = mask_bbox(region['mask'], current, threshold)
        except ValueError as exc:
            raise ValueError(f"Region {region['label']!r}: {exc}") from exc
        append(region['region_id'], region['label'], region['positive_prompt'], region['negative_prompt'],
               region['weight'], bounds, 'chain')
    if external:
        warnings.append('Incoming regions use enclosing mask bounds; existing 1/8-grid masks cannot recover original bbox precision or lost thin features.')
    layout = {
        'summary': {'meta': [], 'canvas': 'single', 'caption': global_positive},
        'items': items, 'bbox_coord_space': 'abs_centralized', 'bbox_format': 'yxyx',
    }
    if not global_positive.strip() and not items:
        warnings.append('No positive text: add a scene description or an enabled region caption.')
    return layout, warnings, {'canvas': current, 'regions': preview}


class MOSSVisualRegionalPrompt:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {
            'canvas': ('VRP_CANVAS',),
            'vrp_state': ('STRING', {'default': DEFAULT_STATE, 'multiline': True}),
            'mask_threshold': ('FLOAT', {'default': 0.5, 'min': 0.0, 'max': 0.99, 'step': 0.01}),
        }, 'optional': {
            'regions': ('VRP_REGIONS',),
            'global_positive': ('STRING', {'forceInput': True, 'multiline': True}),
            'negative_prompt': ('STRING', {'forceInput': True, 'multiline': True,
                                          'tooltip': 'Optional negative text input; overrides the local field, including an empty string.'}),
            'clip': ('CLIP',),
            'global_negative': ('STRING', {'default': '', 'multiline': True, 'dynamicPrompts': False,
                                           'tooltip': 'Local negative text. A connected negative_prompt input takes precedence.'}),
        }, 'hidden': {'extra_pnginfo': 'EXTRA_PNGINFO', 'unique_id': 'UNIQUE_ID'}}

    # JSON remains first. The frontend migrates retired report-port links by name.
    RETURN_TYPES = ('STRING', 'STRING', 'CONDITIONING', 'CONDITIONING')
    RETURN_NAMES = ('moss_prompt_json', 'combined_prompt', 'positive', 'negative')
    FUNCTION = 'execute'
    CATEGORY = 'LuCiD VRP'
    DESCRIPTION = ('Experimental MOSS layout JSON using VRP bbox authoring and region chains. '
                   'Connect optional CLIP to encode JSON positive and global negative conditioning, or use JSON/text outputs alone. '
                   'Combined prompt joins scene and active item captions for a separate refiner encoder. '
                   'Match generation dimensions to Canvas. Masks become enclosing boxes; no model patching or regional negative conditioning.')

    def execute(self, canvas, vrp_state=DEFAULT_STATE, mask_threshold=0.5, regions=None,
                global_positive='', extra_pnginfo=None, unique_id=None, clip=None, global_negative='', negative_prompt=None):
        # Native descriptor/alignment checks remain authoritative at execution.
        from .canvas import validate_descriptor
        validate_descriptor(canvas)
        layout, warnings, preview = compile_layout(canvas, vrp_state, regions, global_positive, mask_threshold)
        if not isinstance(global_negative, str):
            raise ValueError('Global negative prompt must be a string')
        negative_text = global_negative if negative_prompt is None else negative_prompt
        if not isinstance(negative_text, str):
            raise ValueError('negative_prompt must be a string')
        prompt_json = json.dumps(layout, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
        combined = join_prompts([global_positive, *(item['caption'] for item in layout['items'])])
        if clip is not None:
            # Match native CLIPTextEncode, retaining upstream CLIP patches and
            # scheduled conditioning. Do not encode combined text as MOSS JSON.
            positive = clip.encode_from_tokens_scheduled(clip.tokenize(prompt_json))
            negative = clip.encode_from_tokens_scheduled(clip.tokenize(negative_text))
        else:
            from comfy_execution.graph_utils import ExecutionBlocker
            # JSON/plain-text consumers remain executable without a model. Only
            # downstream consumers of these disconnected-CLIP outputs are skipped.
            positive, negative = ExecutionBlocker(None), ExecutionBlocker(None)
            warnings.append('CLIP is disconnected: text outputs are ready; connect CLIP to use positive/negative conditioning.')
        extra = (extra_pnginfo or {}).get('workflow', {}).get('extra', {})
        provenance = extra.get('anima_vrp_preview', {}).get(str(unique_id), {})
        report = '\n'.join(warnings) if warnings else 'Layout ready.'
        return {'ui': {'moss_layout_preview': [preview], 'moss_conversion_report': [report],
                       'vrp_preview_provenance': [provenance]},
                'result': (prompt_json, combined, positive, negative)}
