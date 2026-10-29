import { app, ComfyApp } from '../../scripts/app.js';
import { api } from '../../scripts/api.js';

const canvasPreferenceStores=new Map();
export function canvasPreferences(){
    // Native userdata APIs resolve the active ComfyUI user on the server. Do
    // not share cached settings across accounts in the same frontend session.
    const user=api.user??'';
    if(!canvasPreferenceStores.has(user))canvasPreferenceStores.set(user,(async()=>{
        const {loadPreferences,PREFERENCES_FILE}=await import('./canvas_v1_preferences.js');
        return loadPreferences({
            async read(signal){
                if((api.user??'')!==user)throw Error('ComfyUI user changed');
                const response=await api.getUserData(PREFERENCES_FILE,{signal});
                if(response.status===404)return null;
                if(!response.ok)throw Error('Preference read failed');
                if(Number(response.headers.get('content-length'))>32768)throw Error('Preference file is too large');
                const text=await response.text();if(text.length>32768)throw Error('Preference file is too large');
                const value=JSON.parse(text);if(value===null)throw Error('Preference file must be an object');return value;
            },
            async write(value,signal){
                // ComfyUI performs the temporary-file + replace operation. Capture
                // identity so a queued save cannot be redirected after switching user.
                if((api.user??'')!==user)throw Error('ComfyUI user changed');
                const response=await api.storeUserData(PREFERENCES_FILE,value,{overwrite:true,stringify:true,throwOnError:true,full_info:false,signal,keepalive:true});
                if(!response.ok)throw Error('Preference save failed');
            },
        });
    })());
    return canvasPreferenceStores.get(user);
}

export const canvasEvents = new EventTarget();
const ownedPreviews = new WeakMap();

function ownPreview(node, images) {
    // Core useNodeImage has no stale-load cancellation. Once Canvas Builder owns
    // its preview, only this adapter publishes pixels. Core editor saves still
    // reach our state controller through image.value, not through preview pixels.
    if (!ownedPreviews.has(node)) {
        Object.defineProperty(node, 'imgs', {
            configurable: true,
            get() { return ownedPreviews.get(this); },
            set(_images) { /* Ignore late core preview completions. */ },
        });
    }
    ownedPreviews.set(node, images);
}

