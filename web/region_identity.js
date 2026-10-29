import { app, observeValue, isRegionNode } from './classic_adapter.js';

function createId(used) {
    const uuidFallback = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, token => {
        const value = Math.floor(Math.random() * 16);
        return (token === 'x' ? value : (value & 0x3) | 0x8).toString(16);
    });
    const base = globalThis.crypto?.randomUUID?.() || uuidFallback();
    if (!used.has(base)) return base;
    let suffix = 2;
    while (used.has(`${base}-${suffix}`)) suffix++;
    return `${base}-${suffix}`;
}

function regionNodes(graph) {
    return (graph?._nodes || []).filter(isRegionNode);
}

function normalizeGraph(graph) {
    const nodes = regionNodes(graph);
    const ids = new Set();
    let changed = false;
    for (const node of nodes) {
        const identity = node.widgets?.find(widget => widget.name === 'region_id');
        if (!identity) continue;
        const current = String(identity.value ?? '').trim();
        if (!current || ids.has(current)) {
            identity.value = createId(ids);
            changed = true;
        }
        ids.add(String(identity.value));
    }

    const labels = new Set();
    let defaultIndex = 1;
    for (const node of nodes) {
        const labelWidget = node.widgets?.find(widget => widget.name === 'label');
        if (!labelWidget) continue;
        let label = String(labelWidget.value ?? '').trim();
        if (!label || label.toLocaleLowerCase() === 'region') {
            label = '';
            while (!label || labels.has(label.toLocaleLowerCase())) {
                label = `Region ${defaultIndex++}`;
            }
        }
        const base = label;
        let suffix = 2;
        while (labels.has(label.toLocaleLowerCase())) label = `${base} (${suffix++})`;
        if (label !== labelWidget.value) {
            labelWidget.value = label;
            changed = true;
        }
        labels.add(label.toLocaleLowerCase());
    }
    if (changed) {
        graph?.incrementVersion?.();
        graph?.setDirtyCanvas?.(true, true);
    }
}

app.registerExtension({
    name: 'AnimaVRP.RegionIdentity',
    nodeCreated(node) {
        if (!isRegionNode(node)) return;
        const identity = node.widgets?.find(widget => widget.name === 'region_id');
        if (identity) {
            identity.hidden = true;
            identity.type = 'hidden';
            identity.computeSize = () => [0, -4];
            observeValue(identity, () => schedule(node.graph));
        }
        const label = node.widgets?.find(widget => widget.name === 'label');
        if (label) observeValue(label, () => schedule(node.graph));

        let configured = false;
        const configure = node.onConfigure;
        node.onConfigure = function (...args) {
            configured = true;
            const result = configure?.apply(this, args);
            schedule(this.graph);
            return result;
        };
        const added = node.onAdded;
        node.onAdded = function (...args) {
            const result = added?.apply(this, args);
            schedule(this.graph);
            return result;
        };

        // A new node has not been configured from workflow data. Generate its
        // ID once after graph loading has had a chance to restore saved state.
        Promise.resolve().then(() => {
            if (!configured && node.graph && identity && String(identity.value ?? '').trim() === 'region-1') {
                identity.value = createId(new Set(regionNodes(node.graph).map(peer =>
                    String(peer.widgets?.find(widget => widget.name === 'region_id')?.value ?? ''),
                )));
            }
            schedule(node.graph);
        });
    },
});

let scheduled = new WeakSet();
function schedule(graph) {
    if (!graph || scheduled.has(graph)) return;
    scheduled.add(graph);
    Promise.resolve().then(() => {
        scheduled.delete(graph);
        normalizeGraph(graph);
    });
}
