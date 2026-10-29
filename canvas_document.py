"""Integrated canvas adapter for the shared image-document engine."""
import hashlib
import os
import tempfile
from pathlib import Path
import folder_paths
import numpy as np
from PIL import Image
from .image_document import (ImageLoader, DEFAULT_DOCUMENT, MP_PRESETS, PRESETS,
                             validate_document, parse_document_state, read_document_pixels)


def working_reference(document, pixels):
    """Materialize only a derived view; never overwrite source/editor files."""
    if tuple(pixels.shape[1:3]) == (document['height'], document['width']):
        return document['image_ref']
    raster = (pixels[0].detach().cpu().numpy().clip(0, 1) * 255).round().astype(np.uint8)
    digest = hashlib.sha256(raster.tobytes()).hexdigest()
    directory = Path(folder_paths.get_temp_directory())
    directory.mkdir(parents=True, exist_ok=True)
    filename = f'vrp-working-{pixels.shape[2]}x{pixels.shape[1]}-{digest}.png'
    destination = directory / filename
    if not destination.exists():
        with tempfile.NamedTemporaryFile(dir=directory, suffix='.png', delete=False) as stream:
            temporary = stream.name
        try:
            Image.fromarray(raster).save(temporary)
            os.replace(temporary, destination)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    return f'{filename} [temp]'


class VRPCanvas(ImageLoader):
    INTEGRATED = True
    RETURN_TYPES = ('VRP_CANVAS', 'IMAGE', 'LATENT', 'INT', 'INT', 'MASK')
    RETURN_NAMES = ('canvas', 'image', 'latent', 'width', 'height', 'mask')

    def build(self, preset, width, height, step, latent_mode, document_state, vae=None,
              alignment_method='Pad', apply_to_image=True):
        state, working, view, outputs = self.resolve(
            latent_mode, document_state, vae, alignment_method, apply_to_image)
        document = state['active']
        canvas = {'version': 1, 'width': view['width'], 'height': view['height'],
                  'revision': state['revision'] + state['alignment_revision'],
                  'source': 'blank' if document['origin'] == 'blank' else 'image',
                  'image_ref': working_reference(document, working),
                  'alignment': view}
        return (canvas, *outputs)
