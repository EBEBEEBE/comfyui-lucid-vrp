"""Validate editable Canvas metadata without importing a browser or rendering it.

The loader executes the committed RGB/native-mask files. Source layers and this
metadata are retained for reopening; they are never flattened during validation.
"""
import math


def _fields(value, required, optional=()):
    if not isinstance(value, dict) or not set(required) <= set(value) <= set(required) | set(optional):
        raise ValueError('Invalid editable canvas fields')


def _number(value):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError('Editable canvas geometry must be finite')
    return value


def _text(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError('Editable canvas requires nonempty text')


def _reference(value, required=False):
    if value is None and not required:
        return
    _text(value)
    if value.startswith(('memory:', '@', 'data:')):
        raise ValueError('Editable canvas contains an unsaved asset reference')


def _size(width, height):
    if any(type(value) is not int or not 1 <= value <= 2**53-1 for value in (width, height)):
        raise ValueError('Editable canvas dimensions must be positive safe integers')


def _transform(matrix):
    if not isinstance(matrix, list) or len(matrix) != 6:
        raise ValueError('Editable canvas transform needs six numbers')
    a, b, c, d, e, f = map(_number, matrix)
    size = max(abs(a), abs(b), abs(c), abs(d))
    if not size:
        raise ValueError('Editable canvas transform is singular')
    determinant = (a/size)*(d/size) - (b/size)*(c/size)
    if not determinant:
        raise ValueError('Editable canvas transform is singular')
    ia, ib, ic, id_ = d/size/determinant/size, -b/size/determinant/size, -c/size/determinant/size, a/size/determinant/size
    for value in (ia, ib, ic, id_, -(ia*e+ic*f), -(ib*e+id_*f)):
        _number(value)


def _warp(warp):
    _fields(warp, ('bounds', 'corners'))
    bounds, corners = warp['bounds'], warp['corners']
    _fields(bounds, ('x', 'y', 'width', 'height'))
    for value in bounds.values():
        _number(value)
    if bounds['width'] <= 0 or bounds['height'] <= 0:
        raise ValueError('Editable canvas distort bounds must be positive')
    _number(bounds['x']+bounds['width'])
    _number(bounds['y']+bounds['height'])
    if not isinstance(corners, list) or len(corners) != 4:
        raise ValueError('Editable canvas distortion needs four corners')
    for point in corners:
        _fields(point, ('x', 'y'))
        _number(point['x'])
        _number(point['y'])
    edges = [(corners[(i+1) % 4]['x']-p['x'], corners[(i+1) % 4]['y']-p['y']) for i, p in enumerate(corners)]
    scale = max(x*x+y*y for x, y in edges)
    _number(scale)
    if not scale or any(x*edges[(i+1) % 4][1]-y*edges[(i+1) % 4][0] <= scale*1e-6 for i, (x, y) in enumerate(edges)):
        raise ValueError('Editable canvas distort corners must be convex and non-collapsed')


def validate_canvas_document(document, owner):
    _fields(document, ('format', 'version', 'id', 'width', 'height', 'layers', 'mask'))
    if document['format'] != 'lucid-vrp-raster' or type(document['version']) is not int or document['version'] not in (1, 2):
        raise ValueError('Unsupported editable canvas format/version')
    _text(document['id'])
    _size(document['width'], document['height'])
    if any(document[key] != owner[key] for key in ('id', 'width', 'height')):
        raise ValueError('Editable canvas identity/dimensions disagree with loader document')
    if not isinstance(document['layers'], list):
        raise ValueError('Editable canvas layers must be an array')
    ids = set()
    previous = None
    for layer in document['layers']:
        _fields(layer, ('id', 'type', 'name', 'width', 'height', 'asset_ref', 'visible', 'locked', 'opacity', 'transform'), ('warp', 'crop', 'parent_id'))
        _text(layer['id'])
        _text(layer['name'])
        if layer['id'] in ids:
            raise ValueError('Duplicate editable canvas layer ID')
        ids.add(layer['id'])
        if layer['type'] not in ('paint', 'image'):
            raise ValueError('Invalid editable canvas layer type')
        _size(layer['width'], layer['height'])
        _reference(layer['asset_ref'], layer['type'] == 'image')
        if type(layer['visible']) is not bool or type(layer['locked']) is not bool:
            raise ValueError('Editable canvas flags must be boolean')
        if not 0 <= _number(layer['opacity']) <= 1:
            raise ValueError('Invalid editable canvas opacity')
        _transform(layer['transform'])
        if layer.get('warp') is not None:
            _warp(layer['warp'])
        crop = layer.get('crop')
        if crop is not None:
            _fields(crop, ('x', 'y', 'width', 'height'))
            for value in crop.values():
                _number(value)
            if crop['width'] < 1 or crop['height'] < 1:
                raise ValueError('Invalid editable canvas crop')
            _number(crop['x']+crop['width']+crop['y']+crop['height'])
            if layer['type'] == 'image' and (crop['x'] < 0 or crop['y'] < 0 or crop['x']+crop['width'] > layer['width'] or crop['y']+crop['height'] > layer['height']):
                raise ValueError('Editable image crop exceeds source bounds')
        if 'parent_id' in layer:
            _text(layer['parent_id'])
            if (layer['type'] != 'paint' or layer.get('warp') is not None or crop is not None
                    or layer['transform'][:4] != [1, 0, 0, 1] or previous is None
                    or previous['id'] != layer['parent_id'] or previous['type'] != 'image'):
                raise ValueError('Invalid attached paint relationship')
        if document['version'] == 1 and (crop is not None or 'parent_id' in layer):
            raise ValueError('Crop and attached paint require canvas version 2')
        previous = layer
    _fields(document['mask'], ('asset_ref',))
    _reference(document['mask']['asset_ref'])
    return document
