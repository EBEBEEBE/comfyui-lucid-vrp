// Shared, instance-scoped DOM controls for the experimental classic UIs.
// No dependency on a frontend icon library or global styles/menu overrides.
const iconPaths = {
    edit: '<path d="m13 3 4 4-9 9-4 1 1-4zM3 20h14"/>',
    import: '<rect x="3" y="5" width="14" height="13" rx="2"/><path d="m4 16 4-4 3 3 2-2 3 3M14 3h6M17 0v6"/>',
    paste: '<rect x="4" y="4" width="12" height="15" rx="2"/><rect x="7" y="2" width="6" height="4" rx="1"/><path d="M7 11h6M7 15h6"/>',
    undo: '<path d="m7 4-4 4 4 4M3 8h8a6 6 0 0 1 0 12"/>',
    redo: '<path d="m13 4 4 4-4 4M17 8H9a6 6 0 0 0 0 12"/>',
    create: '<path d="M11 3H4v16h12V8l-5-5v5h5M10 11v6M7 14h6"/>',
    resize: '<path d="M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5M3 3l5 5M17 17l-5-5"/>',
    restore: '<path d="m5 3-3 4 4 2M2 7a8 8 0 1 1 0 6"/>',
    clear: '<path d="m11 3 6 6-8 8H5l-4-4 10-10zM6 8l6 6M9 17h9"/>',
    add: '<rect x="3" y="3" width="14" height="14" rx="2"/><path d="M10 6v8M6 10h8"/>',
    delete: '<path d="M3 5h14M7 5V2h6v3M5 5l1 13h8l1-13M8 8v7M12 8v7"/>',
    chevron: '<path d="m7 4 6 6-6 6"/>',
};

function icon(name) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    element.setAttribute('viewBox', '0 0 20 22'); element.setAttribute('aria-hidden', 'true');
    element.setAttribute('fill', 'none'); element.setAttribute('stroke', 'currentColor');
    element.setAttribute('stroke-width', '1.5'); element.setAttribute('stroke-linecap', 'round'); element.setAttribute('stroke-linejoin', 'round');
    element.innerHTML = iconPaths[name] || iconPaths.edit;
    return element;
}

