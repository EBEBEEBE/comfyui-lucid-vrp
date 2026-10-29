"""Derived image views. Source rasters and editor files are never modified."""
import torch
import torch.nn.functional as F
from .user_config import minimum_step

METHODS = ('Crop', 'Pad', 'Stretch')


def aligned_size(width, height, method, multiple=None):
    multiple = minimum_step() if multiple is None else multiple
    if type(multiple) is not int or multiple not in (8, 16, 32):
        raise ValueError('Image alignment multiple must be 8, 16 or 32')
    if method not in METHODS:
        raise ValueError('Alignment method must be Crop, Pad or Stretch')
    if any(type(n) is not int or n < 1 for n in (width, height)):
        raise ValueError('Image dimensions must be positive integers')
    return tuple(max(multiple, (n // multiple if method == 'Crop' else (n + multiple - 1) // multiple) * multiple)
                 for n in (width, height))


def align_image(pixels, method, *, padding_mode='replicate', multiple=None):
    """BHWC raster -> aligned view; masks use constant (zero) padding."""
    height, width = pixels.shape[1:3]
    target_w, target_h = aligned_size(width, height, method, multiple)
    if (width, height) == (target_w, target_h):
        return pixels
    value = pixels.movedim(-1, 1)
    if method == 'Stretch':
        value = F.interpolate(value, size=(target_h, target_w), mode='bilinear', align_corners=False)
    else:
        crop_w, crop_h = min(width, target_w), min(height, target_h)
        x, y = (width - crop_w) // 2, (height - crop_h) // 2
        value = value[:, :, y:y + crop_h, x:x + crop_w]
        dx, dy = target_w - crop_w, target_h - crop_h
        value = F.pad(value, (dx // 2, dx - dx // 2, dy // 2, dy - dy // 2), mode=padding_mode)
    return value.movedim(1, -1).contiguous()


def view_metadata(document, method):
    width, height = aligned_size(document['width'], document['height'], method)
    return dict(source_id=document['id'], source_width=document['width'], source_height=document['height'],
                width=width, height=height, method=method, multiple=minimum_step())


def validate_view(view):
    fields = {'source_id', 'source_width', 'source_height', 'width', 'height', 'method'}
    if not isinstance(view, dict) or set(view) not in (fields, fields | {'multiple'}) or not isinstance(view['source_id'], str) or not view['source_id']:
        raise ValueError('Invalid image alignment view metadata')
    if any(type(view[k]) is not int or view[k] < 1 for k in ('width','height')):
        raise ValueError('Invalid image alignment view dimensions')
    # Old saved mask views used 8, regardless of the current startup policy.
    if (view['width'], view['height']) != aligned_size(view['source_width'], view['source_height'], view['method'], view.get('multiple', 8)):
        raise ValueError('Image alignment view dimensions disagree')
    return view


def transfer_mask(mask, old, new):
    """Transform authored working-view masks through source space, never stretch crops."""
    validate_view(old)
    validate_view(new)
    if tuple(mask.shape[-2:]) != (old['height'], old['width']):
        raise ValueError('Painted mask dimensions disagree with its saved alignment view')
    if any(old[k] != new[k] for k in ('source_id', 'source_width', 'source_height')):
        return F.interpolate(mask[:, None], size=(new['height'], new['width']), mode='bilinear', align_corners=False)[:, 0]
    value = mask[:, None]
    sw, sh = old['source_width'], old['source_height']
    if old['method'] == 'Stretch':
        value = F.interpolate(value, size=(sh, sw), mode='bilinear', align_corners=False)
    else:
        cw, ch = min(sw, old['width']), min(sh, old['height'])
        x, y = (old['width'] - cw) // 2, (old['height'] - ch) // 2
        selected = value[:, :, y:y + ch, x:x + cw]
        value = torch.zeros((mask.shape[0], 1, sh, sw), dtype=mask.dtype, device=mask.device)
        x, y = (sw - cw) // 2, (sh - ch) // 2
        value[:, :, y:y + ch, x:x + cw] = selected
    if new['method'] == 'Stretch':
        return F.interpolate(value, size=(new['height'], new['width']), mode='bilinear', align_corners=False)[:, 0]
    cw, ch = min(sw, new['width']), min(sh, new['height'])
    x, y = (sw - cw) // 2, (sh - ch) // 2
    value = value[:, :, y:y + ch, x:x + cw]
    dx, dy = new['width'] - cw, new['height'] - ch
    return F.pad(value, (dx // 2, dx - dx // 2, dy // 2, dy - dy // 2))[:, 0]
