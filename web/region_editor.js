import { app, canvasEvents, publish, clearPublishedCanvas, linkedCanvas, linkedNode, rawLinkedNode, inputSignature, fitVisibleWidgets, imageURL, upload, showEditorImage, openEditor, hideNativeImagePreview, observeValue, observeProperty, isRegionNode, trackQueuedPreview, queuedPreviewProvenance } from './classic_adapter.js';
import { regionColor, addStatusWidget, prepareRuntimeMask, installUserConfig, drawBBoxDraft } from './region_ui.js';
import { transferSelection } from './image_alignment.js';

const MIN_SIZE = 0.005;

function readMode(node) {
    const widget = node.widgets?.find(item => item.name === 'authoring_mode');
    if (widget) return String(widget.value || 'BBox');
    return node.inputs?.find(input => input.name === 'external_mask')?.link != null ? 'External MASK' : 'BBox';
}

function readState(node) {
    const widget = node.widgets?.find(item => item.name === 'authoring_state');
    try {
        const value = typeof widget?.value === 'string' ? JSON.parse(widget.value) : widget?.value;
        const bbox = value?.bbox;
        const paintedMask=value?.painted_mask ?? {image_ref:''};
        if (value?.version === 1 && (bbox===null || (bbox && ['x','y','width','height'].every(key => Number.isFinite(bbox[key])) &&
            bbox.width > 0 && bbox.height > 0)) && paintedMask && typeof paintedMask.image_ref==='string') {
            return {version:1,bbox:bbox===null?null:{...bbox},painted_mask:{...paintedMask}};
        }
    } catch { /* Broken/old editor state is replaced by a safe default. */ }
    return {version:1,bbox:null,painted_mask:{image_ref:''}};
}

function upstreamRegionChain(node) {
    const first = rawLinkedNode(node, 'regions');
    const chain = [];
    const seen = new Set();
    const visit = current => {
        if (!isRegionNode(current) || seen.has(String(current.id))) return false;
        seen.add(String(current.id));
        if(current.mode===2){chain.push(current);return true;}
        const previous = rawLinkedNode(current, 'previous_regions');
        if (isRegionNode(previous) && !visit(previous)) return false;
        chain.push(current);
        return true;
    };
    if (!visit(first)) return [];
    return chain;
}

export function collectAuthoredRegions(node) {
    return upstreamRegionChain(node).map(regionNode => {
        const mode = readMode(regionNode);
        const identity = String(regionNode.widgets?.find(widget => widget.name === 'region_id')?.value ?? '');
        const label = String(regionNode.widgets?.find(widget => widget.name === 'label')?.value ?? identity);
        const inactive=regionNode.mode===4||regionNode.mode===2;
        const weight=Number(regionNode.widgets?.find(widget=>widget.name==='weight')?.value ?? 1);
        const record = {node:regionNode,region_id:identity,label,mode,inactive,weight,
            issue:regionStatus(regionNode)};
        if (mode === 'BBox') record.bbox = (regionNode.vrpRegionState || readState(regionNode)).bbox;
        if (mode === 'Painted Mask') record.mask = regionNode.vrpRegionMaskPreview || null;
        return record;
    });
}

export function regionStatus(node) {
    const msg=(level,text)=>({level,text});
    if(node.mode===4)return msg('info','Bypassed');
    if(node.mode===2)return msg('info','Muted');
    if(!linkedCanvas(node))return msg('error','Connect a ready Canvas Builder');
    if(Number(node.widgets?.find(w=>w.name==='weight')?.value)===0)return msg('info','Inactive: weight is zero');
    if(node.vrpRegionStatus)return msg(node.vrpRegionBusy?'info':'error',node.vrpRegionStatus);
    const state=node.vrpRegionState || readState(node), mode=readMode(node);
    if(mode==='BBox' && !state.bbox)return msg('error','Draw a bbox in the preview');
    if(mode==='Painted Mask') {
        if(!state.painted_mask.image_ref)return msg('error','Edit region mask and save a painted area');
        if(node.vrpRegionMaskLoading)return msg('info','Loading painted mask…');
        if(node.vrpRegionMaskError)return msg('error','Cannot load saved mask; edit it again');
        if(node.vrpRegionMaskHasArea===false)return msg('error','Mask is empty; paint a region or bypass this node');
    }
    if(mode==='External MASK') {
        if(node.inputs?.find(input=>input.name==='external_mask')?.link==null)return msg('error','Connect a MASK input');
        const preview=node.vrpRegionRuntimePreview;
        if(!preview)return msg('warning','External MASK preview requires running the workflow');
        if(preview.signature!==externalMaskSignature(node))return msg('warning','External MASK changed; run the workflow to refresh');
        if(preview.maskPreviewError)return msg('error','Mask preview could not load; run the workflow again');
        if(!preview.bounds)return msg('error','External MASK is empty; author a mask or bypass this node');
    }
    return msg('ok','Status: OK');
}

