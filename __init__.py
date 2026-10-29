"""LuCiD Visual Regional Painter: startup-selected public registrations."""
from .nodes import AnimaVRP, VRPRegion, VRPAdvancedSettings
from .canvas_document import VRPCanvas
from .image_document import ImageLoader
from .prompt_combine import VRPPromptCombine
from .moss_visual_regional_prompt_experimental import MOSSVisualRegionalPrompt
from .user_config import CONFIG

def node_registrations(debug=False):
    # IDs remain stable; display names identify the newly promoted presentation.
    entries = {
        'VRPCanvasUI': (VRPCanvas, 'VRP Canvas Image Loader'),
        'VRPStandaloneImageLoader': (ImageLoader, 'VRP Standalone Image Loader'),
        'VRPPromptCombine': (VRPPromptCombine, 'VRP Prompt Combine'),
        'MOSSVisualRegionalPromptExperimental': (MOSSVisualRegionalPrompt, 'MOSS - Visual Regional Prompt'),
        'VRPRegionUI': (VRPRegion, 'VRP Region'),
        'AnimaVRPUI': (AnimaVRP, 'Anima VRP - Visual Regional Prompt'),
        'VRPAdvancedSettingsUI': (VRPAdvancedSettings, 'Anima VRP Adv. Settings (Easy UI)'),
        'VRPAdvancedSettings': (VRPAdvancedSettings, 'Anima VRP Adv. Settings (Simple UI)'),
    }
    if debug:
        entries.update({
            'VRPCanvas': (VRPCanvas, 'VRP Canvas Image Loader (Legacy)'),
            'VRPRegion': (VRPRegion, 'VRP Region (Legacy)'),
            'AnimaVRP': (AnimaVRP, 'Anima VRP (Legacy)'),
        })
    # Canvas Builder and M1 Proof intentionally have no registration in either mode.
    return ({key: value[0] for key, value in entries.items()},
            {key: value[1] for key, value in entries.items()})


NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS = node_registrations(CONFIG['debug'])
WEB_DIRECTORY = './web'

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
