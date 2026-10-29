import { app, canvasEvents, linkedCanvas, linkedNode, locateNode, inputSignature, fitVisibleWidgets, observeValue, configuredWidgetValue, writeSerializedWidgetValue, isRegionNode, isCoreNode, trackQueuedPreview, queuedPreviewProvenance } from './classic_adapter.js';
import { collectAuthoredRegions, externalMaskSignature } from './region_editor.js';
import { regionColor, addStatusWidget, addRegionList, setWidgetVisible, tintedMask, prepareRuntimeMask, installUserConfig, drawBBoxDraft } from './region_ui.js';
import { addPromptWidget } from './string_widget_adapter.js';

const MIN_REGION = 0.005;
const finite = value => typeof value === 'number' && Number.isFinite(value);

function cloneState(value) {
    const state = typeof value === 'string' ? JSON.parse(value) : JSON.parse(JSON.stringify(value));
    if (!state || state.version !== 2 || !state.canvas || !Array.isArray(state.regions)) {
        throw new Error('Invalid Anima VRP state');
    }
    if (Object.keys(state).sort().join() !== 'canvas,regions,version' ||
        Object.keys(state.canvas).sort().join() !== 'height,width') throw new Error('Invalid Anima VRP state fields');
    const { width, height } = state.canvas;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8 || width % 8 || height % 8) {
        throw new Error('Invalid VRP canvas dimensions');
    }
    const ids = new Set();
    state.regions.forEach(region => {
        const fields = region && Object.keys(region).sort().join();
        if (!region || fields !== 'height,id,label,negative_prompt,prompt,weight,width,x,y' ||
            typeof region.id !== 'string' || !region.id || ids.has(region.id)) throw new Error('Region IDs must be unique');
        ids.add(region.id);
        for (const key of ['x','y','width','height','weight']) if (!finite(region[key])) throw new Error(`Invalid region ${key}`);
        if (region.width <= 0 || region.height <= 0 || region.weight < 0 || region.weight > 1 ||
            typeof region.prompt !== 'string' || typeof region.label !== 'string' || !region.label.trim() ||
            (region.negative_prompt !== undefined && typeof region.negative_prompt !== 'string')) throw new Error('Invalid region values');
        if (region.negative_prompt === undefined) region.negative_prompt = '';
        region.x = Math.max(0, Math.min(1, region.x));
        region.y = Math.max(0, Math.min(1, region.y));
        const right = Math.max(0, Math.min(1, region.x + region.width));
        const bottom = Math.max(0, Math.min(1, region.y + region.height));
        if (right <= region.x || bottom <= region.y) throw new Error(`Region ${region.id} has no visible area`);
        region.width = right - region.x;
        region.height = bottom - region.y;
    });
    return state;
}

function createState(value, node) {
    try { const state=cloneState(value);node.vrpStateError='';return state; }
    catch { node.vrpStateError='Unsupported editor state: recreate this experimental Core node';return {version:2, canvas:{width:1024,height:1024}, regions:[]}; }
}

function nextId(regions, node) {
    const used = new Set([...regions.map(region => region.id),...collectAuthoredRegions(node).map(region=>region.region_id)]);
    let index = regions.length + 1;
    while (used.has(`region-${index}`)) index++;
    return `region-${index}`;
}