export function externalMaskSignature(node) {
    const canvas=linkedCanvas(node)?.state;
    return JSON.stringify([inputSignature(node,'external_mask'),canvas?.width,canvas?.height,canvas?.revision,
        canvas?.alignment?.source_id,canvas?.image_ref]);
}

function canvasRect(widget, node) {
    const canvas = node.vrpCanvasState || linkedCanvas(node)?.state || {width:1024,height:1024};
    const aspect = Math.max(.01, Number(canvas.width) / Number(canvas.height));
    const width = Math.max(1, (node.size?.[0] || 420) - 12);
    return {x:6,y:widget.last_y ?? 0,width,height:width/aspect};
}

function clampBBox(bbox) {
    bbox.width = Math.max(MIN_SIZE, Math.min(1, bbox.width));
    bbox.height = Math.max(MIN_SIZE, Math.min(1, bbox.height));
    bbox.x = Math.max(0, Math.min(1-bbox.width, bbox.x));
    bbox.y = Math.max(0, Math.min(1-bbox.height, bbox.y));
    return bbox;
}

function label(node) {
    return String(node.widgets?.find(widget => widget.name === 'label')?.value ?? 'Region');
}

function drawEditor(ctx, node, widget) {
    const rect = canvasRect(widget,node);
    node.vrpRegionEditorRect = rect;
    const canvas = linkedCanvas(node);
    ctx.save();
    ctx.fillStyle = '#111'; ctx.fillRect(rect.x,rect.y,rect.width,rect.height);
    if (canvas?.image) ctx.drawImage(canvas.image,rect.x,rect.y,rect.width,rect.height);
    else {
        ctx.fillStyle = '#262626'; ctx.fillRect(rect.x,rect.y,rect.width,rect.height);
        ctx.fillStyle = '#aaa'; ctx.font='12px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(canvas ? 'Canvas image unavailable' : 'Connect Canvas Builder',rect.x+rect.width/2,rect.y+rect.height/2);
    }
    const mode=readMode(node);
    const color=regionColor(node.widgets?.find(w=>w.name==='region_id')?.value);
    if (mode==='BBox' && (node.vrpRegionState || readState(node)).bbox) {
        const bbox=(node.vrpRegionState || readState(node)).bbox;
        const box={x:rect.x+bbox.x*rect.width,y:rect.y+bbox.y*rect.height,
            width:bbox.width*rect.width,height:bbox.height*rect.height};
        ctx.fillStyle=`${color}33`; ctx.strokeStyle=color; ctx.lineWidth=2;
        ctx.fillRect(box.x,box.y,box.width,box.height); ctx.strokeRect(box.x,box.y,box.width,box.height);
        ctx.fillStyle='#fff'; ctx.font='12px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top';
        ctx.fillText(label(node),box.x+4,box.y+4);
        for (const [x,y] of [[box.x,box.y],[box.x+box.width,box.y],
            [box.x,box.y+box.height],[box.x+box.width,box.y+box.height]]) ctx.fillRect(x-3,y-3,6,6);
    } else if (mode==='Painted Mask') {
        if (node.vrpRegionMaskPreview) {
            ctx.save(); ctx.globalAlpha=.55;
            ctx.drawImage(node.vrpRegionMaskPreview,rect.x,rect.y,rect.width,rect.height);
            ctx.restore();
        } else {
            ctx.fillStyle='#fff'; ctx.font='12px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
            ctx.fillText('Press “Edit region mask” to paint',rect.x+rect.width/2,rect.y+rect.height/2);
        }
        ctx.fillStyle='#fff'; ctx.font='12px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top';
        ctx.fillText(label(node),rect.x+5,rect.y+5);
    } else if(mode==='External MASK') {
        const runtime=node.vrpRegionRuntimePreview;
        if(runtime?.renderedMask && runtime.signature===externalMaskSignature(node)){
            ctx.save();ctx.globalAlpha=.55;ctx.drawImage(runtime.renderedMask,rect.x,rect.y,rect.width,rect.height);ctx.restore();
        }
        ctx.fillStyle='#fff'; ctx.font='12px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText('External MASK input',rect.x+rect.width/2,rect.y+rect.height/2);
    }
    if (node.vrpRegionDraft) {
        drawBBoxDraft(ctx,node.vrpRegionDraft);
    }
    ctx.restore();
    fitVisibleWidgets(node);
}