function syncPreviewCache(node, refs) {
    // Classic root-node output maps use the node ID. Subgraph preview support
    // remains deferred; do not guess its locator format.
    if (node.graph !== app.rootGraph && node.graph !== app.graph) return;
    const key = String(node.id);
    if (app.nodeOutputs) {
        const output = app.nodeOutputs[key];
        if (output) output.images = refs;
        else app.nodeOutputs[key] = { images: refs };
        // Read back the stored array: the legacy map can be reactive/proxied.
        node.images = app.nodeOutputs[key].images;
    }
    if (app.nodePreviewImages) delete app.nodePreviewImages[key];
    node.preview = undefined;
}
export function publish(node, state) {
    node.vrpCanvasState = Object.freeze({ ...state });
    canvasEvents.dispatchEvent(new CustomEvent('canvas-changed', {
        detail: { nodeId: node.id, graphId: node.graph?.id, state: node.vrpCanvasState },
    }));
    node.graph?.setDirtyCanvas(true, true);
}
export function clearPublishedCanvas(node) {
    const changed = node.vrpCanvasState != null || node.vrpCanvasImage != null;
    node.vrpCanvasState = null;
    node.vrpCanvasImage = null;
    if (changed) {
        canvasEvents.dispatchEvent(new CustomEvent('canvas-changed', {
            detail: { nodeId: node.id, graphId: node.graph?.id, state: null },
        }));
    }
    node.graph?.setDirtyCanvas(true, true);
}
export function imageURL(name, channel = 'rgb') {
    const match = /^(.*?)(?:\s*\[(input|output|temp)\])?$/.exec(name);
    const path = match[1].trim().replaceAll('\\', '/');
    const slash = path.lastIndexOf('/');
    const ref = { filename: path.slice(slash + 1), subfolder: path.slice(0, Math.max(0, slash)), type: match[2] || 'input' };
    return { ref, url: api.apiURL('/view?' + new URLSearchParams({...ref, channel})) };
}
export async function upload(blob, filename, originalRef = null) {
    const data = new FormData();
    data.append('image', blob, filename);
    data.append('type', 'input');
    if (originalRef) data.append('original_ref', JSON.stringify(originalRef));
    const response = await api.fetchApi(originalRef ? '/upload/mask' : '/upload/image', { method: 'POST', body: data });
    if (!response.ok) throw new Error(`Upload failed (${response.status})`);
    const result = await response.json();
    return `${result.subfolder ? result.subfolder + '/' : ''}${result.name} [${result.type}]`;
}
export function showImage(node, image, ref) {
    ownPreview(node, image ? [image] : []);
    node.images = ref ? [ref] : [];
    syncPreviewCache(node, node.images);
    node.imageIndex = 0;
    node.previewMediaType = image ? 'image' : undefined;
    node.graph?.setDirtyCanvas(true, true);
}
export function showEditorImage(node, image, ref) {
    // Classic background drawing restores node.images from the output store.
    // Publish editor/clear sources there too so an older saved mask cannot be
    // restored during editing and mistaken for a new Mask Editor save.
    node.images = ref ? [ref] : [];
    syncPreviewCache(node, node.images);
    node.imgs = image ? [image] : [];
    node.imageIndex = 0;
    node.previewMediaType = image ? 'image' : undefined;
    node.graph?.setDirtyCanvas(true, true);
}
export function openEditor(node) {
    // Current classic ComfyUI retains this compatibility bridge to its editor.
    if (typeof ComfyApp.open_maskeditor !== 'function') throw new Error('Core Mask Editor is unavailable');
    const previous = ComfyApp.clipspace_return_node ?? null;
    try {
        ComfyApp.copyToClipspace(node);
        ComfyApp.clipspace_return_node = node;
        // The supported Vue editor captures this node synchronously. It saves
        // directly to that node, without the legacy Clipspace return callback.
        ComfyApp.open_maskeditor();
    } finally {
        // Leaving this set suppresses image/Clipspace menus on every node.
        ComfyApp.clipspace_return_node = previous;
    }
}

export function hideNativeImagePreview(node) {
    // Keep core image loading and node.images save notifications intact; hide
    // only the redundant classic preview widget on this particular node.
    const prior = node.onDrawBackground;
    node.onDrawBackground = function (...args) {
        const result = prior?.apply(this, args);
        const widget = this.widgets?.find(item => item.name === '$$canvas-image-preview');
        if (widget) {
            widget.hidden = true;
            widget.serialize = false;
            widget.computeSize = () => [0, -4];
            widget.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0 });
            widget.draw = () => {};
        }
        return result;
    };
}
export { app };

// Treat presentation aliases as their original node family during live sync,
// identity allocation and typed region-chain traversal. No backend type changes.
export const isRegionNode = node => ['VRPRegion', 'VRPRegionUI'].includes(node?.comfyClass ?? node?.name);
export const isCoreNode = node => ['AnimaVRP', 'AnimaVRPUI'].includes(node?.comfyClass ?? node?.name);
export const isDocumentCanvasNode = node => ['VRPCanvas', 'VRPCanvasUI'].includes(node?.comfyClass ?? node?.name);

