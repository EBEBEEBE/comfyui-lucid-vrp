// DOM views over original named widgets, not a parallel value/state store.
import { app } from './classic_adapter.js';
import { installStyles } from './ui_preview_controls.js';

const linked = (node, widget) => node.inputs?.some(input => input.widget?.name === widget.name && input.link != null);
const choices = field => {
    const values = field.values ?? field.widget.options?.values;
    return typeof values === 'function' ? values.call(field.widget) : values;
};
const increment = widget => Number(widget.options?.step2 || (widget.options?.step || 10) * .1);

export function fieldPanel(node, name, fields, cells, binding, compact = false, presentation = {}) {
    installStyles();
    const container = document.createElement('div'); container.className = 'anima-vrp-ui-preview vrp-ui-fields';
    if (compact) container.className += ' vrp-ui-fields-expert';
    container.setAttribute('aria-label', name);
    const entries = [], cleanups = [];
    const listen = (element, type, handler) => {
        element.addEventListener(type, handler); cleanups.push(() => element.removeEventListener(type, handler));
    };
    const stop = event => event.stopPropagation();
    for (const type of ['pointerdown', 'keydown', 'keyup', 'wheel']) listen(container, type, stop);
    for (const field of fields) {
        const source = field.widget, box = document.createElement('div'); box.className = 'vrp-ui-field';
        if (field.inline) box.className += ' vrp-ui-field-inline';
        if (field.horizontal) {
            box.className += ' vrp-ui-field-horizontal';
            box.style.gridTemplateColumns = `${field.labelWidth ?? 110}px minmax(0,1fr)`;
        }
        if (field.switchStyle === 'thumb') box.className += ' vrp-ui-field-thumb';
        const heading = document.createElement('span'); heading.textContent = field.label; box.append(heading);
        const select = !!choices(field), toggle = field.kind === 'toggle' || source.type === 'toggle';
        const switchControl = field.kind === 'switch';
        const numeric = !select && (field.kind === 'number' || source.type === 'number');
        const input = document.createElement(switchControl ? 'button' : select ? 'select' : 'input');
        input.setAttribute('aria-label', field.ariaLabel ?? field.label);
        if (switchControl) {
            input.type = 'button'; input.className = 'vrp-ui-switch'; input.setAttribute('role', 'switch');
            for (const text of field.switchStyle === 'thumb' ? ['ON', ''] : ['OFF', 'ON']) {
                const label = document.createElement('span'); label.textContent = text; label.setAttribute('aria-hidden', 'true'); input.append(label);
            }
        } else if (!select) { input.type = toggle ? 'checkbox' : 'text'; if (numeric) input.inputMode = 'decimal'; }
        const control = document.createElement('div'); control.className = 'vrp-ui-field-control';
        let minus, plus;
        if (numeric) {
            minus = document.createElement('button'); plus = document.createElement('button');
            for (const [button, text, direction] of [[minus, '−', -1], [plus, '+', 1]]) {
                button.type = 'button'; button.textContent = text; button.setAttribute('aria-label', `${direction < 0 ? 'Decrease' : 'Increase'} ${field.ariaLabel ?? field.label}`);
                listen(button, 'click', event => write(Number(source.value) + direction * increment(source), event));
            }
            control.append(minus, input, plus);
        } else control.append(input);
        box.append(control); container.append(box);
        let focusBinding, focusValue, editing = false, optionSignature;
        const unavailable = () => field.unavailable?.() || '';
        const disabled = () => source.disabled || linked(node, source) || node.imageDocumentController?.idle === false || unavailable();
        const display = () => {
            if (switchControl) {
                input.setAttribute('aria-checked', String(!!source.value));
                if (field.switchStyle === 'thumb') input.children[0].textContent = source.value ? 'ON' : 'OFF';
            }
            else if (toggle) input.checked = !!source.value;
            else input.value = String(source.value ?? '');
            input.setAttribute('aria-invalid', 'false');
        };
        function write(value, event) {
            if (disabled()) { display(); return; }
            if (field.optionUnavailable?.(value)) { display(); return; }
            if (numeric) {
                if (!Number.isFinite(value)) { input.setAttribute('aria-invalid', 'true'); return; }
                const options = source.options || {};
                value = Math.max(options.min ?? -Infinity, Math.min(options.max ?? Infinity, value));
                if (field.integer) value = Math.round(value);
                value = Number(value.toFixed(10));
            }
            if (typeof source.setValue === 'function') source.setValue(value, { e: event, canvas: app.canvas, node });
            else if (source.value !== value) {
                const old = source.value;
                source.value = value;
                if (source.options?.property && node.properties?.[source.options.property] !== undefined) node.setProperty?.(source.options.property, value);
                source.callback?.call(source, source.value, app.canvas, node, app.canvas?.graph_mouse, event);
                node.onWidgetChanged?.(source.name, source.value, old, source);
                node.graph?.incrementVersion?.();
            }
            // Callbacks may normalize names/weights or change other widgets.
            editing = false; display(); node.vrpPreviewUI?.refresh(); node.vrpFitWidgets?.();
            node.graph?.setDirtyCanvas(true, true);
        }
        const commit = event => {
            if (focusBinding !== undefined && focusBinding !== binding()) { editing = false; display(); return; }
            if (numeric && !String(input.value).trim()) { input.setAttribute('aria-invalid', 'true'); return; }
            write(toggle ? input.checked : select ? choices(field).find(value => String(value) === input.value) : numeric ? Number(input.value) : input.value, event);
        };
        if (switchControl) listen(input, 'click', event => {
            // Pointer halves explicitly choose OFF/ON. Native button keyboard
            // activation (Enter/Space, detail 0) toggles the current value.
            const bounds = input.getBoundingClientRect?.();
            const value = field.switchStyle !== 'thumb' && event.detail > 0 && bounds && Number.isFinite(event.clientX)
                ? event.clientX >= bounds.left + bounds.width / 2 : !source.value;
            write(value, event);
        });
        else {
            listen(input, 'focus', () => { editing = true; focusBinding = binding(); focusValue = source.value; });
            listen(input, 'change', commit);
            listen(input, 'blur', event => { if (editing) commit(event); editing = false; display(); });
        }
        listen(input, 'keydown', event => {
            if (switchControl) {
                if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
                    event.preventDefault(); write(['ArrowRight','End'].includes(event.key), event);
                }
            } else if (event.key === 'Enter' && !select && !toggle) { event.preventDefault(); commit(event); }
            else if (event.key === 'Escape') { event.preventDefault(); editing = false; display(); }
            else if (numeric && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
                event.preventDefault(); write(Number(source.value) + (event.key === 'ArrowUp' ? 1 : -1) * increment(source), event);
            }
        });
        function refresh() {
            if (select) {
                const values = choices(field) || [], signature = JSON.stringify(values);
                if (signature !== optionSignature) {
                    optionSignature = signature; input.replaceChildren();
                    for (const value of values) { const option = document.createElement('option'); option.value = String(value); option.textContent = String(value); input.append(option); }
                }
                for(const option of input.children){const reason=field.optionUnavailable?.(option.value)||'';option.disabled=!!reason;option.title=reason;}
            }
            const inactive = !!disabled(); input.disabled = inactive;
            box.title = linked(node, source) ? 'Controlled by a connected input' : unavailable() || (inactive ? 'Control unavailable' : field.hint?.() || '');
            if (minus) { minus.disabled = inactive || Number(source.value) <= (source.options?.min ?? -Infinity); plus.disabled = inactive || Number(source.value) >= (source.options?.max ?? Infinity); }
            if (!editing || focusBinding !== binding() || focusValue !== source.value || inactive) {
                editing = false; display();
            }
        }
        entries.push({ field, box, input, minus, plus, refresh });
    }
    const margin = compact ? 3 : 10;
    const height = () => Math.max(...cells().map(cell => cell.top + (compact ? 45 : cell.inline ? 40 : cell.horizontal ? 32 : 52)), presentation.contentHeight?.() ?? 0) + 2 * margin;
    const widget = node.addDOMWidget(name, 'vrp-ui-fields', container, { serialize: false, hideOnZoom: true, margin,
        getValue: () => '', setValue: () => {}, getMinHeight: height, getMaxHeight: height, getHeight: height });
    widget.serialize = false;
    const decoration = presentation.decorate?.(container);
    function refresh() {
        const positions = cells();
        entries.forEach((entry, index) => {
            const cell = positions[index];
            Object.assign(entry.box.style, { left: `${cell.x + 6}px`, top: `${cell.top}px`, width: `${cell.width}px` });
            entry.refresh();
        });
        decoration?.refresh();
    }
    refresh(); return { widget, fields, entries, refresh, dispose: () => { cleanups.forEach(cleanup => cleanup()); decoration?.dispose(); } };
}
