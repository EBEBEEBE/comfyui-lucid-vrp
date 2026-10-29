// Cosmetic source-badge alias. Backend IDs, module metadata and saved graphs
// retain their existing values; unrelated node packs keep their own badges.
import { app } from '../../scripts/app.js';

const OWN_NODE_IDS = new Set([
    'VRPCanvasUI',
    'VRPStandaloneImageLoader',
    'VRPPromptCombine',
    'MOSSVisualRegionalPromptExperimental',
    'VRPRegionUI',
    'AnimaVRPUI',
    'VRPAdvancedSettingsUI',
    'VRPAdvancedSettings',
    'VRPCanvas',
    'VRPRegion',
    'AnimaVRP',
]);

const registeredTypes = new Map();

app.registerExtension({
    name: 'LuCiD.NodeSourceBadge',

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (OWN_NODE_IDS.has(nodeData.name)) {
            registeredTypes.set(nodeData.name, nodeType);
        }
    },

    beforeRegisterVueAppNodeDefs(definitions) {
        for (let i = 0; i < definitions.length; i++) {
            const definition = definitions[i];
            if (!OWN_NODE_IDS.has(definition.name)) continue;

            const registered = registeredTypes.get(definition.name)?.nodeData;
            if (!registered?.nodeSource || registered.name !== definition.name ||
                registered.python_module !== definition.python_module) continue;

            registered.nodeSource.badgeText = 'LuCiD VRP';
            // The checked classic frontend retains existing ComfyNodeDefImpl
            // instances. Reusing this one prevents it from deriving the old
            // badge again from the unchanged python_module in the raw record.
            definitions[i] = registered;
        }
    },
});