function pointIn(rect, x, y) {
    return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function canvasAspect(node) {
    const canvas = linkedCanvas(node)?.state || node.vrpCanvasState || node.vrpEditorState?.canvas || {width:1024,height:1024};
    return Math.max(0.01, Number(canvas.width) / Number(canvas.height));
}

function editorHeight(node) {
    const width = Math.max(240, (node.size?.[0] || 400) - 12);
    return width / canvasAspect(node);
}

function editorRect(widget, node) {
    const width = Math.max(240, (node.size?.[0] || 400) - 12);
    const height = editorHeight(node);
    return {x:6, y:widget.last_y ?? 0, width, height};
}

function graphLink(graph, id) {
    return graph?._links?.get?.(id) ?? graph?._links?.[id] ?? graph?.links?.get?.(id) ?? graph?.links?.[id] ?? null;
}

function regionSourceSignature(node) {
    const visited = new Set();
    const snapshot = [];
    const visitData = current => {
        if (!current || visited.has(String(current.id))) return;
        visited.add(String(current.id));
        const widgets = (current.widgets || []).filter(widget => widget.serialize !== false)
            .map(widget => [widget.name, widget.value]);
        const inputs = (current.inputs || []).map(input => [input.name, input.link ?? null]);
        let properties = current.properties || {};
        try { properties = JSON.parse(JSON.stringify(properties)); }
        catch { properties = '[unserializable]'; }
        snapshot.push([String(current.id), current.comfyClass || current.type, widgets, inputs, properties]);
        for (const input of current.inputs || []) {
            const link = graphLink(node.graph, input.link);
            if (link) visitData(node.graph.getNodeById?.(link.origin_id) ||
                node.graph._nodes?.find(candidate => String(candidate.id) === String(link.origin_id)));
        }
    };
    const visitRegions = current => {
        if (!current || visited.has(`regions:${current.id}`)) return;
        if (!isRegionNode(current)) return visitData(current);
        visited.add(`regions:${current.id}`);
        const canvas = current.inputs?.find(input => input.name === 'canvas');
        const mask = current.inputs?.find(input => input.name === 'external_mask');
        const previous = current.inputs?.find(input => input.name === 'previous_regions');
        snapshot.push(['region-node', String(current.id), canvas?.link ?? null, mask?.link ?? null, previous?.link ?? null]);
        const canvasLink = graphLink(node.graph, canvas?.link);
        if (canvasLink) visitData(node.graph.getNodeById?.(canvasLink.origin_id) ||
            node.graph._nodes?.find(candidate => String(candidate.id) === String(canvasLink.origin_id)));
        const maskLink = graphLink(node.graph, mask?.link);
        if (maskLink) visitData(node.graph.getNodeById?.(maskLink.origin_id) ||
            node.graph._nodes?.find(candidate => String(candidate.id) === String(maskLink.origin_id)));
        const previousLink = graphLink(node.graph, previous?.link);
        if (previousLink) visitRegions(node.graph.getNodeById?.(previousLink.origin_id) ||
            node.graph._nodes?.find(candidate => String(candidate.id) === String(previousLink.origin_id)));
    };
    const regionsInput = node.inputs?.find(slot => slot.name === 'regions');
    const regionsLink = graphLink(node.graph, regionsInput?.link);
    if (regionsLink) visitRegions(node.graph.getNodeById?.(regionsLink.origin_id) ||
        node.graph._nodes?.find(candidate => String(candidate.id) === String(regionsLink.origin_id)));
    return JSON.stringify(snapshot);
}

function requiresRuntimePreview(node, authored = collectAuthoredRegions(node)) {
    if (!linkedNode(node,'regions')) return false;
    return authored.length === 0 || authored.some(region => !region.inactive && region.weight>0 && region.mode === 'External MASK');
}

function externalPreviewState(node, authored = collectAuthoredRegions(node)) {
    if (!requiresRuntimePreview(node, authored)) return {status: '', regions: []};
    const linked = linkedCanvas(node)?.state;
    const preview = node.vrpExternalRegionPreview;
    if (!preview) return {status: node.inputs?.find(input => input.name === 'regions')?.link != null ?
        'External masks appear after the first workflow execution.' : ''};
    if (!linked) return {status: 'External mask preview unavailable: connect the matching canvas.'};
    const expected = preview.canvas;
    if (!expected || expected.width !== linked.width || expected.height !== linked.height ||
        expected.revision !== linked.revision) {
        return {status: 'External mask preview is stale: canvas dimensions or revision changed.'};
    }
    if (node.vrpExternalPreviewStale) return {status: 'External mask preview is stale: region inputs changed; run the workflow again.'};
    const authoredById = new Map(authored.map(region => [region.region_id, region]));
    const current=authored.filter(r=>!r.inactive && r.weight>0 && r.mode==='External MASK');
    const stale=current.some(r=>!r.node.vrpRegionRuntimePreview || r.node.vrpRegionRuntimePreview.signature!==externalMaskSignature(r.node));
    if(stale)return {status:'External mask preview is stale: region inputs changed; run the workflow again.',regions:[]};
    if(!authored.length && node.vrpExternalPreviewSignature!==regionSourceSignature(node))
        return {status:'External mask preview is stale: region inputs changed; run the workflow again.',regions:[]};
    return {status:'',regions:(preview.regions||[]).filter(region=>{
        const authored=authoredById.get(region.region_id);
        if(authored){region.label=authored.label;return !authored.inactive && authored.weight>0 && authored.mode==='External MASK';}
        return region.source?.owner!=='VRPRegion' && region.weight!==0;
    })};
}

function regionRows(node) {
    const internal=(node.vrpEditorState?.regions||[]).map(region=>({id:region.id,label:region.label,
        status:region.weight===0?'Weight zero':'OK',level:'ok',inactive:region.weight===0,external:false}));
    const authored=collectAuthoredRegions(node);
    const shortStatus=region=>region.inactive?region.issue.text:region.weight===0?'Weight zero':
        region.issue.level==='error'?'Needs attention':region.issue.level==='warning'?'Pending / stale':
        region.issue.level==='info'?'Loading':'OK';
    const external=authored.map(region=>({id:region.region_id,label:region.label,node:region.node,external:true,
        inactive:region.inactive||region.weight===0,level:region.issue.level,status:shortStatus(region)}));
    if(!authored.length && linkedNode(node,'regions')){
        external.push(...(externalPreviewState(node,authored).regions||[]).map(region=>({id:region.region_id,label:region.label,external:true,status:'Runtime mask',level:'ok'})));
    }
    const rows=[...internal,...external],used=new Set();
    for(const row of rows){
        if(row.node?.mode===4||row.node?.mode===2)continue;
        const base=row.label||'Region';let label=base,index=2;
        while(used.has(label.toLocaleLowerCase()))label=`${base} (${index++})`;
        used.add(label.toLocaleLowerCase());row.label=label;
    }
    return rows;
}

function coreMessages(node) {
    const messages=[], linked=linkedCanvas(node);
    if(node.vrpStateError)messages.push({level:'error',text:node.vrpStateError});
    if(!linked)messages.push({level:linkedNode(node,'regions')?'error':'warning',text:'Connect a ready Canvas Builder for live authoring'});
    const positive=linkedNode(node,'global_positive');
    const textWidgets=positive?.widgets?.filter(w=>typeof w.value==='string' && w.serialize!==false);
    const executed=node.vrpPromptStatus;
    const knownEmpty=executed?.signature===inputSignature(node,'global_positive') && executed.global_positive_empty;
    if(!positive || knownEmpty || (textWidgets?.length===1 && !textWidgets[0].value.trim()))
        messages.push({level:'warning',text:'No global positive prompt supplied; connect a text source'});
    const authored=collectAuthoredRegions(node), active=authored.filter(r=>!r.inactive && r.weight>0);
    if(authored.some(r=>r.node.mode===2))messages.push({level:'info',text:'A muted node stops its upstream region chain; use Bypass for passthrough'});
    const attention=active.filter(r=>r.issue.level==='error').length;
    if(attention)messages.push({level:'error',text:`${attention} region(s) need attention; check the region list and their nodes`});
    const external=externalPreviewState(node,authored);
    if(external.status)messages.push({level:'warning',text:external.status});
    if(active.some(r=>r.mode==='External MASK'))messages.push({level:'info',text:'External MASK previews refresh on workflow execution'});
    const internalActive=node.vrpEditorState?.regions.some(r=>r.weight>0);
    if(!internalActive && !active.length && (!linkedNode(node,'regions')||authored.length))messages.push({level:'info',text:'No active regions: ordinary global-only sampling'});
    if(!messages.length)messages.push({level:'ok',text:'Canvas and region chain ready'});
    return messages;
}

function drawEditor(ctx, node, widget) {
    const rect = editorRect(widget, node);
    node.vrpEditorRect = rect;
    const canvasInfo = linkedCanvas(node);
    const state = node.vrpEditorState;
    ctx.save();
    ctx.fillStyle = '#111'; ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    if (canvasInfo?.image) {
        ctx.drawImage(canvasInfo.image, rect.x, rect.y, rect.width, rect.height);
    } else {
        ctx.fillStyle = '#262626'; ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        ctx.fillStyle = '#aaa'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(canvasInfo ? 'Canvas preview unavailable' : 'Connect Anima Canvas Builder', rect.x + rect.width / 2, rect.y + rect.height / 2);
    }
    if (state) state.regions.forEach((region, index) => {
        const box = {x:rect.x + region.x * rect.width, y:rect.y + region.y * rect.height,
            width:region.width * rect.width, height:region.height * rect.height};
        const selected = region.id === node.vrpSelectedRegion;
        const color=region.weight===0?'#888':regionColor(region.id);
        ctx.fillStyle = `${color}33`;
        ctx.strokeStyle = selected ? '#fff' : color;
        ctx.lineWidth = selected ? 3 : 2;
        ctx.fillRect(box.x, box.y, box.width, box.height); ctx.strokeRect(box.x, box.y, box.width, box.height);
        ctx.fillStyle = selected ? '#fff' : color;
        ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(region.label, box.x + 3, box.y + 3);
        if (selected) {
            ctx.fillStyle = '#fff';
            for (const [hx,hy] of [[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height]]) ctx.fillRect(hx-3,hy-3,6,6);
        }
    });
    const authored = collectAuthoredRegions(node);
    const labels=new Map(regionRows(node).map(row=>[row.id,row.label]));
    authored.forEach((region, index) => {
        if(region.inactive || region.weight===0)return;
        const selected=region.region_id===node.vrpSelectedRegion;
        const color=regionColor(region.region_id);
        if (region.mode === 'BBox' && region.bbox) {
            const box = {x:rect.x + region.bbox.x * rect.width, y:rect.y + region.bbox.y * rect.height,
                width:region.bbox.width * rect.width, height:region.bbox.height * rect.height};
            ctx.save();
            ctx.fillStyle = `${color}33`; ctx.strokeStyle = selected?'#fff':color; ctx.lineWidth = selected?3:2;
            ctx.fillRect(box.x, box.y, box.width, box.height); ctx.strokeRect(box.x, box.y, box.width, box.height);
            ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
            ctx.fillStyle = selected?'#fff':color; ctx.fillText(labels.get(region.region_id)||region.label || region.region_id, box.x + 3, box.y + 3);
            ctx.restore();
        } else if (region.mode === 'Painted Mask' && region.mask) {
            ctx.save(); ctx.globalAlpha = selected?0.78:0.52;
            if(selected){ctx.shadowColor='#fff';ctx.shadowBlur=6;}
            ctx.drawImage(tintedMask(region.mask,color), rect.x, rect.y, rect.width, rect.height);
            ctx.restore();
            ctx.save(); ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
            ctx.fillStyle = selected?'#fff':color; ctx.fillText(labels.get(region.region_id)||region.label || region.region_id, rect.x + 4, rect.y + 4); ctx.restore();
        }
    });
    const external = externalPreviewState(node, authored);
    if (external.regions) external.regions.forEach((region, index) => {
        const color = regionColor(region.region_id);
        prepareRuntimeMask(node, region);
        if (region.renderedMask) {
            ctx.save();
            ctx.globalAlpha = region.region_id===node.vrpSelectedRegion?0.78:0.52;
            if(region.region_id===node.vrpSelectedRegion){ctx.shadowColor='#fff';ctx.shadowBlur=6;}
            ctx.drawImage(region.renderedMask, rect.x, rect.y, rect.width, rect.height);
            ctx.restore();
        }
        if (region.bounds) {
            const box = {x:rect.x + region.bounds.x * rect.width, y:rect.y + region.bounds.y * rect.height,
                width:region.bounds.width * rect.width, height:region.bounds.height * rect.height};
            ctx.save();
            ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
            const title = labels.get(region.region_id)||region.label || region.region_id;
            const textWidth = ctx.measureText?.(title).width || title.length * 7;
            ctx.fillStyle = '#111'; ctx.fillRect(box.x, box.y, textWidth + 8, 17);
            ctx.fillStyle = color; ctx.fillText(title, box.x + 4, box.y + 2);
            ctx.restore();
        }
    });
    if (node.vrpEditorDraft) {
        drawBBoxDraft(ctx,node.vrpEditorDraft);
    }
    node.vrpRefreshControls?.();
    node.vrpRefreshList?.();
    fitVisibleWidgets(node);
    ctx.restore();
}

function hitRegion(state, rect, x, y) {
    for (let index = state.regions.length - 1; index >= 0; index--) {
        const region = state.regions[index];
        const box = {x:rect.x + region.x * rect.width, y:rect.y + region.y * rect.height,
            width:region.width * rect.width, height:region.height * rect.height};
        if (pointIn(box, x, y)) return {index, box};
    }
    return null;
}

function resizeEdges(box, x, y) {
    const edge = 8;
    return {left:Math.abs(x-box.x)<=edge, right:Math.abs(x-(box.x+box.width))<=edge,
        top:Math.abs(y-box.y)<=edge, bottom:Math.abs(y-(box.y+box.height))<=edge};
}

function clampRegion(region) {
    region.width = Math.max(MIN_REGION, Math.min(1, region.width));
    region.height = Math.max(MIN_REGION, Math.min(1, region.height));
    region.x = Math.max(0, Math.min(1-region.width, region.x));
    region.y = Math.max(0, Math.min(1-region.height, region.y));
}

app.registerExtension({
    name: 'AnimaVRP.Editor',
    beforeRegisterNodeDef(nodeType,nodeData){
        if(isCoreNode(nodeData))installUserConfig(nodeType,nodeData,'vrp_state');
    },
    nodeCreated(node) {
        if (!isCoreNode(node)) return;
        const widget = name => node.widgets.find(item => item.name === name);
        const stateWidget = widget('vrp_state');
        let state = createState(stateWidget.value,node), quiet = false, drag = null, removed = false;
        node.vrpEditorState = state;
        node.vrpExternalRegionPreview = null;
        node.vrpExternalPreviewStale = false;
        node.vrpExternalPreviewSignature = null;
        node.vrpExternalPreviewGraphVersion = null;
        node.vrpSelectedRegion = state.regions[0]?.id ?? null;
        let editingRegion=node.vrpSelectedRegion;
        const setWidget = (name, value) => {
            const previous=quiet;quiet=true;
            try { const field=widget(name);if(field.value!==value)field.value=value; }
            finally { quiet=previous; }
        };
        const commitPrompts=()=>{
            const previous=editingRegion;
            for(const [name,key] of [['region_prompt','prompt'],['region_negative_prompt','negative_prompt']]){
                const field=widget(name);if(!field)continue;
                // Commit autocomplete/IME text even if it did not dispatch input.
                field.element.blur();
                const selected=state.regions.find(r=>r.id===previous);
                if(selected)selected[key]=field.element.value;
            }
        };
        const selectRegion=id=>{
            if(id!==node.vrpSelectedRegion){commitPrompts();node.vrpSelectedRegion=id;editingRegion=id;save();}
            else refreshControls();
            node.properties ??= {};node.properties.vrpSelectedRegion=id;
            node.vrpRefreshList?.();
        };
        const save = () => {
            node.vrpStateError='';
            state = cloneState(state); node.vrpEditorState=state;
            setWidget('vrp_state', JSON.stringify(state));
            node.graph?.incrementVersion?.(); node.graph?.setDirtyCanvas(true,true);
            refreshControls();
        };
        const refreshControls = () => {
            const selected = state.regions.find(region => region.id === node.vrpSelectedRegion);
            if (widget('region_label')) setWidget('region_label', selected?.label ?? '');
            for(const [name,key] of [['region_prompt','prompt'],['region_negative_prompt','negative_prompt']]){
                const field=widget(name);
                if(field && document.activeElement!==field.element)setWidget(name,selected?.[key] ?? '');
            }
            if (widget('region_weight')) setWidget('region_weight', selected?.weight ?? 1);
            let changed=false;
            for(const name of ['region_label','region_prompt','region_negative_prompt','region_weight','Delete selected region'])
                changed=setWidgetVisible(widget(name),!!selected)||changed;
            if(changed)fitVisibleWidgets(node);
        };
        node.vrpRefreshControls=refreshControls;
        node.vrpFitWidgets=()=>fitVisibleWidgets(node);
        const syncCanvasDimensions = () => {
            if(node.vrpStateError)return false;
            const canvas = linkedCanvas(node)?.state;
            if (!canvas || (state.canvas.width === canvas.width && state.canvas.height === canvas.height)) return false;
            // Bboxes are normalized, so following the authoritative canvas
            // dimensions changes only the rasterization target, not region
            // geometry, IDs, prompts, or ordering.
            state.canvas.width = canvas.width;
            state.canvas.height = canvas.height;
            save();
            return true;
        };
        stateWidget.serialize=true;
        stateWidget.hidden=true; stateWidget.computeSize=()=>[0,-4];
        const editor = node.addWidget('custom','bbox_editor',null,()=>{}, {serialize:false});
        editor.onClick=()=>{};
        editor.computeSize = () => [0, editorHeight(node)];
        editor.draw = (ctx, owner) => drawEditor(ctx, owner, editor);
        editor.mouse = (event, pos) => {
            if (removed || !state) return true;
            const rect = node.vrpEditorRect || editorRect(editor,node);
            const x=pos[0], y=pos[1];
            if (event.type === 'mousedown' || event.type === 'pointerdown') {
                if (event.button !== 0 || !pointIn(rect,x,y)) return false;
                const hit=hitRegion(state,rect,x,y);
                if (hit) {
                    selectRegion(state.regions[hit.index].id);
                    const edges=resizeEdges(hit.box,x,y);
                    drag={kind:(edges.left||edges.right||edges.top||edges.bottom)?'resize':'move',index:hit.index,
                        startX:x,startY:y,original:{...state.regions[hit.index]},edges};
                } else {
                    drag={kind:'draw',index:-1,startX:x,startY:y};
                }
                refreshControls(); node.graph?.setDirtyCanvas(true,true); return true;
            }
            if ((event.type === 'mousemove' || event.type === 'pointermove') && drag) {
                const dx=(x-drag.startX)/rect.width, dy=(y-drag.startY)/rect.height;
                if (drag.kind === 'draw') {
                    node.vrpEditorDraft={x:Math.min(drag.startX,x),y:Math.min(drag.startY,y),width:Math.abs(x-drag.startX),height:Math.abs(y-drag.startY)};
                } else {
                    const r=state.regions[drag.index], original=drag.original;
                    if (drag.kind==='move') { r.x=original.x+dx; r.y=original.y+dy; }
                    else {
                        if (drag.edges.left) {r.x=original.x+dx; r.width=original.width-dx;}
                        if (drag.edges.right) r.width=original.width+dx;
                        if (drag.edges.top) {r.y=original.y+dy; r.height=original.height-dy;}
                        if (drag.edges.bottom) r.height=original.height+dy;
                    }
                    clampRegion(r);
                }
                node.graph?.setDirtyCanvas(true,true); return true;
            }
            if ((event.type === 'mouseup' || event.type === 'pointerup') && drag) {
                if (drag.kind==='draw') {
                    const draft=node.vrpEditorDraft; delete node.vrpEditorDraft;
                    if (draft && draft.width >= 6 && draft.height >= 6) {
                        const region={id:nextId(state.regions,node),label:nextLabel(node),x:(draft.x-rect.x)/rect.width,y:(draft.y-rect.y)/rect.height,
                            width:draft.width/rect.width,height:draft.height/rect.height,prompt:'',negative_prompt:'',weight:1};
                        clampRegion(region); state.regions.push(region); selectRegion(region.id);
                    }
                } else { drag=null; save(); }
                drag=null; node.graph?.setDirtyCanvas(true,true); return true;
            }
            return true;
        };
        addStatusWidget(node,()=>coreMessages(node),true);
        const list=addRegionList(node,()=>regionRows(node),selectRegion,locateNode);
        node.vrpRefreshList=list.vrpRefresh;
        node.addWidget('button','Add region','',()=>{
            const region={id:nextId(state.regions,node),label:nextLabel(node),x:.25,y:.25,width:.5,height:.5,prompt:'',negative_prompt:'',weight:1};
            state.regions.push(region); selectRegion(region.id);
        },{serialize:false});
        node.addWidget('button','Delete selected region','',()=>{
            const index=state.regions.findIndex(region=>region.id===node.vrpSelectedRegion);
            if (index<0) return;
            commitPrompts();state.regions.splice(index,1);
            node.vrpSelectedRegion=state.regions[index]?.id || state.regions[index-1]?.id || null;
            editingRegion=node.vrpSelectedRegion;save();node.vrpRefreshList?.();
        },{serialize:false});
        node.addWidget('text','region_label','',value=>{
            if(quiet)return;
            const selected=state.regions.find(r=>r.id===node.vrpSelectedRegion);
            if(!selected)return;
            const used=new Set(regionRows(node).filter(r=>r.id!==selected.id).map(r=>r.label.toLocaleLowerCase()));
            const raw=String(value).trim()||'Region';let label=raw,index=2;
            while(used.has(label.toLocaleLowerCase()))label=`${raw} (${index++})`;
            selected.label=label;save();
        },{serialize:false});
        const updatePrompt=(name,key,value)=>{
            if(quiet)return;
            const field=widget(name), selected=state.regions.find(r=>r.id===editingRegion);
            // Ignore delayed suggestions from a dismissed editor carrying old text.
            if(field.vrpPromptRegion!==editingRegion){setWidget(name,selected?.[key]??'');return;}
            // KJ "Keep widget values" copies these derived native views after
            // vrp_state. Copying a view is not an edit of the canonical region.
            if(document.activeElement!==field.element)return;
            if(selected && field.element.value===String(value) && selected[key]!==String(value)){selected[key]=String(value);save();}
        };
        for(const [name,key,title] of [['region_prompt','prompt','Selected region positive prompt'],
            ['region_negative_prompt','negative_prompt','Selected region negative prompt']]){
            const field=addPromptWidget(node,name,value=>updatePrompt(name,key,value),title);
            field.vrpPromptRegion=editingRegion;
            field.element.addEventListener('focus',()=>{field.vrpPromptRegion=editingRegion;});
        }
        const weightView=node.addWidget('number','region_weight',1,value=>{if(!quiet){const selected=state.regions.find(r=>r.id===node.vrpSelectedRegion);if(selected){selected.weight=Math.max(0,Math.min(1,Number(value)));save();}}},{min:0,max:1,step:.05,precision:2,serialize:false});
        weightView.serialize=false;widget('region_label').serialize=false;
        const adoptState=(value=widget('vrp_state').value)=>{
            if(quiet||removed)return;
            state=createState(value,node);node.vrpEditorState=state;
            const preferred=node.properties?.vrpSelectedRegion ?? node.vrpSelectedRegion;
            node.vrpSelectedRegion=state.regions.some(r=>r.id===preferred)?preferred:state.regions[0]?.id ?? null;
            editingRegion=node.vrpSelectedRegion;
            refreshControls();node.vrpRefreshList?.();node.graph?.setDirtyCanvas(true,true);
        };
        // Recreation tools assign widget values by name without onConfigure.
        observeValue(stateWidget,()=>{adoptState();syncCanvasDimensions();});
        refreshControls();
        const configured=node.onConfigure;
        node.onConfigure=function(info,...args){
            // Capture the file's state before chained callbacks refresh views.
            // Never reconstruct canonical regions from the selected text fields.
            const restored=configuredWidgetValue(this,info,'vrp_state');
            configured?.call(this,info,...args);
            if(restored){
                // Reconfiguring an existing node must not let the previously
                // focused textarea overwrite the newly loaded region prompt.
                const previous=quiet;quiet=true;
                try {
                    for(const name of ['region_prompt','region_negative_prompt'])widget(name)?.element.blur();
                    setWidget('vrp_state',restored.value);
                } finally {quiet=previous;}
            }
            adoptState(restored ? restored.value : widget('vrp_state').value);
            syncCanvasDimensions();node.graph?.setDirtyCanvas(true,true);
        };
        const prepareState=()=>{
            if(removed || node.vrpStateError)return widget('vrp_state').value;
            // Commit unfinished native/autocomplete input only when this is the
            // focused editor for the current stable ID. Unfocused fields are views.
            const selected=state.regions.find(r=>r.id===editingRegion);
            let changed=false;
            for(const [name,key] of [['region_prompt','prompt'],['region_negative_prompt','negative_prompt']]){
                const field=widget(name);
                if(selected && document.activeElement===field.element && field.vrpPromptRegion===editingRegion && selected[key]!==field.element.value){
                    selected[key]=field.element.value;changed=true;
                }
            }
            if(changed)save();
            syncCanvasDimensions();
            return widget('vrp_state').value;
        };
        // ComfyUI calls beforeQueued for sampling and onSerialize for JSON,
        // autosave and embedded workflows. serializeValue covers prompt export.
        const beforeQueued=stateWidget.beforeQueued;
        stateWidget.beforeQueued=function(...args){beforeQueued?.apply(this,args);prepareState();};
        stateWidget.serializeValue=()=>prepareState();
        const serialized=node.onSerialize;
        node.onSerialize=function(info,...args){
            serialized?.call(this,info,...args);
            writeSerializedWidgetValue(this,info,'vrp_state',prepareState());
        };
        const onCanvas=(event)=>{
            if (removed) return;
            const source = linkedNode(node,'canvas');
            const detail = event?.detail || {};
            if (source && String(detail.nodeId) === String(source.id) &&
                (detail.graphId == null || String(detail.graphId) === String(source.graph?.id))) {
                syncCanvasDimensions();
            }
            node.graph?.setDirtyCanvas(true,true);
        };
        canvasEvents.addEventListener('canvas-changed',onCanvas);
        const onExecuted = node.onExecuted;
        trackQueuedPreview(node,()=>({regions:regionSourceSignature(node),positive:inputSignature(node,'global_positive'),
            masks:Object.fromEntries(collectAuthoredRegions(node).map(r=>[r.region_id,externalMaskSignature(r.node)]))}));
        node.onExecuted = function(message, ...args) {
            const result = onExecuted?.call(this, message, ...args);
            const provenance=queuedPreviewProvenance(message);
            const statuses=message?.vrp_prompt_status ?? message?.ui?.vrp_prompt_status;
            if(statuses?.[0])this.vrpPromptStatus={...statuses[0],signature:provenance?.positive};
            const payload = message?.vrp_region_preview ?? message?.ui?.vrp_region_preview ??
                message?.output?.vrp_region_preview ?? message?.output?.ui?.vrp_region_preview;
            const preview = Array.isArray(payload) ? payload[0] : payload;
            if (preview && preview.version === 1 && Array.isArray(preview.regions)) {
                this.vrpExternalRegionPreview = preview;
                this.vrpExternalPreviewSignature = provenance?.regions;
                this.vrpExternalPreviewGraphVersion = this.graph?._version;
                const authored=new Map(collectAuthoredRegions(this).map(r=>[r.region_id,r]));
                this.vrpExternalPreviewStale = provenance?.regions !== regionSourceSignature(this) ||
                    [...authored.values()].some(r=>r.mode==='External MASK' && !r.inactive &&
                        provenance?.masks?.[r.region_id]!==externalMaskSignature(r.node));
                for(const region of preview.regions){
                    const source=authored.get(region.region_id)?.node;
                    if(source){region.signature=provenance?.masks?.[region.region_id];source.vrpRegionRuntimePreview=region;}
                    prepareRuntimeMask(this,region);
                }
            } else if (this.inputs?.find(input => input.name === 'regions')?.link == null) {
                this.vrpExternalRegionPreview = null;
                this.vrpExternalPreviewStale = false;
            }
            this.graph?.setDirtyCanvas(true, true);
            return result;
        };
        const previousConnectionsChange = node.onConnectionsChange;
        node.onConnectionsChange = function(type, slot, connected, link, input) {
            const result = previousConnectionsChange?.call(this, type, slot, connected, link, input);
            const name = input?.name || this.inputs?.[slot]?.name;
            if (name === 'canvas') syncCanvasDimensions();
            if (name === 'regions') {
                this.vrpExternalPreviewStale = connected && requiresRuntimePreview(this);
                if (!connected) this.vrpExternalRegionPreview = null;
                this.graph?.setDirtyCanvas(true, true);
            }
            return result;
        };
        const previousExecutionStart = node.onExecutionStart;
        node.onExecutionStart = function(...args) {
            prepareState();
            this.vrpExternalPreviewStale = requiresRuntimePreview(this);
            return previousExecutionStart?.apply(this, args);
        };
        const previous=node.onRemoved;
        node.onRemoved=function(...args){removed=true; canvasEvents.removeEventListener('canvas-changed',onCanvas); previous?.apply(this,args);};
        const added = node.onAdded;
        node.onAdded = function(...args) { const result = added?.apply(this,args); syncCanvasDimensions(); return result; };
        syncCanvasDimensions();
        node.setSize([420,650]);fitVisibleWidgets(node); node.graph?.setDirtyCanvas(true,true);
    },
});

function nextLabel(node) {
    const used=new Set(regionRows(node).map(r=>r.label.toLocaleLowerCase()));let index=1;
    while(used.has(`region ${index}`))index++;
    return `Region ${index}`;
}
