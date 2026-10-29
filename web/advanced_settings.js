import { app, observeValue } from './classic_adapter.js';

const fields = [
    'base_mode', 'base_strength', 'start_percent', 'end_percent',
    'cross_mask_strength', 'self_mask_strength', 'base_ratio',
    'cross_inject_every', 'self_inject_every',
];
const isSettingsNode = node => ['VRPAdvancedSettings', 'VRPAdvancedSettingsUI'].includes(node.comfyClass ?? node.name);

const controllerKey = Symbol('animaVRPAdvancedSettingsController');
const readOnlyKey = Symbol('animaVRPReadOnlyWidget');

function copyValues(widget, names) {
    return Object.fromEntries(names.map(name => [name, widget(name)?.value]));
}

app.registerExtension({
    name: 'AnimaVRP.AdvancedSettings',
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (isSettingsNode(nodeData)) nodeType.prototype.vrpAdvancedPresets = nodeData.input?.required?.preset?.[1]?.vrp_presets;
    },
    nodeCreated(node) {
        if (!isSettingsNode(node)) return;
        if (node[controllerKey]) {
            node[controllerKey].refresh();
            return;
        }

        const widget = name => node.widgets?.find(item => item.name === name);
        const preset = widget('preset');
        if (!preset) return;
        // Backend node-definition metadata is the sole source of preset values.
        // Do not display a guessed JS table against an older backend definition.
        const presets = node.vrpAdvancedPresets ?? preset.options?.vrp_presets;
        if (!presets) return;

        // Custom values are UI session state, not another serialized backend
        // setting. The actual widget values remain the workflow state.
        let customValues = null;
        let lastPreset = String(preset.value ?? '');

        const readPreset = () => String(preset.value ?? '');
        const isKnownPreset = value => value === 'Custom' || Object.hasOwn(presets, value);
        const rememberCustomValues = () => {
            customValues = copyValues(widget, fields);
        };
        const setValues = values => {
            if (!values) return;
            for (const name of fields) {
                const input = widget(name);
                if (input && values[name] !== undefined) input.value = values[name];
            }
        };
        const refresh = () => {
            // ComfyUI may redraw/reconfigure widgets after the browser tab is
            // restored. Do not use widget.disabled here: classic LiteGraph
            // hides the value text for disabled widgets.
            const currentPreset = readPreset();
            if (isKnownPreset(currentPreset) && currentPreset !== lastPreset) {
                applyPreset(currentPreset);
                return;
            }
            if (currentPreset !== 'Custom') setValues(presets[currentPreset]);
            for (const name of fields) {
                const input = widget(name);
                if (input) input.disabled = false;
            }
        };
        const applyPreset = (requestedPreset = undefined) => {
            const requested = String(requestedPreset ?? '');
            const currentPreset = isKnownPreset(requested) ? requested : readPreset();

            // Use the callback's selected value as the source of truth. This
            // also handles classic widget versions that update .value just
            // after invoking the callback.
            if (preset.value !== currentPreset) preset.value = currentPreset;

            if (lastPreset === 'Custom') rememberCustomValues();

            if (currentPreset === 'Custom') {
                // The first switch to Custom starts from the values currently
                // displayed; later switches restore the user's last Custom
                // edits instead of replacing them with a preset.
                if (!customValues) rememberCustomValues();
                setValues(customValues);
            } else {
                setValues(presets[currentPreset]);
            }

            lastPreset = currentPreset;
            refresh();
            node.graph?.setDirtyCanvas(true, true);
        };

        for (const name of fields) {
            const input = widget(name);
            if (!input) continue;
            observeValue(input, () => {
                if (readPreset() === 'Custom') rememberCustomValues();
            });
            if (!input[readOnlyKey]) {
                const previousPointerDown = input.onPointerDown;
                input.onPointerDown = function(...args) {
                    if (readPreset() !== 'Custom') return true;
                    return previousPointerDown?.apply(this, args) ?? false;
                };

                // Older classic widget paths may use mouse() instead of the
                // current onPointerDown() hook.
                const previousMouse = input.mouse;
                input.mouse = function(...args) {
                    if (readPreset() !== 'Custom') return true;
                    return previousMouse?.apply(this, args) ?? false;
                };
                input[readOnlyKey] = true;
            }
        }

        const previousPresetCallback = preset.callback;
        preset.callback = function(...args) {
            const result = previousPresetCallback?.apply(this, args);
            const selected = args.find(value => typeof value === 'string' && isKnownPreset(value));
            applyPreset(selected);
            return result;
        };

        const controller = { refresh };
        node[controllerKey] = controller;
        node.vrpAdvancedSettingsController = controller;

        // Keep the state correct if the classic canvas redraws this node after
        // tab visibility changes or widget reconfiguration.
        const previousDraw = node.onDrawForeground;
        node.onDrawForeground = function(...args) {
            refresh();
            return previousDraw?.apply(this, args);
        };
        const previousConfigure = node.onConfigure;
        node.onConfigure = function(...args) {
            const result = previousConfigure?.apply(this, args);
            // Loaded Custom fields are authoritative, not the remembered draft
            // from before loading; fixed presets use current backend values.
            lastPreset = readPreset();
            if (lastPreset === 'Custom') rememberCustomValues();
            refresh(); return result;
        };

        if (lastPreset === 'Custom') rememberCustomValues();
        setValues(presets[lastPreset]);
        refresh();
    },
});
