"""Shared image document/history validation; no regional-canvas dependencies."""
from copy import deepcopy
import hashlib
import json

import folder_paths
import numpy as np
from PIL import Image, ImageOps
import torch

from .user_config import CONFIG, frontend_config, minimum_step
from .image_alignment import align_image, view_metadata, METHODS
from .canvas_raster_document import validate_canvas_document

PRESETS = {name: tuple(size) for name, size in CONFIG['canvas_presets'].items()}

MP_PRESETS = {
    '1MP @ 2:3 - 0.67': (2, 3, 1),
    '1.5MP @ 3:4 - 0.75': (3, 4, 1.5),
    '1.5MP @ 16:9 - 1.78': (16, 9, 1.5),
    '2MP @ 21:9 - 2.33': (21, 9, 2),
}
DEFAULT_DOCUMENT = json.dumps({
    'version': 1, 'revision': 0,
    'active': {'id': 'initial', 'width': 1024, 'height': 1024, 'origin': 'blank',
               'image_ref': None, 'editor_ref': None, 'layers': None},
    'history': [], 'redo': [], 'alignment_revision': 0, 'retained': {'blank': None, 'imported': None},
}, separators=(',', ':'))


def validate_document(document, active=True):
    fields = {'id', 'width', 'height', 'origin', 'image_ref', 'editor_ref', 'layers'}
    if not isinstance(document, dict) or not fields <= set(document) <= fields | {'canvas_document'}:
        raise ValueError('Invalid canvas document fields')
    if not isinstance(document['id'], str) or not document['id']:
        raise ValueError('Canvas document requires a stable ID')
    if any(type(document[key]) is not int or document[key] < 1 for key in ('width', 'height')):
        raise ValueError('Document dimensions must be positive integers')
    if document['origin'] not in ('blank', 'imported'):
        raise ValueError('Invalid canvas document origin')
    for field in ('image_ref', 'editor_ref'):
        if document[field] is not None and (not isinstance(document[field], str) or not document[field].strip()):
            raise ValueError(f'Invalid document {field}')
    if document['image_ref'] is None and (document['origin'] != 'blank' or document['editor_ref'] is not None):
        raise ValueError('Only an unedited blank document may have no image reference')
    layers = document['layers']
    if layers is not None:
        if not isinstance(layers, dict) or set(layers) != {'base_ref', 'paint_ref'}:
            raise ValueError('Invalid canvas layer manifest')
        if not document['editor_ref'] or not document['image_ref']:
            raise ValueError('Layered documents require editor and composite references')
        if any(not isinstance(ref, str) or not ref.strip() for ref in layers.values()):
            raise ValueError('Invalid canvas layer references')
    elif 'canvas_document' not in document and document['editor_ref'] not in (None, document['image_ref']):
        raise ValueError('Flat canvas documents must use the same image/editor reference')
    if 'canvas_document' in document:
        if layers is not None or not document['image_ref'] or not document['editor_ref']:
            raise ValueError('Editable canvas requires committed RGB/MASK references and its own layer manifest')
        validate_canvas_document(document['canvas_document'], document)
    return document


def parse_document_state(value):
    try:
        state = json.loads(value) if isinstance(value, str) else deepcopy(value)
    except (ValueError, TypeError) as exc:
        raise ValueError('Invalid canvas document JSON') from exc
    fields = {'version', 'revision', 'active', 'history', 'retained'}
    optional = {'redo', 'alignment_revision'}
    if not isinstance(state, dict) or not fields <= set(state) <= fields | optional:
        raise ValueError('Invalid canvas document state')
    # Additive version-1 history field: existing Canvas workflows start with
    # an empty redo branch, without changing their active image or revision.
    state.setdefault('redo', [])
    state.setdefault('alignment_revision', 0)
    if type(state['alignment_revision']) is not int or state['alignment_revision'] < 0:
        raise ValueError('Invalid image alignment revision')
    if type(state['version']) is not int or state['version'] != 1:
        raise ValueError('Unsupported canvas document version')
    if type(state['revision']) is not int or state['revision'] < 0:
        raise ValueError('Invalid canvas document revision')
    validate_document(state['active'])
    if not isinstance(state['history'], list) or not isinstance(state['redo'], list):
        raise ValueError('Canvas undo/redo history must contain document arrays')
    if not isinstance(state['retained'], dict) or set(state['retained']) != {'blank', 'imported'}:
        raise ValueError('Invalid retained canvas documents')
    for document in state['history'] + state['redo']:
        validate_document(document, active=False)
    for origin, document in state['retained'].items():
        if document is not None:
            validate_document(document, active=False)
            if document['origin'] != origin:
                raise ValueError('Retained canvas document provenance disagrees with its slot')
    # A lower startup limit must not invalidate an existing workflow. Validate
    # every snapshot first, then drop oldest Undo entries and farthest Redo
    # entries, retaining the restoration target at the tail of either stack.
    excess = max(0, len(state['history']) + len(state['redo']) - CONFIG['loader_history_limit'])
    drop_undo = min(excess, len(state['history']))
    state['history'] = state['history'][drop_undo:]
    state['redo'] = state['redo'][excess - drop_undo:]
    return state