function bboxAt(node,x,y,rect) {
    const value=(node.vrpRegionState || readState(node)).bbox;
    if(!value)return null;
    const box={x:rect.x+value.x*rect.width,y:rect.y+value.y*rect.height,
        width:value.width*rect.width,height:value.height*rect.height};
    if (x<box.x-8 || x>box.x+box.width+8 || y<box.y-8 || y>box.y+box.height+8) return null;
    const nearLeft=Math.abs(x-box.x)<=8, nearRight=Math.abs(x-box.x-box.width)<=8;
    const nearTop=Math.abs(y-box.y)<=8, nearBottom=Math.abs(y-box.y-box.height)<=8;
    if ((nearLeft||nearRight)&&(nearTop||nearBottom)) return {kind:'resize',box,edges:{left:nearLeft,right:nearRight,top:nearTop,bottom:nearBottom}};
    if (x>=box.x&&x<=box.x+box.width&&y>=box.y&&y<=box.y+box.height) return {kind:'move',box};
    return null;
}

function loadImage(url) {
    return new Promise((resolve,reject)=>{
        const image=new Image(); image.crossOrigin='anonymous';
        image.onload=()=>resolve(image); image.onerror=()=>reject(new Error('Could not load image for region editing'));
        image.src=url;
    });
}

function imageReferenceString(value) {
    if (typeof value === 'string') return value.trim();
    if (!value || typeof value !== 'object' || typeof value.filename !== 'string') return '';
    const path=`${value.subfolder ? `${String(value.subfolder).replaceAll('\\','/').replace(/\/$/,'')}/` : ''}${value.filename}`;
    return `${path} [${value.type || 'input'}]`;
}

function currentNodeImageReference(node) {
    return imageReferenceString(node.images?.[0]);
}

function isNativeSavedMaskReference(value) {
    const path=String(value||'').trim().replaceAll('\\','/').replace(/\s+\[(input|output|temp)\]$/,'');
    return /(?:^|\/)clipspace-painted-masked-\d+\.png$/i.test(path);
}

function sameImageReference(left, right) {
    const parse=value=>{
        let path=String(value||'').trim().replaceAll('\\','/'), type='input';
        const match=/\s+\[(input|output|temp)\]$/.exec(path);
        if(match){type=match[1];path=path.slice(0,-match[0].length);}
        return {path,type};
    };
    const a=parse(left), b=parse(right);
    return a.type===b.type && (a.path===b.path ||
        (!a.path.includes('/') && b.path.split('/').at(-1)===a.path));
}

async function makeEditorImage(node, includeExistingMask=true, current=()=>true) {
    const linked=linkedCanvas(node);
    if (!linked?.state?.ready || !linked.image) throw new Error('Connect a ready Canvas Builder before editing a region mask');
    const {width,height}=linked.state;
    const canvas=document.createElement('canvas'); canvas.width=width; canvas.height=height;
    const context=canvas.getContext('2d',{willReadFrequently:true});
    context.fillStyle='#fff'; context.fillRect(0,0,width,height);
    context.drawImage(linked.image,0,0,width,height);
    const output=context.getImageData(0,0,width,height);
    // Export the intact opaque raster before applying the regional mask.
    // Canvas PNG export can erase RGB underneath zero alpha. The native
    // /upload/mask endpoint copies alpha onto this separate original using PIL.
    for (let index=3;index<output.data.length;index+=4) output.data[index]=255;
    context.putImageData(output,0,0);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!current())throw new Error('Region mask operation cancelled');
    if (!blob) throw new Error('Could not prepare the region mask editor image');
    const reference=String(readState(node).painted_mask.image_ref || '').trim();
    let maskBlob=null;
    if (includeExistingMask && reference) {
        const {url}=imageURL(reference,'rgba');
        const savedMask=await loadImage(url);
        if(!current())throw new Error('Region mask operation cancelled');
        const layer=document.createElement('canvas'); layer.width=width; layer.height=height;
        const layerContext=layer.getContext('2d',{willReadFrequently:true});
        layerContext.imageSmoothingEnabled=true; layerContext.imageSmoothingQuality='low';
        const transformed=!!(readState(node).painted_mask.view&&linked.state.alignment);
        const selected=transformed?transferSelection(tintMask(savedMask,'#ffffff'),readState(node).painted_mask.view,linked.state.alignment):savedMask;
        layerContext.drawImage(selected,0,0,width,height);
        const old=layerContext.getImageData(0,0,width,height).data;
        for (let index=0;index<output.data.length;index+=4) output.data[index+3]=transformed?255-old[index+3]:old[index+3];
        context.putImageData(output,0,0);
        maskBlob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        if(!current())throw new Error('Region mask operation cancelled');
        if (!maskBlob) throw new Error('Could not prepare the existing region mask');
    }
    return {blob,maskBlob,width,height,view:linked.state.alignment};
}

