"""Canvas-only state and image loading for Anima Canvas Builder."""
import hashlib
import json
import numpy as np
import torch
from PIL import Image, ImageOps
import folder_paths
from .user_config import CONFIG, frontend_config

PRESETS = {name: tuple(size) for name, size in CONFIG['canvas_presets'].items()}


def validate_dimensions(width, height):
    for value in (width, height):
        if type(value) is not int or not 8 <= value <= 4096 or value % 8:
            raise ValueError('Canvas dimensions must be multiples of 8 between 8 and 4096')


def validate_descriptor(canvas):
    if not isinstance(canvas, dict) or type(canvas.get('version')) is not int or canvas['version'] != 1:
        raise ValueError('Unsupported VRP_CANVAS descriptor')
    fields = {'version', 'width', 'height', 'revision', 'source', 'image_ref'}
    if set(canvas) not in (fields, fields | {'alignment'}):
        raise ValueError('VRP_CANVAS must contain canvas metadata only')
    if 'alignment' in canvas:
        from .image_alignment import validate_view
        view = validate_view(canvas['alignment'])
        if (canvas['width'], canvas['height']) != (view['width'], view['height']):
            raise ValueError('Canvas dimensions disagree with working image view')
    else:
        validate_dimensions(canvas['width'], canvas['height'])
    if type(canvas['revision']) is not int or canvas['revision'] < 0:
        raise ValueError('Invalid canvas revision')
    if canvas['source'] not in ('blank', 'image'):
        raise ValueError('Invalid canvas source')
    if canvas['image_ref'] is not None and not isinstance(canvas['image_ref'], str):
        raise ValueError('Invalid canvas image reference')
    return canvas['width'], canvas['height']


class AnimaCanvasBuilder:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {
            'source': (['blank', 'image'],),
            'preset': (['custom', *PRESETS], {'vrp_config': frontend_config()}),
            'width': ('INT', {'default': 1024, 'min': 8, 'max': 4096, 'step': 8}),
            'height': ('INT', {'default': 1024, 'min': 8, 'max': 4096, 'step': 8}),
            'image': ('STRING', {'default': ''}),
            'revision': ('INT', {'default': 0, 'min': 0}),
            'source_state': ('STRING', {'default': ''}),
            'encoding': (['Off', 'Encode', 'Encode (Tiled)'],),
        }, 'optional': {'vae': ('VAE',)}}

    RETURN_TYPES = ('IMAGE', 'VRP_CANVAS', 'INT', 'INT', 'LATENT')
    RETURN_NAMES = ('image', 'canvas', 'width', 'height', 'latent')
    FUNCTION = 'build'
    CATEGORY = 'Anima VRP'

    @classmethod
    def IS_CHANGED(cls, source, preset, width, height, image, revision, source_state='', encoding='Off', vae=None):
        # Include retained source state and mode inputs so a source switch,
        # blank resize, or edited-image reference cannot reuse an old output.
        identity = (source, preset, width, height, revision, source_state, encoding)
        if not image:
            return identity
        path = folder_paths.get_annotated_filepath(image)
        with open(path, 'rb') as stream:
            return identity + (hashlib.file_digest(stream, 'sha256').hexdigest(),)

    def build(self, source, preset, width, height, image, revision, source_state='', encoding='Off', vae=None):
        if source not in ('blank', 'image') or preset not in ('custom', *PRESETS):
            raise ValueError('Unknown canvas source or preset')
        if type(revision) is not int or revision < 0:
            raise ValueError('Canvas revision must be a nonnegative integer')
        if encoding not in ('Off', 'Encode', 'Encode (Tiled)'):
            raise ValueError('Unknown VAE encoding mode')
        if encoding != 'Off' and vae is None:
            raise ValueError('Connect a VAE when encoding is enabled')
        if source_state:
            try:
                retained = json.loads(source_state)
                if retained['version'] != 1:
                    raise ValueError('Unsupported retained canvas state')
                blank = retained['blank']
                validate_dimensions(blank['width'], blank['height'])
                reference = (retained['image']['ref'] if source == 'image' else
                             blank['edits'].get(f"{blank['width']}x{blank['height']}", ''))
                if reference != image:
                    raise ValueError('Active image reference disagrees with retained source state')
                if source == 'blank' and (width, height) != (blank['width'], blank['height']):
                    raise ValueError('Active blank dimensions disagree with retained source state')
            except (KeyError, TypeError, AttributeError) as exc:
                raise ValueError('Invalid retained canvas source state') from exc
        if source == 'blank' and not image:
            width, height = PRESETS.get(preset, (width, height))
            validate_dimensions(width, height)
            pixels = torch.ones((1, height, width, 3), dtype=torch.float32)
            image_ref = None
        else:
            validate_dimensions(width, height)
            if not image:
                raise ValueError('Choose an image or prepare a blank canvas for editing')
            path = folder_paths.get_annotated_filepath(image)
            with Image.open(path) as loaded:
                if getattr(loaded, 'n_frames', 1) != 1:
                    raise ValueError('Canvas Builder supports single still images only')
                loaded = ImageOps.exif_transpose(loaded)
                actual = loaded.size
                validate_dimensions(*actual)
                if source == 'blank' and actual != (width, height):
                    raise ValueError(f'Canvas/image mismatch: declared {width}x{height}, image is {actual}')
                width, height = actual
                # Canvas paint is RGB content; mask alpha is not a regional mask.
                pixels = torch.from_numpy(np.array(loaded.convert('RGB'), dtype=np.float32) / 255.0).unsqueeze(0)
            image_ref = image
        descriptor = {'version': 1, 'width': width, 'height': height,
                      'source': source, 'revision': revision, 'image_ref': image_ref}
        latent = None
        if encoding != 'Off':
            from nodes import VAEEncode, VAEEncodeTiled
            if encoding == 'Encode':
                latent = VAEEncode().encode(vae, pixels)[0]
            else:
                latent = VAEEncodeTiled().encode(vae, pixels, tile_size=512, overlap=64)[0]
        elif source == 'blank':
            # The unified output is source-aware: blank + Off remains a true
            # txt2img latent, while image + Off leaves encoding to the graph.
            from nodes import EmptyLatentImage
            latent = EmptyLatentImage().generate(width, height, 1)[0]
        return pixels, descriptor, width, height, latent