export function observeValue(widget, changed) {
    // ComfyUI's native DOM widgets install a non-configurable own accessor.
    // Keep it intact: its setter delegates through options.setValue and then
    // runs the native callback. Observe that delegation instead of redefining
    // value (which aborts nodeCreated before restoration/live-sync are wired).
    const own = Object.getOwnPropertyDescriptor(widget, 'value');
    if (own && !own.configurable) {
        const setter = widget.options?.setValue;
        if (typeof setter !== 'function') return false;
        widget.options.setValue = function(...args) {
            const old = widget.value;
            const result = setter.apply(this, args);
            if (widget.value !== old) changed();
            return result;
        };
        return true;
    }
    let owner = widget, descriptor;
    while (owner && !descriptor) {
        descriptor = Object.getOwnPropertyDescriptor(owner, 'value');
        owner = Object.getPrototypeOf(owner);
    }
    let stored = widget.value;
    Object.defineProperty(widget, 'value', {
        configurable: true, enumerable: true,
        get() { return descriptor?.get ? descriptor.get.call(this) : stored; },
        set(value) {
            const old = this.value;
            if (descriptor?.set) descriptor.set.call(this, value); else stored = value;
            if (this.value !== old) changed();
        },
    });
    return true;
}

// Workflow configure data is independent of the native widget/store lifecycle.
// Recent classic frontends save named values; older workflows only have the
// positional array. Return a wrapper so a saved null is not confused with absence.
export function configuredWidgetValue(node, info, name) {
    if (info?.widgets_values_named && Object.hasOwn(info.widgets_values_named, name))
        return {value:info.widgets_values_named[name]};
    const index=(node.widgets || []).filter(w=>w.serialize!==false).findIndex(w=>w.name===name);
    if(index>=0 && info?.widgets_values && index<info.widgets_values.length)
        return {value:info.widgets_values[index]};
    return undefined;
}

export function writeSerializedWidgetValue(node, info, name, value) {
    const index=(node.widgets || []).filter(w=>w.serialize!==false).findIndex(w=>w.name===name);
    if(index>=0 && info?.widgets_values)info.widgets_values[index]=value;
    if(info?.widgets_values_named)info.widgets_values_named[name]=value;
}

export function observeProperty(target, name, changed) {
    let owner = target, descriptor;
    while (owner && !descriptor) {
        descriptor = Object.getOwnPropertyDescriptor(owner, name);
        owner = Object.getPrototypeOf(owner);
    }
    let stored = target[name];
    Object.defineProperty(target, name, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() { return descriptor?.get ? descriptor.get.call(this) : stored; },
        set(value) {
            const old = this[name];
            if (descriptor?.set) descriptor.set.call(this, value); else stored = value;
            const current = this[name];
            if (current !== old) changed(current, old);
        },
    });
}

export function installDrop(node, receive) {
    const prior = node.onDragDrop;
    node.onDragOver = event => Array.from(event.dataTransfer?.items || []).some(i => i.type.startsWith('image/'));
    node.onDragDrop = async event => {
        const file = Array.from(event.dataTransfer?.files || []).find(f => f.type.startsWith('image/'));
        if (!file) return prior?.call(node, event) || false;
        await receive(file);
        return true;
    };
}

export function rawLinkedNode(node, inputName) {
    const input = node.inputs?.find(slot => slot.name === inputName);
    const linkId = input?.link;
    if (linkId == null || !node.graph) return null;
    const links = node.graph.links ?? node.graph._links;
    const link = links?.get?.(linkId) ?? links?.[linkId];
    if (!link) return null;
    return node.graph.getNodeById?.(link.origin_id) ??
        node.graph._nodes?.find(candidate => String(candidate.id) === String(link.origin_id)) ?? null;
}

// Match the installed classic frontend's typed BYPASS traversal.
export function linkedNode(node, inputName, visited=new Set()) {
    const source=rawLinkedNode(node,inputName);
    if(!source || source.mode===2 || visited.has(source)) return null;
    if(source.mode!==4) return source;
    visited.add(source);
    const input=node.inputs?.find(slot=>slot.name===inputName);
    const links=node.graph?.links??node.graph?._links;
    const link=links?.get?.(input?.link) ?? links?.[input?.link];
    const slot=link?.origin_slot ?? 0;
    const inputs=source.inputs||[], same=inputs[slot], outputType=source.outputs?.[slot]?.type??input?.type;
    const compatible=(left,right)=>left===right||left==='*'||right==='*'||left===''||right==='';
    const match=input?.type==='*'||input?.type==='' ? (same||inputs[0]) :
        same && compatible(same.type,outputType) && compatible(same.type,input?.type) ? same :
        inputs.find(candidate=>candidate.type===input?.type) ||
        inputs.find(candidate=>compatible(candidate.type,outputType)&&compatible(candidate.type,input?.type));
    return match ? linkedNode(source,match.name,visited) : null;
}

