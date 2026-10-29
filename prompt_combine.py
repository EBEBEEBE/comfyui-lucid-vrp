"""Text-only regional prompt joining. No model, CLIP, masks or routing calls."""
import math
import re


FORMATS = ('Newline', 'Commas')


def join_prompts(texts, formatting='Newline'):
    if formatting not in FORMATS:
        raise ValueError('Prompt format must be Newline or Commas')
    if any(not isinstance(text, str) for text in texts):
        raise ValueError('Prompt inputs must be strings')
    active = [text for text in texts if text.strip()]
    if formatting == 'Newline':
        return '\n'.join(active)
    # Explicit normalization only. Keep escape/weight syntax and repeated tags;
    # an escaped literal comma is not a separator.
    fragments = re.split(r'(?:\r\n?|\n|(?<!\\),)+', '\n'.join(active))
    return ', '.join(re.sub(r'\s+', ' ', part).strip() for part in fragments if part.strip())


def region_prompt_pairs(bundle):
    """Read only the text/identity/weight portion of the canonical contract."""
    if not isinstance(bundle, dict) or set(bundle) != {'version', 'regions'}:
        raise ValueError('VRP Prompt Combine requires a VRP_REGIONS bundle')
    if type(bundle['version']) is not int or bundle['version'] != 1 or not isinstance(bundle['regions'], list):
        raise ValueError('Unsupported VRP_REGIONS prompt bundle')
    used, pairs = set(), []
    for region in bundle['regions']:
        if not isinstance(region, dict) or type(region.get('version')) is not int or region['version'] != 1:
            raise ValueError('Invalid VRP_REGION prompt record')
        identity = region.get('region_id')
        if not isinstance(identity, str) or not identity.strip() or identity in used:
            raise ValueError('Region prompt IDs must be nonempty and unique')
        used.add(identity)
        positive, negative = region.get('positive_prompt'), region.get('negative_prompt')
        if not isinstance(positive, str) or not isinstance(negative, str):
            raise ValueError('Region positive/negative prompts must be strings')
        weight = region.get('weight')
        if type(weight) not in (int, float) or not math.isfinite(weight) or not 0 <= weight <= 1:
            raise ValueError('Region prompt weight must be between 0 and 1')
        if weight > 0:
            pairs.append((positive, negative))
    return pairs


class VRPPromptCombine:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {
            'formatting': (list(FORMATS),),
        }, 'optional': {
            'vrp_region': ('VRP_REGIONS',),
            'global_prompt_positive': ('STRING', {'forceInput': True, 'multiline': True}),
            'global_prompt_negative': ('STRING', {'forceInput': True, 'multiline': True}),
        }}

    RETURN_TYPES = ('STRING', 'STRING')
    RETURN_NAMES = ('positive_combined', 'negative_combined')
    FUNCTION = 'combine'
    CATEGORY = 'LuCiD VRP'
    DESCRIPTION = ('Text only: global then active region prompts, separately for positive and negative. '
                   'Region input is optional; without it, combine global prompts only. '
                   'Connect the Region chain directly, not Core. Commas explicitly normalizes separators.')

    def combine(self, vrp_region=None, formatting='Newline', global_prompt_positive=None, global_prompt_negative=None):
        pairs = [] if vrp_region is None else region_prompt_pairs(vrp_region)
        positive = '' if global_prompt_positive is None else global_prompt_positive
        negative = '' if global_prompt_negative is None else global_prompt_negative
        return (join_prompts([positive, *(pair[0] for pair in pairs)], formatting),
                join_prompts([negative, *(pair[1] for pair in pairs)], formatting))
