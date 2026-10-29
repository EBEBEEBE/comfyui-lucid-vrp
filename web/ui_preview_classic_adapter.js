// Classic presentation ordering. Named value holders stay in the original
// widgets array; custom DOM fields do not own serialized values.
import { setWidgetVisible } from './region_ui.js';
import { fieldPanel } from './ui_preview_fields.js';

export function fieldCells(fields, width, compact = false) {
    // Native DOM margin plus the panel's 6px padding.
    const margin = compact ? 3 : 10;
    const gap = 8;
    const minimum = fields.reduce((sum, field) => sum + field.minWidth, 0) + gap * Math.max(0, fields.length - 1);
    const available = Math.max(compact ? minimum : 80, width - 2 * margin - 12);
    const rows = [];
    let row = [], used = 0;
    for (const field of fields) {
        if (!compact && row.length && used + gap + field.minWidth > available) { rows.push(row); row = []; used = 0; }
        used += (row.length ? gap : 0) + field.minWidth; row.push(field);
    }
    if (row.length) rows.push(row);
    return rows.flatMap((row, rowIndex) => {
        const minimum = row.reduce((sum, field) => sum + field.minWidth, 0) + gap * (row.length - 1);
        const extra = Math.max(0, available - minimum);
        const grow = row.reduce((sum, field) => sum + (field.grow ?? 1), 0);
        let x = 0;
        return row.map(field => {
            const w = Math.min(available, field.minWidth + (grow ? extra * (field.grow ?? 1) / grow : 0));
            const cell = { ...field, x, top: rowIndex * (compact ? 48 : 58), width: w }; x += w + gap; return cell;
        });
    });
}

// Only the expert UI has fixed pairs and content-height sizing. Measure the
// native arranged widgets instead of guessing the host's slot/bottom padding.
export function installExpertSizing(node, layout) {
    const minimumWidth = Math.max(...layout.rows.map(row =>
        row.fields.reduce((sum, field) => sum + field.minWidth, 0) + 8 * (row.fields.length - 1) + 18));
    const originalCompute = node.computeSize, originalArrange = node.arrange, originalResize = node.onResize;
    let contentHeight, resizing = false;
    node.arrange = function(...args) {
        this.size[0] = Math.max(minimumWidth, this.size[0]);
        const result = originalArrange?.apply(this, args);
        const last = layout.rows.at(-1)?.widget;
        const y = last?.y ?? last?.last_y;
        const height = last?.computedHeight ?? last?.options?.getHeight?.() ?? last?.computeSize?.()[1];
        if (Number.isFinite(y) && Number.isFinite(height)) contentHeight = y + height + 3;
        return result;
    };
    node.computeSize = function(...args) {
        const size = originalCompute?.apply(this, args) ?? [...this.size];
        size[0] = Math.max(minimumWidth, size[0]);
        if (contentHeight !== undefined) size[1] = contentHeight;
        return size;
    };
    node.onResize = function(...args) {
        const result = originalResize?.apply(this, args);
        this.size[0] = Math.max(minimumWidth, this.size[0]);
        if (!resizing) {
            resizing = true;
            try {
                this.arrange?.();
                if (contentHeight !== undefined) this.size[1] = contentHeight;
            } finally { resizing = false; }
        }
        return result;
    };
    return { dispose() {
        node.computeSize = originalCompute; node.arrange = originalArrange; node.onResize = originalResize;
    } };
}