function updateWidget(node,name,value) {
    const widget=node.widgets?.find(item=>item.name===name);
    if (!widget || widget.value===value) return;
    node.vrpRegionQuiet=true;
    widget.value=value;
    node.vrpRegionQuiet=false;
}

function repaintNode(node) {
    node.graph?.incrementVersion?.();
    redrawRegionViews(node);
}

function redrawRegionViews(node) {
    node.graph?.setDirtyCanvas(true,true);
    // Explicitly invalidate the visible classic canvas too. This is guarded
    // by graph identity so edits in another workflow/session cannot repaint
    // the currently selected graph by accident.
    if (app.canvas && app.canvas.graph === node.graph) app.canvas.setDirty(true,true);
}

function setRegionStatus(node, message) {
    node.vrpRegionStatus = message || '';
    node.graph?.setDirtyCanvas(true,true);
}

function tintMask(image,color) {
    const canvas=document.createElement('canvas');
    canvas.width=image.naturalWidth||image.width; canvas.height=image.naturalHeight||image.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true}); ctx.drawImage(image,0,0);
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    const match=/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
    const rgb=match?match.slice(1).map(value=>parseInt(value,16)):[241,91,91];
    let hasArea=false;
    for(let index=0;index<pixels.data.length;index+=4){
        const selected=255-pixels.data[index+3];
        hasArea ||= selected>0;
        pixels.data[index]=rgb[0]; pixels.data[index+1]=rgb[1]; pixels.data[index+2]=rgb[2]; pixels.data[index+3]=selected;
    }
    ctx.putImageData(pixels,0,0);canvas.vrpHasArea=hasArea; return canvas;
}

async function refreshMaskPreview(node) {
    if(node.vrpRegionRemoved)return;
    const reference=String(readState(node).painted_mask.image_ref || '').trim();
    const token=(node.vrpRegionMaskToken||0)+1; node.vrpRegionMaskToken=token;
    node.vrpRegionMaskLoading=!!reference;node.vrpRegionMaskError=false;
    node.vrpRegionMaskPreview=null;node.vrpRegionMaskHasArea=undefined;
    if (!reference) {node.vrpRegionMaskPreview=null;node.vrpRegionMaskHasArea=false; redrawRegionViews(node); return;}
    try {
        const {url}=imageURL(reference,'rgba');
        const image=await loadImage(url);
        if (node.vrpRegionMaskToken!==token) return;
        const tinted=tintMask(image,regionColor(node.widgets?.find(w=>w.name==='region_id')?.value));
        node.vrpRegionMaskPreview=transferSelection(tinted,readState(node).painted_mask.view,linkedCanvas(node)?.state.alignment);
        const preview=node.vrpRegionMaskPreview,ctx=preview.getContext('2d',{willReadFrequently:true});
        const pixels=ctx.getImageData(0,0,preview.width,preview.height).data;
        node.vrpRegionMaskHasArea=pixels.some((v,i)=>i%4===3&&v>0);
    } catch { if (node.vrpRegionMaskToken===token) {node.vrpRegionMaskPreview=null;node.vrpRegionMaskError=true;} }
    if(node.vrpRegionMaskToken===token)node.vrpRegionMaskLoading=false;
    redrawRegionViews(node);
}

