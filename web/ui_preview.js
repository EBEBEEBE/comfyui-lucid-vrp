// Import the established controllers before registering presentation-only UIs.
// ESM caching makes this safe alongside ComfyUI's ordinary extension discovery.
import './canvas_document.js';
import './region_editor.js';
import './region_identity.js';
import './vrp_editor.js';
import './advanced_settings.js';
import { app, linkedCanvas, fitVisibleWidgets } from './classic_adapter.js';
import { clipspaceReference } from './canvas_document_adapter.js';
import { setWidgetVisible } from './region_ui.js';
import { installClassicLayout, installExpertSizing, installContentSizing } from './ui_preview_classic_adapter.js';
import { actionPanel, sectionHeader, restorePanel } from './ui_preview_controls.js';
import { resolutionControls } from './canvas_resolution_controls.js';

const TYPES = new Set(['VRPCanvasUI', 'VRPStandaloneImageLoader', 'VRPRegionUI', 'AnimaVRPUI', 'VRPAdvancedSettingsUI']);
// Region/Core heights follow the supplied sizing workflow. Both loaders use
// the approved compact workbench width; content/aspect/sections drive height.
const INITIAL_SIZES = {
    VRPCanvasUI: [420, 1030], VRPStandaloneImageLoader: [420, 1010],
    VRPRegionUI: [450, 1090], AnimaVRPUI: [450, 1502], VRPAdvancedSettingsUI: [370, 335],
};