def read_document_pixels(document):
    ref = document['image_ref']
    if ref is None:
        return torch.ones((1, document['height'], document['width'], 3), dtype=torch.float32)
    try:
        with Image.open(folder_paths.get_annotated_filepath(ref)) as loaded:
            if getattr(loaded, 'n_frames', 1) != 1:
                raise ValueError('Image Loader supports single still images only')
            loaded = ImageOps.exif_transpose(loaded)
            if loaded.size != (document['width'], document['height']):
                raise ValueError(f"Active document declares {document['width']}x{document['height']}, "
                                 f'image is {loaded.width}x{loaded.height}; reload or resize the canvas')
            # The native opaque painted composite is used when layers exist.
            # Editor alpha is exported separately, never applied to RGB/latent.
            return torch.from_numpy(np.array(loaded.convert('RGB'), dtype=np.float32) / 255).unsqueeze(0)
    except (OSError, FileNotFoundError) as exc:
        raise ValueError(f'Active canvas image is unavailable: {ref}; restore or import an image') from exc


def read_document_mask(document):
    """Read native editor selection (inverted alpha), independently of RGB paint."""
    ref = document['editor_ref'] or document['image_ref']
    if ref is None:
        return torch.zeros((1, document['height'], document['width']), dtype=torch.float32)
    try:
        with Image.open(folder_paths.get_annotated_filepath(ref)) as loaded:
            if getattr(loaded, 'n_frames', 1) != 1:
                raise ValueError('Image Loader supports single still images only')
            loaded = ImageOps.exif_transpose(loaded)
            if loaded.size != (document['width'], document['height']):
                raise ValueError('Active canvas mask dimensions disagree with the document; reload or resize the canvas')
            alpha = np.array(loaded.convert('RGBA').getchannel('A'), dtype=np.float32) / 255
            return 1.0 - torch.from_numpy(alpha).unsqueeze(0)
    except OSError as exc:
        raise ValueError(f'Active canvas mask is unavailable: {ref}; restore or import an image') from exc