export function installStyles() {
    if (document.getElementById('anima-vrp-ui-preview-style')) return;
    const style = document.createElement('style'); style.id = 'anima-vrp-ui-preview-style';
    style.textContent = `
      .anima-vrp-ui-preview { box-sizing:border-box; color:#ddd; font:12px/1.4 sans-serif; padding:5px 6px; user-select:none; }
      .anima-vrp-ui-preview * { box-sizing:border-box; }
      .anima-vrp-ui-preview input:not([type=checkbox]),.anima-vrp-ui-preview textarea,.anima-vrp-ui-preview [contenteditable=true] { user-select:text; }
      .anima-vrp-ui-preview input:disabled,.anima-vrp-ui-preview textarea:disabled { user-select:none; }
      .anima-vrp-ui-preview .vrp-ui-actions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; }
      .anima-vrp-ui-preview .vrp-ui-actions.three { grid-template-columns:repeat(3,minmax(0,1fr)); }
      .anima-vrp-ui-preview .vrp-ui-action-wrap { min-width:0; display:flex; }
      .anima-vrp-ui-preview button { color:#ddd; background:#292929; border:1px solid #666; border-radius:6px; font:inherit; cursor:pointer; }
      .anima-vrp-ui-preview button:not(:disabled):hover { background:#414750; border-color:#8894a4; }
      .anima-vrp-ui-preview button:not(:disabled):active { background:#4a586b; }
      .anima-vrp-ui-preview button:disabled { color:#999; background:#303030; border-color:#4b4b4b; cursor:not-allowed; }
      .anima-vrp-ui-preview button:focus-visible { outline:2px solid #b6cbe4; outline-offset:2px; }
      .anima-vrp-ui-preview .vrp-ui-action { width:100%; min-height:72px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:7px; padding:8px 5px; }
      .anima-vrp-ui-preview svg { width:20px; height:20px; flex-shrink:0; }
      .anima-vrp-ui-preview .vrp-ui-compact { display:flex; align-items:center; justify-content:center; gap:6px; width:100%; padding:6px 10px; min-height:32px; }
      .anima-vrp-ui-preview .vrp-ui-compact svg { width:15px; height:15px; }
      .anima-vrp-ui-preview .vrp-ui-danger:not(:disabled) { color:#e0a19c; }
      .anima-vrp-ui-preview .vrp-ui-note { color:#b8b8b8; margin-top:6px; font-size:12px; overflow-wrap:anywhere; }
      .anima-vrp-ui-preview .vrp-ui-section { border-radius:0; border-width:1px 0 0; width:100%; padding:8px 3px; display:flex; align-items:center; gap:7px; text-align:left; background:transparent; }
      .anima-vrp-ui-preview .vrp-ui-section svg { width:14px; height:14px; }
      .anima-vrp-ui-preview .vrp-ui-section[aria-expanded=true] svg { transform:rotate(90deg); }
      .anima-vrp-ui-preview .vrp-ui-source { display:flex; align-items:center; gap:8px; }
      .anima-vrp-ui-preview .vrp-ui-source label { flex:1; min-width:0; }
      .anima-vrp-ui-preview select { width:100%; color:#ddd; background:#292929; border:1px solid #666; border-radius:4px; font:inherit; padding:7px; }
      .anima-vrp-ui-preview.vrp-ui-fields { position:relative; padding:0 6px; }
      .anima-vrp-ui-preview .vrp-ui-size-frame { height:84px; background:#252525; display:flex; align-items:center; justify-content:center; border-radius:4px; }
      .anima-vrp-ui-preview .vrp-ui-size-shape { background:#355f87; border:1px solid #91abc7; border-radius:3px; }
      .anima-vrp-ui-preview .vrp-ui-size-preview { text-align:center; color:#bbb; font:inherit; }
      .anima-vrp-ui-preview .vrp-ui-size-preview > div:last-child { margin-top:4px; }
      .anima-vrp-ui-preview .vrp-ui-field { position:absolute; display:flex; flex-direction:column; gap:5px; min-width:0; height:52px; color:#bbb; }
      .anima-vrp-ui-preview .vrp-ui-field-control { display:flex; align-items:center; gap:3px; height:32px; min-width:0; }
      .anima-vrp-ui-preview .vrp-ui-field-control input:not([type=checkbox]),.anima-vrp-ui-preview .vrp-ui-field-control select { flex:1; min-width:0; width:100%; height:32px; padding:5px 7px; border:1px solid #666; border-radius:4px; color:#ddd; background:#292929; font:inherit; }
      .anima-vrp-ui-preview .vrp-ui-field-control input:disabled,.anima-vrp-ui-preview .vrp-ui-field-control select:disabled { color:#999; background:#303030; }
      .anima-vrp-ui-preview .vrp-ui-field-control input[aria-invalid=true] { border-color:#dc9ba8; }
      .anima-vrp-ui-preview .vrp-ui-field-control input:focus-visible,.anima-vrp-ui-preview .vrp-ui-field-control select:focus-visible { outline:2px solid #b6cbe4; outline-offset:1px; }
      .anima-vrp-ui-preview .vrp-ui-field-control button { width:23px; height:32px; flex-shrink:0; padding:0; }
      .anima-vrp-ui-preview .vrp-ui-field-horizontal { display:grid; height:32px; align-items:center; gap:8px; }
      .anima-vrp-ui-preview .vrp-ui-field-horizontal > span { white-space:nowrap; }
      .anima-vrp-ui-preview input[type=checkbox] { width:18px; height:18px; accent-color:#98b5d7; margin:0; }
      .anima-vrp-ui-preview .vrp-ui-field-inline { flex-direction:row; align-items:center; justify-content:space-between; height:40px; padding:4px 10px; background:#303b47; border-radius:4px; gap:10px; }
      .anima-vrp-ui-preview.vrp-ui-fields-expert .vrp-ui-field { height:45px; gap:2px; }
      .anima-vrp-ui-preview.vrp-ui-fields-expert .vrp-ui-field-control,
      .anima-vrp-ui-preview.vrp-ui-fields-expert .vrp-ui-field-control input:not([type=checkbox]),
      .anima-vrp-ui-preview.vrp-ui-fields-expert .vrp-ui-field-control select,
      .anima-vrp-ui-preview.vrp-ui-fields-expert .vrp-ui-field-control button { height:26px; }
      .anima-vrp-ui-preview.vrp-ui-fields-expert .vrp-ui-field-control input:not([type=checkbox]),
      .anima-vrp-ui-preview.vrp-ui-fields-expert .vrp-ui-field-control select { padding:3px 7px; }
      .anima-vrp-ui-preview .vrp-ui-field-inline > span { color:#b6cbe4; font-weight:700; }
      .anima-vrp-ui-preview .vrp-ui-field-control .vrp-ui-switch { position:relative; display:flex; align-items:center; width:92px; height:28px; padding:2px; border:1px solid #718093; border-radius:4px; background:#252b32; isolation:isolate; }
      .anima-vrp-ui-preview .vrp-ui-switch::before { content:''; position:absolute; left:2px; top:2px; bottom:2px; width:calc(50% - 2px); border-radius:2px; background:#526c88; z-index:-1; transform:translateX(0); }
      .anima-vrp-ui-preview .vrp-ui-switch[aria-checked=true]::before { transform:translateX(100%); }
      .anima-vrp-ui-preview .vrp-ui-switch span { flex:1; text-align:center; color:#aab6c3; }
      .anima-vrp-ui-preview .vrp-ui-switch[aria-checked=false] span:first-child,.anima-vrp-ui-preview .vrp-ui-switch[aria-checked=true] span:last-child { color:#f0f4f8; }
      .anima-vrp-ui-preview .vrp-ui-switch:disabled { opacity:.6; }
      .anima-vrp-ui-preview .vrp-ui-field-thumb { background:transparent; padding:0; }
      .anima-vrp-ui-preview .vrp-ui-field-thumb > span { color:#ddd; }
      .anima-vrp-ui-preview .vrp-ui-field-thumb .vrp-ui-switch { width:72px; height:32px; padding:4px 6px; border-radius:16px; gap:6px; }
      .anima-vrp-ui-preview .vrp-ui-field-thumb .vrp-ui-switch::before { display:none; }
      .anima-vrp-ui-preview .vrp-ui-field-thumb .vrp-ui-switch[aria-checked=true] { background:#3b5368; }
      .anima-vrp-ui-preview .vrp-ui-field-thumb .vrp-ui-switch span:last-child { flex:none; width:20px; height:20px; border-radius:50%; background:#ddd; }
      .anima-vrp-ui-preview .vrp-ui-field-thumb .vrp-ui-switch[aria-checked=false] span:last-child { order:-1; }
      @media(pointer:coarse) { .anima-vrp-ui-preview .vrp-ui-compact,.anima-vrp-ui-preview .vrp-ui-section { min-height:44px; } }
    `;
    document.head.append(style);
}