async function openRegionMaskEditor(node,current) {
    // A prior editor may have been closed without saving. Disarm its watcher
    // before asynchronous preparation or publishing another temporary source.
    node.vrpRegionMaskEditActive=false;
    node.vrpRegionMaskEditSource='';
    const prepared=await makeEditorImage(node,true,current);
    if(!current())return;
    let path=await upload(prepared.blob,`vrp-region-${globalThis.crypto?.randomUUID?.()||Date.now()}.png`);
    if(!current())return;
    if (prepared.maskBlob) {
        path=await upload(prepared.maskBlob,`vrp-region-mask-${globalThis.crypto?.randomUUID?.()||Date.now()}.png`,imageURL(path).ref);
        if(!current())return;
    }
    const {ref,url}=imageURL(path,'rgb');
    const preview=await loadImage(url);
    if(!current())return;
    updateWidget(node,'authoring_mode','Painted Mask');
    showEditorImage(node,preview,ref);
    node.vrpRegionMaskEditActive=true;
    node.vrpRegionMaskEditSource=path;
    node.vrpRegionMaskEditView=prepared.view;
    await refreshMaskPreview(node);
    if(!current())return;
    openEditor(node);
}

async function clearRegionMask(node,storeMaskSource,current) {
    node.vrpRegionMaskEditActive=false;
    node.vrpRegionMaskEditSource='';
    const prepared=await makeEditorImage(node,false,current);
    if(!current())return;
    const path=await upload(prepared.blob,`vrp-region-${globalThis.crypto?.randomUUID?.()||Date.now()}.png`);
    if(!current())return;
    const {ref,url}=imageURL(path,'rgba');
    const preview=await loadImage(url);
    if(!current())return;
    storeMaskSource(path,prepared.view);
    updateWidget(node,'authoring_mode','Painted Mask');
    showEditorImage(node,preview,ref);
    await refreshMaskPreview(node); if(current())repaintNode(node);
}