class ImageLoader:
    """Shared document engine, deliberately independent of the regional graph."""
    INTEGRATED = False
    RETURN_TYPES = ('IMAGE', 'LATENT', 'INT', 'INT', 'MASK')
    RETURN_NAMES = ('image', 'latent', 'width', 'height', 'mask')
    FUNCTION = 'build'
    CATEGORY = 'LuCiD VRP'
    DESCRIPTION = 'Image document loader with layered Canvas editing, undo/redo and optional native ComfyUI VAE encoding.'

    @classmethod
    def INPUT_TYPES(cls):
        config = frontend_config()
        config['canvas_mp_presets'] = MP_PRESETS
        config['image_loader_integrated'] = cls.INTEGRATED
        multiple = minimum_step()
        return {'required': {
            'preset': (['Custom', *PRESETS, *MP_PRESETS], {'vrp_config': config}),
            'width': ('INT', {'default': 1024, 'min': multiple, 'max': 4096, 'step': multiple}),
            'height': ('INT', {'default': 1024, 'min': multiple, 'max': 4096, 'step': multiple}),
            'step': ([n for n in (8, 16, 32, 64, 128) if n >= multiple], {'default': 32}),
            'latent_mode': (['Auto', 'Empty', 'Encode', 'Encode (Tiled)', 'Off'],),
            'document_state': ('STRING', {'default': DEFAULT_DOCUMENT}),
            'alignment_method': (list(METHODS), {'default': 'Pad'}),
            'apply_to_image': ('BOOLEAN', {'default': cls.INTEGRATED}),
        }, 'optional': {'vae': ('VAE',)}}

    @classmethod
    def VALIDATE_INPUTS(cls, width, height, step):
        # These are pending controls, not authoritative source dimensions. Accept
        # old/API proposal values; the working view always uses the startup grid.
        if any(type(n) is not int for n in (width, height, step)):
            return 'Image Loader size controls must be integers'
        return True

    @classmethod
    def IS_CHANGED(cls, document_state, latent_mode='Auto', alignment_method='Pad', apply_to_image=None, **kwargs):
        state = parse_document_state(document_state)
        document = state['active']
        digests = []
        for ref in dict.fromkeys((document['image_ref'], document['editor_ref'])):
            if ref is None:
                continue
            with open(folder_paths.get_annotated_filepath(ref), 'rb') as stream:
                digests.append(hashlib.file_digest(stream, 'sha256').hexdigest())
        return json.dumps(state, sort_keys=True), latent_mode, alignment_method, apply_to_image, minimum_step(), tuple(digests)

    def resolve(self, latent_mode, document_state, vae, alignment_method, apply_to_image):
        state = parse_document_state(document_state)
        document = state['active']
        source = read_document_pixels(document)
        if latent_mode not in ('Auto', 'Empty', 'Encode', 'Encode (Tiled)', 'Off'):
            raise ValueError('Unknown image loader latent mode')
        if type(apply_to_image) is not bool:
            raise ValueError('Apply to Image output must be boolean')
        effective = latent_mode
        if effective == 'Auto':
            effective = 'Empty' if document['origin'] == 'blank' and bool(torch.all(source == 1)) else 'Encode'
        if alignment_method not in METHODS:
            raise ValueError('Unknown image alignment method')
        method = 'Pad' if effective == 'Empty' else alignment_method
        # Standalone image-only workflows need no unused aligned tensor at all.
        working = (source if not self.INTEGRATED and effective == 'Off' and not apply_to_image
                   else align_image(source, method))
        view = view_metadata(document, method)
        if effective.startswith('Encode') and vae is None:
            raise ValueError(f'Image Loader: {latent_mode} resolves to {effective}; connect a VAE, or select Empty / Off')
        if effective == 'Empty':
            import comfy.model_management
            # Match native EmptyLatentImage without importing the entire node
            # registry. The sampler resolves this placeholder using its MODEL.
            latent = {'samples': torch.zeros((1, 4, view['height'] // 8, view['width'] // 8),
                      device=comfy.model_management.intermediate_device(),
                      dtype=comfy.model_management.intermediate_dtype()), 'downscale_ratio_spacial': 8}
        elif effective == 'Off':
            from comfy_execution.graph_utils import ExecutionBlocker
            latent = ExecutionBlocker('Image Loader latent mode is Off: choose Empty / Encode or disconnect the latent output')
        else:
            # Reject hidden native VAE cropping when an opt-in smaller grid is
            # incompatible. Do not alter the encoder's native tensor layout.
            compression = getattr(vae, 'spacial_compression_encode', None)
            if callable(compression):
                ratio = compression()
                if isinstance(ratio, (int, float)) and ratio > 0 and any(n % ratio for n in (view['width'], view['height'])):
                    raise ValueError(f'Image Loader: working size {view["width"]} x {view["height"]} is incompatible with '
                                     f'this VAE ({ratio}x compression); resize to dimensions divisible by {ratio}. Source is unchanged.')
            from nodes import VAEEncode, VAEEncodeTiled
            latent = (VAEEncode().encode(vae, working)[0] if effective == 'Encode' else
                      VAEEncodeTiled().encode(vae, working, tile_size=512, overlap=64)[0])
        pixels = working if apply_to_image else source
        mask = read_document_mask(document)
        if apply_to_image:
            mask = align_image(mask.unsqueeze(-1), method, padding_mode='constant').squeeze(-1)
        return state, working, view, (pixels, latent, pixels.shape[2], pixels.shape[1], mask)

    def build(self, preset, width, height, step, latent_mode, document_state, vae=None,
              alignment_method='Pad', apply_to_image=False):
        return self.resolve(latent_mode, document_state, vae, alignment_method, apply_to_image)[3]