export function attachPreviewUI(node) {
    if (!TYPES.has(node.comfyClass) || node.vrpPreviewUI) return;
    if (node.comfyClass === 'VRPAdvancedSettingsUI' && !node.vrpAdvancedSettingsController) return;
    const widget = name => node.widgets.find(w => w.name === name);
    const panels = [], suppressed = new Set(), rows = [];
    let removed = false, ordering = [], expertSizing, contentSizing;
    const compactExpert = node.comfyClass === 'VRPAdvancedSettingsUI';
    const layout = installClassicLayout(node, () => ordering, suppressed, compactExpert);
    const suppress = name => {
        const item = widget(name); if (item) { suppressed.add(item); item.vrpPresentationHidden = true; setWidgetVisible(item, false); }
        return item;
    };
    const invoke = name => {
        const item = widget(name);
        if (!item?.callback) throw Error(`Missing existing action: ${name}`);
        return item.callback.call(item, item.value, app.canvas, node);
    };
    const panel = (name, actions, options) => {
        const result = actionPanel(node, name, actions, options); panels.push(result); return result.widget;
    };
    const internalSelected = () => !!node.vrpEditorState?.regions.find(r => r.id === node.vrpSelectedRegion);
    const readyCanvas = () => linkedCanvas(node)?.image ? '' : 'Connect a ready canvas image first';
    function refresh() {
        if (removed) return;
        for (const item of suppressed) setWidgetVisible(item, false);
        for (const row of rows) row.update?.();
        layout.refresh();
        for (const item of panels) item.refresh();
        contentSizing && fitVisibleWidgets(node);
    }

    if (node.comfyClass === 'VRPCanvasUI' || node.comfyClass === 'VRPStandaloneImageLoader') {
        const controller = node.imageDocumentController;
        if (!controller) throw Error('Canvas controller must be installed before its preview UI');
        node.properties ??= {};
        // Presentation preferences only. Canonical document/history stay in the
        // established controller and keep the original version/serialization.
        const sections = () => node.properties.vrpUiSections ??= { creation: false, restore: false };
        const idle = () => !controller.idle ? 'Canvas operation in progress' : '';
        const current = () => idle() || (node.imageDocumentReady ? '' : 'A valid active image is required');
        const oldButtons = ['Create blank canvas', 'Resize current canvas (stretch all layers)', 'Undo canvas change', 'Redo canvas change',
            'Restore last blank canvas', 'Restore last imported canvas', 'Import image', 'Paste image from Clipspace', 'Edit with Mask Editor',
            'Swap width and height', 'Proposed size preview'];
        oldButtons.forEach(suppress);
        const actions = panel('Canvas actions', [
            { label: 'Edit canvas', icon: 'edit', run: () => invoke('Edit with Mask Editor'), unavailable: current },
            { label: 'Import', icon: 'import', run: () => invoke('Import image'), unavailable: idle },
            { label: 'Paste', icon: 'paste', run: () => invoke('Paste image from Clipspace'), unavailable: () => {
                if (idle()) return idle(); try { clipspaceReference(); return ''; } catch { return 'Copy an image to Clipspace first'; }
            } },
        ], { columns: 3 });
        const history = panel('Canvas history', [
            { label: 'Undo', icon: 'undo', run: () => invoke('Undo canvas change'), unavailable: () => idle() || (!controller.state?.history.length ? 'No earlier canvas change to undo' : '') },
            { label: 'Redo', icon: 'redo', run: () => invoke('Redo canvas change'), unavailable: () => idle() || (!controller.state?.redo?.length ? 'No canvas change to redo' : '') },
        ], { compact: true });
        const latentMode = layout.addRow('Latent output', [
            { name: 'latent_mode', label: 'Latent mode', minWidth: 180, horizontal: true, values: ['Auto', 'Empty', 'Encode', 'Encode (Tiled)', 'Off'],
              optionUnavailable:value=>controller.encodingUnavailable(value),hint:()=>controller.encodingUnavailable('Encode') },
            { name: 'alignment_method', label: `Align to ${controller.multiple}`, minWidth: 120, horizontal: true, values: ['Crop','Pad','Stretch'],
              unavailable: () => controller.effectiveMode === 'Empty' ? `Empty uses ceil-to-${controller.multiple} dimensions (Pad)` : '' },
            { name: 'apply_to_image', label: 'Apply to IMAGE output', minWidth: 180, kind: 'switch', switchStyle: 'thumb', inline: true },
        ], () => true, () => node.id, {
            cells: (fields, width) => fields.map((field,index) => ({...field,x:0,top:index*40,width:Math.max(348,width-32)})),
        });
        const creationHeader = sectionHeader(node, 'Create / Resize', () => !!sections().creation, () => {
            sections().creation = !sections().creation; refresh(); node.vrpFitWidgets?.();
        }); panels.push(creationHeader);
        const preset = resolutionControls(node, layout, () => !!sections().creation,
            widget('preset')?.options?.values ?? ['Custom', ...Object.keys(node.vrpUserConfig?.canvas_presets || {}), ...Object.keys(node.vrpUserConfig?.canvas_mp_presets || {})]);
        const creation = panel('Commit canvas size', [
            { label: 'Create blank', icon: 'create', run: () => invoke('Create blank canvas'), unavailable: idle },
            { label: 'Resize current', icon: 'resize', hint: 'Stretch the current image and all native layers', run: () => invoke('Resize current canvas (stretch all layers)'), unavailable: current },
        ], { compact: true, note: 'Pending size · applies only on action.' });
        const restoreHeader = sectionHeader(node, 'Restore source', () => !!sections().restore, () => {
            sections().restore = !sections().restore; refresh(); node.vrpFitWidgets?.();
        }); panels.push(restoreHeader);
        const restore = restorePanel(node, controller); panels.push(restore);
        rows.push({ update() {
            setWidgetVisible(creation, !!sections().creation);
            setWidgetVisible(restore.widget, !!sections().restore);
        } });
        ordering = [widget('active_canvas'), widget('Active canvas'), widget('vrp_status'), actions, history,
            latentMode, creationHeader.widget, preset, creation, restoreHeader.widget, restore.widget];
    } else if (node.comfyClass === 'VRPRegionUI') {
        ['Edit region mask', 'Clear region mask'].forEach(suppress);
        const mode = layout.addRow('Region source', [
            { name: 'authoring_mode', label: 'Region source', minWidth: 180, values: ['BBox', 'Painted Mask', 'External MASK'] },
        ]);
        const painted = () => String(widget('authoring_mode')?.value) === 'Painted Mask';
        const editingUnavailable = () => !painted() ? 'Select Painted Mask to use these actions' :
            node.vrpRegionBusy ? 'Region mask operation in progress' : readyCanvas();
        const actions = panel('Region mask actions', [
            { label: 'Edit mask', icon: 'edit', run: () => invoke('Edit region mask'), unavailable: editingUnavailable },
            { label: 'Clear mask', icon: 'clear', run: () => invoke('Clear region mask'), unavailable: () => editingUnavailable() ||
                (!node.vrpRegionState?.painted_mask.image_ref || node.vrpRegionMaskHasArea === false ? 'No painted region mask to clear' : '') },
        ]);
        const nameWeight = layout.addRow('Region name and weight', [
            { name: 'label', label: 'Name', minWidth: 150, grow: 1 },
            { name: 'weight', label: 'Weight', minWidth: 120, grow: 0, kind: 'number' },
        ]);
        ordering = [widget('region_editor'), widget('vrp_status'), mode, actions, nameWeight,
            widget('positive_prompt'), widget('negative_prompt')];
    } else if (node.comfyClass === 'VRPAdvancedSettingsUI') {
        const controller = node.vrpAdvancedSettingsController;
        const readOnly = () => String(widget('preset')?.value) === 'Custom' ? '' : 'Preset values are read-only; select Custom to edit';
        const raw = (name, extra = {}) => ({ name, label: name, minWidth: 170, kind: 'number', unavailable: readOnly, ...extra });
        const preset = layout.addRow('Routing preset', [
            { name: 'preset', label: 'Preset', minWidth: 180, values: ['VRP Recommended', 'Sen-sou Upstream Defaults', 'Custom'] },
        ]);
        const base = layout.addRow('Base routing', [
            raw('base_mode', { values: ['disabled','uncovered_only','global'] }),
        ]);
        const blend = layout.addRow('Base contribution', [raw('base_strength'), raw('base_ratio')]);
        const window = layout.addRow('Routing window', [raw('start_percent'), raw('end_percent')]);
        const masks = layout.addRow('Attention masks', [raw('cross_mask_strength'), raw('self_mask_strength')]);
        const intervals = layout.addRow('Injection intervals', [raw('cross_inject_every', {integer:true}), raw('self_inject_every', {integer:true})]);
        rows.push({update: () => controller.refresh()});
        ordering = [preset, base, blend, window, masks, intervals];
        expertSizing = installExpertSizing(node, layout);
    } else {
        ['Add region', 'Delete selected region'].forEach(suppress);
        const mix = layout.addRow('Global prompt processing', [
            { name: 'prompt_mix', label: 'Prompt Mix', minWidth: 180, kind: 'switch', inline: true },
        ]);
        const actions = panel('Region actions', [
            // Authoring remains possible when the generation inputs are missing.
            { label: 'Add region', icon: 'add', run: () => invoke('Add region') },
            { label: 'Delete region', icon: 'delete', danger: true, run: () => invoke('Delete selected region'), unavailable: () => internalSelected() ? '' : 'Select an internal region; external regions are owned by their Region nodes' },
        ]);
        const nameWeight = layout.addRow('Selected region name and weight', [
            { name: 'region_label', label: 'Name', minWidth: 150, grow: 1 },
            { name: 'region_weight', label: 'Weight', minWidth: 120, grow: 0, kind: 'number' },
        ], internalSelected, () => node.vrpSelectedRegion);
        ordering = [widget('bbox_editor'), widget('vrp_status'), mix, widget('selection'), actions,
            nameWeight, widget('region_prompt'), widget('region_negative_prompt')];
    }

    const draw = node.onDrawForeground;
    node.onDrawForeground = function(...args) { const result = draw?.apply(this, args); refresh(); return result; };
    const configure = node.onConfigure;
    node.onConfigure = function(...args) {
        const savedSize = args[0]?.size ? Array.from(args[0].size) : null;
        const result = configure?.apply(this, args);
        // Canvas restore is asynchronous, but its busy/readiness are derived on
        // every draw rather than copied into stale serialized button state.
        refresh();
        contentSizing?.restore(savedSize);
        // Fit the expert panel on reload too, rather than retaining the old
        // presentation's empty vertical space. Values stay intact; width is
        // constrained only enough to keep the expert's fixed pairs readable.
        if (compactExpert) {
            const minimum = node.computeSize?.();
            if (minimum) node.setSize?.([node.size[0], minimum[1]]);
        }
        return result;
    };
    const connections = node.onConnectionsChange;
    node.onConnectionsChange = function(...args) { const result = connections?.apply(this, args); refresh(); return result; };
    const remove = node.onRemoved;
    node.onRemoved = function(...args) {
        removed = true; panels.forEach(item => item.dispose()); expertSizing?.dispose(); contentSizing?.dispose(); layout.dispose();
        for (const item of suppressed) delete item.vrpPresentationHidden;
        return remove?.apply(this, args);
    };
    node.vrpPreviewUI = { refresh, layout, panels };
    refresh();
    // New preview nodes should not inherit the height of the eight-button UI
    // just hidden above. Workflow loading restores the saved user size later.
    if (compactExpert) {
        node.setSize?.([INITIAL_SIZES[node.comfyClass][0], node.computeSize()[1]]);
    } else {
        const loader = node.comfyClass === 'VRPCanvasUI' || node.comfyClass === 'VRPStandaloneImageLoader';
        contentSizing = installContentSizing(node, INITIAL_SIZES[node.comfyClass], loader ? 380 : 0);
    }
    fitVisibleWidgets(node); node.graph?.setDirtyCanvas(true, true);
}

app.registerExtension({
    name: 'AnimaVRP.ExperimentalUI',
    nodeCreated(node) { attachPreviewUI(node); },
});