// Classic computeSize uses intrinsic/minimum widget heights, not the extra
// space distributed to growable textareas by arrange. Keep user-added space
// separately so removing controls can shrink without an arrange feedback loop.
export function installContentSizing(node, initialSize, minimumWidth = 0) {
    const originalArrange = node.arrange, originalResize = node.onResize, originalCompute = node.computeSize;
    const previousFit = node.vrpFitContent;
    let fitting = false, arranging = false, extra = 0, lastMinimum = 0, appliedSize;
    const minimum = () => node.computeSize?.()?.[1] ?? node.size[1];
    node.size[0] = Math.max(minimumWidth, initialSize[0]);
    if (minimumWidth) node.computeSize = function(...args) {
        const size = originalCompute?.apply(this, args) ?? [...this.size];
        return [Math.max(minimumWidth, size[0]), size[1]];
    };
    lastMinimum = minimum();
    extra = Math.max(0, initialSize[1] - lastMinimum);
    function fit() {
        if (fitting || arranging) return;
        fitting = true;
        try {
            node.size[0] = Math.max(minimumWidth, node.size[0]);
            // Some recreation tools copy size directly rather than setSize.
            if (appliedSize && Math.abs(node.size[1] - appliedSize[1]) > 0.5)
                extra = Math.max(0, node.size[1] - minimum());
            lastMinimum = minimum();
            const height = lastMinimum + extra;
            if (Math.abs(node.size[1] - height) > 0.5) node.setSize?.([node.size[0], height]);
            appliedSize = [...node.size];
        } finally { fitting = false; }
    }
    node.vrpFitContent = fit;
    node.onResize = function(...args) {
        this.size[0] = Math.max(minimumWidth, this.size[0]);
        const result = originalResize?.apply(this, args);
        if (!fitting && !arranging) {
            lastMinimum = minimum();
            extra = Math.max(0, this.size[1] - lastMinimum);
            appliedSize = [...this.size];
            fit();
        }
        return result;
    };
    node.arrange = function(...args) {
        fit();
        const previous = arranging; arranging = true;
        try { return originalArrange?.apply(this, args); }
        finally { arranging = previous; appliedSize = [...node.size]; }
    };
    fit();
    return {
        // Workflow configure writes size directly; retain it rather than
        // applying a new-node default on every load.
        restore(size) {
            if (size?.length === 2 && size.every(Number.isFinite)) {
                node.size[0] = Math.max(minimumWidth, size[0]);
                lastMinimum = minimum();
                extra = Math.max(0, size[1] - lastMinimum);
                node.size[1] = size[1]; appliedSize = [...node.size];
                fit();
            }
        },
        dispose() {
            node.arrange = originalArrange; node.onResize = originalResize;
            if (minimumWidth) node.computeSize = originalCompute;
            if (previousFit) node.vrpFitContent = previousFit; else delete node.vrpFitContent;
        },
    };
}

export function installClassicLayout(node, order, excluded = new Set(), compact = false) {
    const rows = [];
    const originalLayout = node.getLayoutWidgets, originalArrange = node.arrange;
    const sourceLayout = () => originalLayout?.call(node) ?? node.widgets.filter(w => !w.hidden);
    node.getLayoutWidgets = function() {
        for (const row of rows) row.sync();
        const preferred = order().filter(w => w && !w.hidden), used = new Set(preferred);
        return [...preferred, ...sourceLayout().filter(w => !used.has(w) && !excluded.has(w))];
    };
    node.arrange = function(...args) {
        const result = originalArrange?.apply(this, args);
        for (const row of rows) row.position();
        return result;
    };
    function addRow(name, specs, visible = () => true, binding = () => node.id, presentation = {}) {
        const fields = specs.map(field => ({ ...field, widget: node.widgets.find(w => w.name === field.name) })).filter(field => field.widget);
        fields.forEach(field => { excluded.add(field.widget); field.widget.vrpPresentationHidden = true; });
        const cells = () => presentation.cells?.(fields, node.size[0]) ?? fieldCells(fields, node.size[0], compact);
        const panel = fieldPanel(node, name, fields, cells, binding, compact, presentation);
        const sync = () => {
            fields.forEach(field => setWidgetVisible(field.widget, false));
            setWidgetVisible(panel.widget, visible()); panel.refresh();
        };
        const position = () => {
            if (panel.widget.hidden) return;
            // Existing converted connections remain guarded and positioned.
            // No custom conversion menu or new input sockets are added.
            for (const cell of cells()) {
                const margin = compact ? 3 : 10;
                const child = cell.widget, y = (panel.widget.y ?? panel.widget.last_y ?? 0) + margin + cell.top + (compact ? 19 : cell.horizontal || cell.inline ? 0 : 24);
                for (const input of node.inputs || []) if (input.widget?.name === child.name) {
                    input.pos = [margin + cell.x, y + (compact ? 13 : 16)];
                    const slot = node._concreteInputs?.find(slot => slot.widget?.name === child.name);
                    if (slot) slot.pos = input.pos;
                    node._measureSlot?.(slot || input, node.inputs.indexOf(input), true);
                }
            }
        };
        rows.push({ ...panel, sync, position }); sync(); return panel.widget;
    }
    return { addRow, rows, excluded, refresh: () => rows.forEach(row => row.sync()), dispose() {
        node.getLayoutWidgets = originalLayout; node.arrange = originalArrange;
        rows.forEach(row => { row.dispose(); row.fields.forEach(field => { delete field.widget.vrpPresentationHidden; setWidgetVisible(field.widget, true); }); });
    } };
}
