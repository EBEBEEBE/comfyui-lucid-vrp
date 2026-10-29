"""Optional startup-only configuration, including the loader working-size policy."""
from copy import deepcopy
import json
import logging
from pathlib import Path
import re

from .region_state import parse_state

DEFAULT_CONFIG = {
    'version': 1,
    'debug': False,
    'minimalstepgranularity': 0,
    'loader_history_limit': 50,
    'status_colors': {
        'ok': {'background': '#294536', 'text': '#d5eddd'},
        'info': {'background': '#303f50', 'text': '#dee7ef'},
        'warning': {'background': '#57452b', 'text': '#f5e4bf'},
        'error': {'background': '#582f3b', 'text': '#f8e1e7'},
    },
    'ui': {'list_height': 160, 'row_height': 30, 'status_padding': 5, 'font_size': 12},
    'default_regions': [],
    'canvas_editor': {'rightButton': 'lucid', 'temporaryPicker': 'alt', 'shortcuts': {}},
    'canvas_presets': {
        '1024 x 1024 (1:1 - 1)': [1024, 1024],
        '1024 x 1280 (4:5 - 0.8)': [1024, 1280],
        '1024 x 1536 (2:3 - 0.67)': [1024, 1536],
        '1280 x 1536 (5:6 - 0.83)': [1280, 1536],
        '1536 x 1536 (1:1 - 1)': [1536, 1536],
        '1536 x 2048 (3:4 - 0.75)': [1536, 2048],
        '2048 x 1024 (2:1 - 2)': [2048, 1024],
        '1536 x 1024 (3:2 - 1.5)': [1536, 1024],
        '768 x 1024 (3:4 - 0.75)': [768, 1024],
    },
}


def resolve_config(data, warn=None):
    """Invalid entries fall back individually; unsupported versions fall back entirely."""
    result = deepcopy(DEFAULT_CONFIG)
    warn = warn or logging.getLogger(__name__).warning
    if not isinstance(data, dict) or type(data.get('version')) is not int or data['version'] != 1:
        warn('VRP config: expected version 1; using built-in defaults')
        return result
    for key in data.keys() - result.keys():
        warn(f'VRP config: unknown field {key!r}; ignored')
    if 'debug' in data:
        if type(data['debug']) is bool:
            result['debug'] = data['debug']
        else:
            warn('VRP config: debug must be a boolean; using false')
    if 'minimalstepgranularity' in data:
        value = data['minimalstepgranularity']
        if type(value) is int and value in (0, 1, 2):
            result['minimalstepgranularity'] = value
        else:
            warn('VRP config: minimalstepgranularity must be 0 (32), 1 (16) or 2 (8); using 32')
    if 'loader_history_limit' in data:
        value = data['loader_history_limit']
        if type(value) is int and 1 <= value <= 1000:
            result['loader_history_limit'] = value
        else:
            warn('VRP config: loader_history_limit must be an integer from 1 to 1000; using 50')
    for section in ('status_colors', 'ui', 'canvas_presets'):
        entries = data.get(section, {})
        if not isinstance(entries, dict):
            warn(f'VRP config: {section} must be an object; using defaults')
            continue
        for key, value in entries.items():
            valid = False
            if section == 'status_colors':
                valid = key in result[section] and isinstance(value, dict) and set(value) == {'background', 'text'} and all(
                    isinstance(color, str) and re.fullmatch(r'#[0-9a-fA-F]{6}', color) for color in value.values())
            elif section == 'ui':
                bounds = {'list_height': (90, 400), 'row_height': (24, 48),
                          'status_padding': (3, 12), 'font_size': (10, 16)}
                valid = key in bounds and type(value) is int and bounds[key][0] <= value <= bounds[key][1]
            else:
                valid = isinstance(key, str) and bool(key.strip()) and key == key.strip() and key.casefold() != 'custom' and (
                    key in result[section] or key.casefold() not in {name.casefold() for name in result[section]}) and (
                    isinstance(value, list) and len(value) == 2 and all(
                        type(size) is int and 8 <= size <= 4096 and size % 8 == 0 for size in value))
            if valid:
                if section == 'canvas_presets':
                    multiple = minimum_step(result)
                    normalized = [max(multiple, (n + multiple - 1) // multiple * multiple) for n in value]
                    if normalized != value:
                        warn(f'VRP config: canvas_presets.{key} aligned from {value} to {normalized}')
                    value = normalized
                result[section][key] = deepcopy(value)
            else:
                warn(f'VRP config: invalid {section}.{key}; ignored')
    if 'default_regions' in data:
        try:
            result['default_regions'] = parse_state(json.dumps({
                'version': 2, 'canvas': {'width': 1024, 'height': 1024}, 'regions': data['default_regions'],
            }, allow_nan=False))['regions']
        except (ValueError, TypeError) as exc:
            warn(f'VRP config: invalid default_regions; using no regions ({exc})')
    editor = data.get('canvas_editor', {})
    if not isinstance(editor, dict):
        warn('VRP config: canvas_editor must be an object; using defaults')
    else:
        for key, value in editor.items():
            if key in ('rightButton', 'temporaryPicker'):
                choices = ('classic', 'lucid', 'menu') if key == 'rightButton' else ('alt', 'q', 'off')
                if isinstance(value, str) and value in choices:
                    result['canvas_editor'][key] = value
                else:
                    warn(f'VRP config: invalid canvas_editor.{key}; using default')
            elif key == 'shortcuts' and isinstance(value, dict):
                actions = {'brush', 'eraser', 'move', 'fill', 'pick', 'mask', 'quick', 'color', 'add',
                           'smaller', 'larger', 'softer', 'harder', 'above', 'below'}
                for action, binding in value.items():
                    if action in actions and isinstance(binding, str) and (binding == '' or re.fullmatch(
                            r'(Shift\+)?([a-z]|\[|\]|PageUp|PageDown|Home|End|Insert|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)', binding, re.I)):
                        result['canvas_editor']['shortcuts'][action] = binding
                    else:
                        warn(f'VRP config: invalid canvas_editor.shortcuts.{action}; ignored')
            else:
                warn(f'VRP config: invalid canvas_editor.{key}; ignored')
    return result


def load_config(path):
    try:
        with Path(path).open(encoding='utf-8-sig') as stream:
            return resolve_config(json.load(stream))
    except FileNotFoundError:
        return deepcopy(DEFAULT_CONFIG)
    except (OSError, ValueError) as exc:
        logging.getLogger(__name__).warning('VRP config: cannot read %s; using defaults (%s)', path, exc)
        return deepcopy(DEFAULT_CONFIG)


def minimum_step(config=None):
    return (32, 16, 8)[(CONFIG if config is None else config)['minimalstepgranularity']]


CONFIG = load_config(Path(__file__).with_name('vrp_config.json'))


def frontend_config():
    # Native node-definition options deliver one resolved configuration to the
    # frontend, without a new HTTP endpoint or a second preset registry.
    return deepcopy({key: CONFIG[key] for key in ('status_colors', 'ui', 'canvas_presets', 'canvas_editor', 'minimalstepgranularity', 'loader_history_limit')})
