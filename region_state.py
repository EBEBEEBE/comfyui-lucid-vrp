"""Version 2 spatial/editor state; global prompts belong to external inputs."""

import json
import math


def _fields(value, expected, path):
    if not isinstance(value, dict) or set(value) != set(expected):
        raise ValueError(f"{path} must contain exactly: {', '.join(expected)}")


def _number(value, path):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError(f"{path} must be a finite number")
    return float(value)


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def parse_state(serialized):
    """Validate JSON and return a fresh normalized dict. Reject unknown fields."""
    if not isinstance(serialized, str):
        raise ValueError("vrp_state must be a JSON string")
    try:
        state = json.loads(serialized, object_pairs_hook=_unique_object)
    except (ValueError, RecursionError) as exc:
        raise ValueError(f"Invalid vrp_state JSON: {exc}") from exc
    if not isinstance(state, dict) or type(state.get('version')) is not int or state['version'] != 2:
        raise ValueError("Unsupported regional state version; recreate the experimental Core node (expected 2)")
    _fields(state, ('version', 'canvas', 'regions'), 'state')
    _fields(state['canvas'], ('width', 'height'), 'canvas')
    for name, value in state['canvas'].items():
        if type(value) is not int or value < 8 or value % 8:
            raise ValueError(f"canvas.{name} must be a positive multiple of 8")
    if not isinstance(state['regions'], list):
        raise ValueError("regions must be an array")
    ids = set()
    for i, region in enumerate(state['regions']):
        path = f'regions[{i}]'
        if not isinstance(region, dict):
            raise ValueError(f"{path} must be an object")
        allowed_fields = {
            'id', 'x', 'y', 'width', 'height', 'prompt', 'weight',
            'negative_prompt', 'label',
        }
        if set(region) != allowed_fields:
            raise ValueError(f"{path} must contain exactly: {', '.join(sorted(allowed_fields))}")
        if not isinstance(region['label'], str) or not region['label'].strip():
            raise ValueError(f"{path}.label must be a nonempty string")
        identity = region['id']
        if not isinstance(identity, str) or not identity.strip() or identity in ids:
            raise ValueError(f"{path}.id must be a nonempty unique string")
        ids.add(identity)
        if not isinstance(region['prompt'], str):
            raise ValueError(f"{path}.prompt must be a string")
        if not isinstance(region['negative_prompt'], str):
            raise ValueError(f"{path}.negative_prompt must be a string")
        weight = _number(region['weight'], f'{path}.weight')
        if not 0 <= weight <= 1:
            raise ValueError(f"{path}.weight must be between 0 and 1")
        region['weight'] = weight
        for origin, extent in (('x', 'width'), ('y', 'height')):
            start = _number(region[origin], f'{path}.{origin}')
            size = _number(region[extent], f'{path}.{extent}')
            if size <= 0:
                raise ValueError(f"{path}.{extent} must be positive")
            end = min(1.0, max(0.0, start + size))
            start = min(1.0, max(0.0, start))
            if end <= start:
                raise ValueError(f"{path} has no area inside the canvas")
            region[origin], region[extent] = start, end - start
    return state


def serialize_state(state):
    """Canonical JSON with stable keys, preserved region order and Unicode."""
    validated = parse_state(json.dumps(state, allow_nan=False))
    return json.dumps(validated, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)