export function actionPanel(node, name, actions, { compact = false, columns = 2, note = '' } = {}) {
    installStyles();
    const container = document.createElement('div'); container.className = 'anima-vrp-ui-preview';
    container.setAttribute('aria-label', name);
    const grid = document.createElement('div'); grid.className = `vrp-ui-actions${columns === 3 ? ' three' : ''}`;
    grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    container.append(grid);
    const entries = actions.map(action => {
        const wrapper = document.createElement('span'); wrapper.className = 'vrp-ui-action-wrap';
        const button = document.createElement('button'); button.type = 'button';
        button.className = `${compact ? 'vrp-ui-compact' : 'vrp-ui-action'}${action.danger ? ' vrp-ui-danger' : ''}`;
        button.append(icon(action.icon)); const text = document.createElement('span'); text.textContent = action.label; button.append(text);
        button.setAttribute('aria-label', action.label); wrapper.append(button); grid.append(wrapper);
        const clicked = async () => {
            refresh(); if (button.disabled) return;
            running = true; refresh(); node.graph?.setDirtyCanvas(true, true);
            try { await action.run?.(); }
            finally { running = false; refresh(); node.vrpPreviewUI?.refresh(); node.vrpFitWidgets?.(); node.graph?.setDirtyCanvas(true, true); }
        };
        button.addEventListener('click', clicked);
        return { action, button, wrapper, clicked };
    });
    let running = false;
    const stop = event => event.stopPropagation(); container.addEventListener('pointerdown', stop);
    container.addEventListener('wheel', stop, { passive: true });
    if (note) { const text = document.createElement('div'); text.className = 'vrp-ui-note'; text.textContent = note; container.append(text); }
    const height = () => Math.ceil(actions.length / columns) * (compact ? 36 : 76) + (note ? 38 : 10);
    const widget = node.addDOMWidget(name, 'vrp-ui-actions', container, { serialize: false, hideOnZoom: true, margin: 0,
        getValue: () => '', setValue: () => {}, getHeight: height, getMinHeight: height, getMaxHeight: height });
    widget.serialize = false;
    function refresh() {
        for (const { action, button, wrapper } of entries) {
            const reason = action.unavailable?.() || '';
            button.disabled = running || !!reason; button.title = running ? 'Operation in progress' : reason || action.hint || action.label;
            wrapper.title = button.title; button.setAttribute('aria-busy', String(running));
        }
    }
    refresh();
    return { widget, entries, refresh, dispose() { entries.forEach(({ button, clicked }) => button.removeEventListener('click', clicked)); container.removeEventListener('pointerdown', stop); container.removeEventListener('wheel', stop); } };
}

export function sectionHeader(node, name, isOpen, toggle) {
    const panel = actionPanel(node, name, [{ label: name, icon: 'chevron', run: toggle }], { compact: true, columns: 1 });
    const button = panel.entries[0].button; button.className = 'vrp-ui-section';
    const refresh = panel.refresh; panel.refresh = () => { refresh(); button.setAttribute('aria-expanded', String(isOpen())); };
    panel.refresh(); return panel;
}

export function restorePanel(node, controller) {
    const select = document.createElement('select'); select.setAttribute('aria-label', 'Retained canvas source');
    for (const [value, text] of [['blank', 'Last blank'], ['imported', 'Last imported']]) {
        const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
    }
    select.value = 'blank';
    const panel = actionPanel(node, 'Restore source', [{ label: 'Restore', icon: 'restore', run: () => controller.restore(select.value),
        unavailable: () => !controller.idle ? 'Canvas operation in progress' : !controller.state?.retained[select.value] ? 'No retained source of this kind' : '' }], { compact: true, columns: 1 });
    const container = panel.widget.element, grid = container.children[0];
    const label = document.createElement('label'); label.append(select); grid.className = 'vrp-ui-source'; grid.prepend(label);
    const refresh = panel.refresh;
    panel.refresh = () => { select.disabled = !controller.idle; refresh(); };
    select.addEventListener('change', panel.refresh); panel.refresh();
    const dispose = panel.dispose; panel.dispose = () => { select.removeEventListener('change', panel.refresh); dispose(); };
    return panel;
}