export function locateNode(node) {
    if(!node || app.canvas?.graph!==node.graph) return false;
    app.canvas.deselectAllNodes?.();app.canvas.selectNode?.(node);
    node.updateArea?.();app.canvas.animateToBounds?.(node.boundingRect);
    app.canvas.setDirty?.(true,true);return true;
}

export function fitVisibleWidgets(node) {
    if (node.vrpFitContent) return node.vrpFitContent();
    const minimum=node.computeSize?.();
    if(minimum && minimum[1]>node.size[1])node.setSize?.([node.size[0],minimum[1]]);
}

export function inputSignature(node, name) {
    const seen=new Set(), data=[];
    const linkInfo=(current,input)=>{
        const links=current.graph?.links??current.graph?._links;
        const link=links?.get?.(input?.link)??links?.[input?.link];
        return [input?.link,link?.origin_id,link?.origin_slot];
    };
    const visit=current=>{
        if(!current||seen.has(current))return;
        seen.add(current);
        data.push([String(current.id),current.mode??0,
            (current.widgets||[]).filter(w=>w.serialize!==false).map(w=>[w.name,w.value]),
            (current.inputs||[]).map(i=>[i.name,linkInfo(current,i)]),current.properties||{}]);
        for(const input of current.inputs||[])visit(linkedNode(current,input.name));
    };
    visit(linkedNode(node,name));
    try{return JSON.stringify([linkInfo(node,node.inputs?.find(i=>i.name===name)),data]);}
    catch{return '[unserializable source]';}
}

export function linkedCanvas(node) {
    const source = linkedNode(node, 'canvas');
    const state = source?.vrpCanvasState;
    if (!state || state.ready === false) return null;
    return { node: source, state, image: source.vrpCanvasImage ?? source.imgs?.[0] ?? null };
}

// Put provenance in the queued workflow, which ComfyUI passes as hidden
// EXTRA_PNGINFO. Backend UI results echo it, including cached results. This
// avoids relying on receipt-time state or a single latest queued signature.
const previewTrackers=new WeakMap();
let promptTrackingInstalled=false;
export function trackQueuedPreview(node,snapshot) {
    previewTrackers.set(node,snapshot);
    if(promptTrackingInstalled || typeof app.graphToPrompt!=='function')return;
    promptTrackingInstalled=true;
    const graphToPrompt=app.graphToPrompt;
    app.graphToPrompt=async function(graph=this.rootGraph,...args) {
        const nodes=graph?._nodes || [];
        const before=new Map(nodes.filter(n=>previewTrackers.has(n)).map(n=>[n,previewTrackers.get(n)()]));
        const result=await graphToPrompt.call(this,graph,...args);
        const provenance={};
        for(const [n,captured] of before) {
            // Edits during async serialization make this snapshot uncertain.
            // Leave it unverified instead of certifying a different prompt.
            if(n.graph===graph && JSON.stringify(captured)===JSON.stringify(previewTrackers.get(n)()))
                provenance[String(n.id)]=captured;
        }
        if(result?.workflow) {
            result.workflow.extra ??= {};
            result.workflow.extra.anima_vrp_preview=provenance;
        }
        return result;
    };
}

export function queuedPreviewProvenance(message) {
    const value=message?.vrp_preview_provenance ?? message?.ui?.vrp_preview_provenance ??
        message?.output?.vrp_preview_provenance ?? message?.output?.ui?.vrp_preview_provenance;
    return Array.isArray(value)?value[0]:value;
}