app.registerExtension({
    name:'AnimaVRP.RegionEditor',
    beforeRegisterNodeDef(nodeType,nodeData){
        if(isRegionNode(nodeData))installUserConfig(nodeType,nodeData,'authoring_state');
    },
    nodeCreated(node) {
        if(!isRegionNode(node)) return;
        hideNativeImagePreview(node);
        const modeWidget=node.widgets?.find(widget=>widget.name==='authoring_mode');
        const stateWidget=node.widgets?.find(widget=>widget.name==='authoring_state');
        const legacyImageWidget=node.widgets?.find(widget=>widget.name==='legacy_editor_image');
        let state=readState(node), drag=null, removed=false,operationEpoch=0;
        node.vrpRegionRemoved=false;
        const cancelOperation=()=>{
            operationEpoch++;node.vrpRegionBusy=false;node.vrpRegionStatus='';
            node.vrpRegionMaskEditActive=false;node.vrpRegionMaskEditSource='';
            node.vrpRegionMaskToken=(node.vrpRegionMaskToken||0)+1;
        };
        const runOperation=async(label,operation)=>{
            if(removed)return;
            cancelOperation();const token=operationEpoch;
            const current=()=>!removed&&token===operationEpoch;
            node.vrpRegionBusy=true;setRegionStatus(node,label);
            try{await operation(current);if(current())setRegionStatus(node,'');}
            catch(error){if(current()){
                node.vrpRegionMaskEditActive=false;node.vrpRegionMaskEditSource='';
                setRegionStatus(node,String(error.message||error));
            }}
            finally{if(current()){node.vrpRegionBusy=false;redrawRegionViews(node);}}
        };
        node.vrpRegionState=state;
        node.vrpRegionMaskPreview=null;
        stateWidget.hidden=true; stateWidget.type='hidden'; stateWidget.computeSize=()=>[0,-4];
        if(legacyImageWidget){legacyImageWidget.hidden=true;legacyImageWidget.type='hidden';legacyImageWidget.computeSize=()=>[0,-4];}
        const saveState=()=>{
            state={version:1,bbox:state.bbox?{...state.bbox}:null,painted_mask:{...state.painted_mask}}; node.vrpRegionState=state;
            updateWidget(node,'authoring_state',JSON.stringify(state)); repaintNode(node);
        };
        const storeMaskSource=(reference,view=linkedCanvas(node)?.state.alignment)=>{
            state={...state,painted_mask:{image_ref:String(reference||''),...(view?{view:{...view}}:{})}};
            node.vrpRegionState=state;
            updateWidget(node,'authoring_state',JSON.stringify(state)); repaintNode(node);
        };
        const syncCanvas=()=>{
            const linked=linkedCanvas(node);
            if(!linked){
                clearPublishedCanvas(node); return;
            }
            node.vrpCanvasImage=linked.image;
            const next={...linked.state,ready:true};
            const current=node.vrpCanvasState;
            if(!current||Object.keys(next).some(key=>current[key]!==next[key])) publish(node,next);
            else node.graph?.setDirtyCanvas(true,true);
        };
        const editor=node.addWidget('custom','region_editor',null,()=>{},{serialize:false});
        editor.onClick=()=>{};
        editor.computeSize=()=>[0,canvasRect(editor,node).height];
        editor.draw=(ctx)=>drawEditor(ctx,node,editor);
        editor.mouse=(event,pos)=>{
            if(removed||readMode(node)!=='BBox') return false;
            const rect=node.vrpRegionEditorRect||canvasRect(editor,node), x=pos[0], y=pos[1];
            if(event.type==='mousedown'||event.type==='pointerdown'){
                if(event.button!==0||x<rect.x||x>rect.x+rect.width||y<rect.y||y>rect.y+rect.height) return false;
                const hit=bboxAt(node,x,y,rect);
                drag=hit?{...hit,startX:x,startY:y,original:{...state.bbox}}:{kind:'draw',startX:x,startY:y};
                redrawRegionViews(node); return true;
            }
            if((event.type==='mousemove'||event.type==='pointermove')&&drag){
                const dx=(x-drag.startX)/rect.width, dy=(y-drag.startY)/rect.height;
                if(drag.kind==='draw') node.vrpRegionDraft={x:Math.min(drag.startX,x),y:Math.min(drag.startY,y),width:Math.abs(x-drag.startX),height:Math.abs(y-drag.startY)};
                else {
                    const b=state.bbox,o=drag.original;
                    if(drag.kind==='move'){b.x=o.x+dx;b.y=o.y+dy;}
                    else {
                        if(drag.edges.left){b.x=o.x+dx;b.width=o.width-dx;}
                        if(drag.edges.right)b.width=o.width+dx;
                        if(drag.edges.top){b.y=o.y+dy;b.height=o.height-dy;}
                        if(drag.edges.bottom)b.height=o.height+dy;
                    }
                    clampBBox(b);
                }
                node.graph?.setDirtyCanvas(true,true); return true;
            }
            if((event.type==='mouseup'||event.type==='pointerup')&&drag){
                if(drag.kind==='draw'){
                    const draft=node.vrpRegionDraft; delete node.vrpRegionDraft;
                    if(draft&&draft.width>=6&&draft.height>=6){
                        state.bbox={x:(draft.x-rect.x)/rect.width,y:(draft.y-rect.y)/rect.height,
                            width:draft.width/rect.width,height:draft.height/rect.height}; clampBBox(state.bbox);
                    }
                }
                drag=null; saveState(); return true;
            }
            return true;
        };
        addStatusWidget(node,()=>[regionStatus(node)]);
        const editMask=()=>{
            if(node.vrpRegionBusy)return;
            return runOperation('Preparing Mask Editor…',current=>openRegionMaskEditor(node,current));
        };
        const edit=node.addWidget('button','Edit region mask','',editMask,{serialize:false});
        // The native action opens node.images directly, bypassing preparation
        // and save tracking. Route only this Region's menu through the button's
        // managed operation, including before a native image exists.
        const priorMenu=node.getExtraMenuOptions;
        node.getExtraMenuOptions=function(canvas,options){
            const result=priorMenu?.call(this,canvas,options);
            let foundEdit=false;
            for(const option of [...options,...(Array.isArray(result)?result:[])]){
                if(/Open.*MaskEditor|Open Mask Editor/.test(option?.content || '')){
                    option.callback=editMask;foundEdit=true;
                }
            }
            if(!foundEdit)options.push({content:'Open in MaskEditor | Image Canvas',callback:editMask});
            return result || [];
        };
        const clear=node.addWidget('button','Clear region mask','',()=>
            runOperation('Clearing region mask…',current=>clearRegionMask(node,storeMaskSource,current)),{serialize:false});
        edit.serialize=false; clear.serialize=false;
        const modeChanged=()=>{if(!node.vrpRegionQuiet) repaintNode(node);node.graph?.setDirtyCanvas(true,true);};
        observeValue(modeWidget,modeChanged);
        observeValue(stateWidget,()=>{if(!node.vrpRegionQuiet&&!removed){cancelOperation();state=readState(node);node.vrpRegionState=state;void refreshMaskPreview(node);redrawRegionViews(node);}});
        const imagesChanged=()=>{
            if(node.vrpRegionQuiet || removed) return;
            if(node.vrpRegionMaskEditActive){
                const savedReference=currentNodeImageReference(node);
                const editorSource=String(node.vrpRegionMaskEditSource||'');
                // Only the native saver's uploaded output is an authored save;
                // execution/preview/cache replacements must not consume it.
                if(isNativeSavedMaskReference(savedReference) && !sameImageReference(savedReference,editorSource)){
                    storeMaskSource(savedReference,node.vrpRegionMaskEditView);
                    node.vrpRegionMaskEditActive=false;
                    node.vrpRegionMaskEditSource='';
                }
            }
            refreshMaskPreview(node); repaintNode(node);
        };
        // ComfyUI 1.53.x's Mask Editor saver updates its widget-value store,
        // then replaces node.images. The widget value itself is not mutated,
        // so observing that widget misses saved brush edits.
        observeProperty(node,'images',imagesChanged);
        const executed=node.onExecuted;
        trackQueuedPreview(node,()=>({mask:externalMaskSignature(node)}));
        node.onExecuted=function(message,...args){
            const result=executed?.call(this,message,...args);
            const payload=message?.vrp_region_preview ?? message?.ui?.vrp_region_preview;
            const preview=Array.isArray(payload)?payload[0]:payload;
            if(preview?.regions?.[0]){
                const region=preview.regions[0];region.signature=queuedPreviewProvenance(message)?.mask;
                this.vrpRegionRuntimePreview=region;prepareRuntimeMask(this,region);
            }
            this.graph?.setDirtyCanvas(true,true);return result;
        };

        const configured=node.onConfigure;
        node.onConfigure=function(info,...args){
            cancelOperation();
            const result=configured?.apply(this,[info,...args]);
            state=readState(this);this.vrpRegionState=state;
            const savedValues=info?.widgets_values;
            const maskLink=info?.inputs?.find(input=>input.name==='external_mask')?.link ?? this.inputs?.find(input=>input.name==='external_mask')?.link;
            // M4.5 serialized five widgets. Its connected MASK must remain the
            // source after the three authoring widgets are introduced.
            if(Array.isArray(savedValues)&&savedValues.length<=5&&maskLink!=null) updateWidget(this,'authoring_mode','External MASK');
            const legacyRef=this.properties?.image || legacyImageWidget?.value;
            if(!state.painted_mask.image_ref && readMode(this)==='Painted Mask' && isNativeSavedMaskReference(legacyRef)) {
                // Recover saves made on frontends where the Mask Editor updated
                // properties.image but the separate widget store bypassed the
                // old LiteGraph widget observer.
                storeMaskSource(String(legacyRef));
            }
            syncCanvas(); refreshMaskPreview(this); this.graph?.setDirtyCanvas(true,true);
            return result;
        };
        const canvasListener=event=>{
            const source=linkedNode(node,'canvas'), detail=event?.detail||{};
            if(source&&String(source.id)===String(detail.nodeId)&&
                (detail.graphId==null||String(detail.graphId)===String(source.graph?.id))) {syncCanvas();void refreshMaskPreview(node);}
        };
        canvasEvents?.addEventListener('canvas-changed',canvasListener);
        const priorConnections=node.onConnectionsChange;
        node.onConnectionsChange=function(type,slot,connected,link,input){
            const result=priorConnections?.call(this,type,slot,connected,link,input);
            const name=input?.name||this.inputs?.[slot]?.name;
            if(name==='canvas')syncCanvas();
            if(name==='previous_regions')this.graph?.setDirtyCanvas(true,true);
            return result;
        };
        const priorRemoved=node.onRemoved;
        node.onRemoved=function(...args){removed=true;node.vrpRegionRemoved=true;cancelOperation();canvasEvents?.removeEventListener('canvas-changed',canvasListener);priorRemoved?.apply(this,args);};
        const priorAdded=node.onAdded;
        node.onAdded=function(...args){const result=priorAdded?.apply(this,args);syncCanvas();return result;};
        syncCanvas(); refreshMaskPreview(node);
        node.setSize?.([420,680]);
        fitVisibleWidgets(node);
        node.graph?.setDirtyCanvas(true,true);
    },
});
