import { observeValue, observeProperty, showEditorImage,
    openEditor, hideNativeImagePreview, fitVisibleWidgets, imageURL, upload,
    configuredWidgetValue, writeSerializedWidgetValue } from './classic_adapter.js';
import { installUserConfig, setWidgetVisible, addStatusWidget } from './region_ui.js';
import { referenceString, loadRaster, raster, rasterSize, whiteRaster, rasterBlob, inspectSavedRaster,
    resizeDocument, clipspaceReference, installDocumentInputs, editorMaskOverlay } from './canvas_document_adapter.js';

import { viewMetadata, alignRaster, isBlankRaster, minimumStep, normalizeDimension } from './image_alignment.js';
import { randomUUID } from './uuid.js';
// Loaded only on rich-editor operations; old workflows keep their native path.
const canvasBridge=()=>import('./canvas_loader_bridge.js');

const clone=value=>JSON.parse(JSON.stringify(value));
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const validCanvasSize=(w,h,multiple=32)=>[w,h].every(n=>Number.isInteger(n)&&n>=multiple&&n<=4096&&n%multiple===0);

export function megapixelSize(a,b,megapixels,step) {
    const gcd=(x,y)=>y?gcd(y,x%y):x;
    const divisor=gcd(a,b),w=a/divisor*step,h=b/divisor*step;
    const max=Math.floor(4096/Math.max(w,h));
    if(max<1)throw Error('Aspect ratio cannot fit within 4096 at this step');
    const scale=Math.sqrt(megapixels*1e6/(w*h));
    const candidates=[Math.floor(scale),Math.ceil(scale)].map(k=>Math.min(max,Math.max(1,k)));
    candidates.sort((x,y)=>Math.abs(w*h*x*x-megapixels*1e6)-Math.abs(w*h*y*y-megapixels*1e6));
    return [w*candidates[0],h*candidates[0]];
}

export function attachImageDocument(node, integration={}) {
    const widget=name=>node.widgets.find(w=>w.name===name),get=name=>widget(name).value;
    let state=null,epoch=0,restoreEpoch=0,removed=false,quiet=false,session=null,warning=null,busy=null,error=null;
    let activeImage=null,workingImage=null,workingKey=null,effectiveMode=null,view=null,undoButton,redoButton,swapButton;
    let sourceMask=null,workingMask=null,maskEpoch=0,maskWarning=null;
    let canvasSession=null;
    const setting=(name,fallback)=>widget(name)?.value ?? fallback;
    const sizePresets=node.vrpUserConfig?.canvas_presets || {};
    const mpPresets=node.vrpUserConfig?.canvas_mp_presets || {};
    const configuredHistoryLimit=node.vrpUserConfig?.loader_history_limit;
    const historyLimit=Number.isInteger(configuredHistoryLimit)&&configuredHistoryLimit>=1&&configuredHistoryLimit<=1000?configuredHistoryLimit:50;
    const multiple=minimumStep(node.vrpUserConfig),steps=[8,16,32,64,128].filter(n=>n>=multiple);
    const normalizedControls=new Map();
    const hasVAE=()=>node.inputs?.some(input=>input.name==='vae'&&input.link!=null) ?? false;
    const mutate=fn=>{const prior=quiet;quiet=true;try{return fn();}finally{quiet=prior;}};
    const persist=()=>mutate(()=>{
        const serialized=JSON.stringify(state);
        if(widget('document_state').value!==serialized) {
            widget('document_state').value=serialized;node.graph?.incrementVersion?.();
        }
    });
    const dirty=()=>{
        if(undoButton)undoButton.disabled=!!busy || !state?.history?.length;
        if(redoButton)redoButton.disabled=!!busy || !state?.redo?.length;
        if(swapButton)swapButton.disabled=!!busy || sizeLinked();
        fitVisibleWidgets(node);node.graph?.setDirtyCanvas(true,true);
    };
    const report=value=>{error=String(value.message || value);busy=null;dirty();};
    const start=label=>{error=null;busy=label;dirty();return ++epoch;};
    const current=token=>!removed&&token===epoch;
    const documentImage=async doc=>{
        if(doc.image_ref)return loadRaster(doc.image_ref);
        const image=new Image();image.src=whiteRaster(doc.width,doc.height).toDataURL('image/png');
        await image.decode();return image;
    };

    function trimTimeline(history,redo) {
        // Match backend normalization when a workflow exceeds a lower limit.
        const excess=Math.max(0,history.length+redo.length-historyLimit),dropUndo=Math.min(excess,history.length);
        return {history:history.slice(dropUndo),redo:redo.slice(excess-dropUndo)};
    }
    function initialize() {
        state=JSON.parse(get('document_state'));
        if(state && !Object.hasOwn(state,'redo'))state.redo=[];
        if(state && !Object.hasOwn(state,'alignment_revision'))state.alignment_revision=0;
        if(state && (!Number.isInteger(state.alignment_revision)||state.alignment_revision<0))throw Error('Invalid alignment revision');
        workingKey=null;
        if(!state || state.version!==1 || !state.active || !Array.isArray(state.history) || !Array.isArray(state.redo) ||
            !state.retained || !Number.isInteger(state.revision) || state.revision<0)
            throw Error('Invalid saved canvas document state');
        state={...state,...trimTimeline(state.history,state.redo)};
        if(state.active.id==='initial'&&!Object.hasOwn(state.active,'canvas_document'))state.active.id=randomUUID();
        state=clone(state);persist();
    }
    function assertDocumentImage(doc,image) {
        if(rasterSize(image).join('x')!==`${doc.width}x${doc.height}`)
            throw Error('Document/image dimensions disagree; import it again');
    }
    async function refreshMaskOverlay() {
        const token=++maskEpoch,doc=state.active,ref=doc.editor_ref || doc.image_ref;
        sourceMask=null;workingMask=null;maskWarning=null;
        if(!ref)return;
        try {
            const image=await loadRaster(ref,'rgba');
            if(removed || token!==maskEpoch)return;
            assertDocumentImage(doc,image);
            sourceMask=editorMaskOverlay(image);
            workingMask=sourceMask ? alignRaster(sourceMask,view,false) : null;
            dirty();
        } catch(e) {if(!removed && token===maskEpoch){maskWarning=`Mask preview unavailable: ${e.message || e}`;dirty();}}
    }
    function display(image) {
        const doc=state.active;
        assertDocumentImage(doc,image);
        activeImage=image;node.imageSourceImage=image;
        updateWorkingImage();
        void refreshMaskOverlay();
        // This own preview is independent of native async thumbnail completions.
        // Native node.images remains observable for actual editor saves.
        const ref=doc.editor_ref || doc.image_ref;
        mutate(()=>showEditorImage(node,image,ref ? imageURL(ref).ref : null));
        
        busy=null;dirty();
    }
    function commit(doc,image,{history=true,timeline=null}={}) {
        // Reject stale/mismatched file contents before publishing or persisting
        // any part of the document transaction.
        assertDocumentImage(doc,image);
        const old=state.active;
        const retained={...state.retained,[old.origin]:clone(old),[doc.origin]:clone(doc)};
        const stacks=timeline || (history ? {history:[...state.history,clone(old)],redo:[]} : state);
        state={version:1,revision:state.revision+1,alignment_revision:state.alignment_revision,active:clone(doc),retained,
            ...trimTimeline(stacks.history,stacks.redo)};
        persist();display(image);
    }
    async function activate(doc,options={}) {
        const token=start('Loading canvas…');
        try {const image=await documentImage(doc);if(current(token))commit(doc,image,options);}
        catch(e){if(current(token))report(e);}
    }
    async function restoreWorkflow() {
        if(removed)return;
        const token=start('Loading saved canvas…');session=null;canvasSession?.close();canvasSession=null;restoreEpoch++;warning=null;
        maskEpoch++;sourceMask=null;workingMask=null;maskWarning=null;
        activeImage=null;workingImage=null;view=null;effectiveMode=null;
        node.imageSourceImage=null;node.imageWorkingImage=null;node.imageDocumentState=null;
        node.imageDocumentReady=false;integration.clear?.(node);
        try {normalizeControls();initialize();const image=await documentImage(state.active);if(current(token))display(image);}
        catch(e){if(current(token)){activeImage=null;node.imageDocumentReady=false;integration.clear?.(node);report(e);}}
    }
    async function importReference(reference,token=start('Importing image…')) {
        try {
            const inspected=await inspectSavedRaster(reference,'imported',randomUUID());
            const image=await documentImage(inspected.document);
            if(current(token)){warning=inspected.warning;commit(inspected.document,image);}
        }catch(e){if(current(token))report(e);}
    }
    async function importFile(file) {
        const token=start('Uploading image…');
        try {const ref=await upload(file,file.name || 'pasted-image.png');
            if(current(token))await importReference(ref,token);
        }catch(e){if(current(token))report(e);}
    }
    async function acceptEdit(reference,captured) {
        try {
            const inspected=await inspectSavedRaster(reference,captured.document.origin,captured.document.id);
            const image=await documentImage(inspected.document);
            if(removed || captured.restoreEpoch!==restoreEpoch)return;
            if(current(captured.epoch)&&equal(state.active,captured.document)) {
                warning=inspected.warning;commit(inspected.document,image);
            } else if(busy || state.redo.length) {
                // Never rewrite the linear undo/redo branch beneath a pending
                // restore. Native files already exist and can be imported to
                // recover this detached edit; no snapshot or revision changes.
                warning=`An older canvas edit was saved to ${reference}. Import it to recover; the current canvas and Undo/Redo history were not changed.`;
                if(activeImage)mutate(()=>showEditorImage(node,activeImage,
                    state.active.editor_ref || state.active.image_ref ? imageURL(state.active.editor_ref || state.active.image_ref).ref : null));
                dirty();
            } else {
                // A late save belongs to the document that opened the editor,
                // never to a newer import/create/restore now displayed.
                const history=state.history.map(doc=>equal(doc,captured.document)?clone(inspected.document):doc);
                if(!history.some(doc=>equal(doc,inspected.document)))history.push(clone(inspected.document));
                state={...state,...trimTimeline(history,state.redo)};
                if(equal(state.retained[captured.document.origin],captured.document))
                    state.retained={...state.retained,[captured.document.origin]:clone(inspected.document)};
                persist();warning='An older canvas edit was saved in history; the current canvas was not replaced.';
                if(activeImage)display(activeImage);
            }
        } catch(e){if(!removed && captured.restoreEpoch===restoreEpoch){
            if(current(captured.epoch))report(e);
            else {warning=`An older canvas edit could not be loaded: ${e.message || e}`;dirty();}
        }}
    }
    observeProperty(node,'images',images=>{
        if(quiet || removed || !session)return;
        const reference=referenceString(images?.[0]);
        if(!reference || reference===session.reference)return;
        // The native saver commits its file-backed reference only after uploads.
        if(!imageURL(reference).ref.filename.startsWith('clipspace-painted-masked-'))return;
        const captured=session;session=null;
        void acceptEdit(reference,captured);
    });
    async function edit() {
        const token=start('Preparing Mask Editor…');session=null;
        try {
            if(Object.hasOwn(state.active,'canvas_document'))throw Error('This document contains editable Canvas layers. Use Edit canvas; native fallback requires a separate snapshot.');
            let doc=clone(state.active),image=activeImage || await documentImage(doc);
            if(!current(token))return;
            if(!activeImage)display(image);
            // Edit the retained full-resolution source, not the aligned working view.
            if(!doc.image_ref) {
                const ref=await upload(await rasterBlob(raster(doc.width,doc.height,image)),`vrp-blank-${randomUUID()}.png`);
                if(!current(token))return;
                doc={...doc,image_ref:ref,editor_ref:ref};commit(doc,image,{history:false});
            }
            if(!current(token))return;
            // Explicitly restore all native layer files, not the opaque preview.
            if(!doc.layers && imageURL(doc.editor_ref || doc.image_ref).ref.filename.startsWith('clipspace-painted-masked-'))
                throw Error('Saved editor layers are unavailable. Restore the files or explicitly import the RGB composite as a new image.');
            if(doc.layers) {
                const layers=await Promise.all([loadRaster(doc.layers.base_ref),loadRaster(doc.layers.paint_ref,'rgba'),loadRaster(doc.editor_ref)]);
                if(layers.some(layer=>rasterSize(layer).join('x')!==`${doc.width}x${doc.height}`))
                    throw Error('Saved editor layer dimensions disagree; restore the layer files');
                if(!current(token))return;
            } else {
                await loadRaster(doc.editor_ref || doc.image_ref);
                if(!current(token))return;
            }
            mutate(()=>showEditorImage(node,image,imageURL(doc.editor_ref || doc.image_ref).ref));
            session={document:clone(doc),reference:doc.editor_ref || doc.image_ref,epoch:token,restoreEpoch};
            busy=null;openEditor(node);dirty();
        }catch(e){if(current(token)){session=null;report(e);}}
    }
    async function editCanvas() {
        if(canvasSession){canvasSession.focus();return;}
        if(removed||busy||!state||!activeImage)return;
        const token=start('Preparing Canvas…'),captured=clone(state.active),restored=restoreEpoch,saved=new Map();session=null;
        let closed=false;
        const assertCurrent=signal=>{
            if(signal?.aborted||closed||!current(token)||restored!==restoreEpoch||!equal(state.active,captured))
                throw Error('The source canvas changed or this editor was closed. Apply was not committed.');
        };
        try{
            const bridge=await canvasBridge(),loaded=await bridge.loadCanvasDocument(captured);assertCurrent();
            const handle=await bridge.openCanvasEditor({initialDocument:loaded.document,initialAssets:loaded.assets,backgroundId:loaded.backgroundId,
                behaviorDefaults:node.vrpUserConfig?.canvas_editor,
                onApply:async payload=>{assertCurrent(payload.signal);const result=await bridge.saveCanvasDocument(captured,payload,{saved,assertCurrent:()=>assertCurrent(payload.signal)});assertCurrent(payload.signal);warning=null;commit(result.document,result.image);},
                onClose:()=>{closed=true;canvasSession=null;if(current(token))busy=null;dirty();},
            });
            if(closed||!current(token)||restored!==restoreEpoch){handle.close();return;}
            canvasSession=handle;busy=null;dirty();
        }catch(e){if(current(token)&&!closed)report(e);}
    }
    function proposedSize() {
        normalizeControls();
        const size=[Number(get('width')),Number(get('height'))];
        if(!validCanvasSize(...size,multiple))throw Error(`Proposed dimensions must be multiples of ${multiple} between ${multiple} and 4096`);
        return size;
    }
    async function createBlank() {
        try {
            const [width,height]=proposedSize();warning=null;
            await activate({id:randomUUID(),width,height,origin:'blank',image_ref:null,editor_ref:null,layers:null});
        }catch(e){report(e);}
    }
    async function resize() {
        let token;
        try {
            const [width,height]=proposedSize();token=start('Resizing all canvas layers…');
            let doc,image;
            if(Object.hasOwn(state.active,'canvas_document')){const bridge=await canvasBridge(),result=await bridge.resizeCanvasDocument(clone(state.active),width,height,{assertCurrent:()=>{if(!current(token))throw Error('Canvas changed while resizing.');}});doc=result.document;image=result.image;}
            else{doc=await resizeDocument(clone(state.active),width,height);image=await documentImage(doc);}
            if(current(token)){warning=null;commit(doc,image);}
        }catch(e){if(token===undefined || current(token))report(e);}
    }
    async function historyImage(doc) {
        const image=await documentImage(doc);
        assertDocumentImage(doc,image);
        if(Object.hasOwn(doc,'canvas_document'))await (await canvasBridge()).loadCanvasDocument(doc);
        // Restore complete native edit state, not just a surviving composite.
        // Verify all referenced artifacts before consuming either history stack.
        const refs=new Set([doc.editor_ref,...Object.values(doc.layers || {})]);
        refs.delete(null);refs.delete(undefined);refs.delete(doc.image_ref);
        const layers=await Promise.all([...refs].map(ref=>loadRaster(ref,'rgba')));
        if(layers.some(layer=>rasterSize(layer).join('x')!==`${doc.width}x${doc.height}`))
            throw Error('Saved canvas history layer dimensions disagree; restore its files before Undo/Redo');
        return image;
    }
    async function navigateHistory(direction) {
        const backward=direction==='undo',stack=backward ? state.history : state.redo;
        if(!stack.length){report(backward ? 'No earlier canvas change to undo' : 'No canvas change to redo');return;}
        warning=null;
        const token=start(backward ? 'Restoring previous canvas…' : 'Restoring next canvas…'),doc=clone(stack.at(-1));
        try {
            const image=await historyImage(doc);
            if(current(token))commit(doc,image,{timeline:backward ? {
                history:state.history.slice(0,-1),redo:[...state.redo,clone(state.active)],
            } : {
                history:[...state.history,clone(state.active)],redo:state.redo.slice(0,-1),
            }});
        }catch(e){if(current(token))report(e);}
    }
    const undo=()=>navigateHistory('undo'),redo=()=>navigateHistory('redo');
    async function restore(origin) {
        const doc=state.retained[origin];
        if(!doc){report(`No retained ${origin} canvas`);return;}
        warning=null;await activate(clone(doc));
    }
    function pendingPreset() {
        if(quiet)return;
        try {
            const preset=get('preset');
            const size=mpPresets[preset] ? megapixelSize(...mpPresets[preset],Number(get('step'))) : sizePresets[preset];
            if(size)mutate(()=>{widget('width').value=size[0];widget('height').value=size[1];});
            normalizeControls();
            dirty();
        }catch(e){report(e);}
    }
    function normalizeControls() {
        let changed=false;
        mutate(()=>{
            for(const name of ['step','width','height']) {
                const item=widget(name),before=item.value;
                const value=name==='step'?(Number.isFinite(Number(before))?(steps.find(n=>n>=Number(before)) ?? steps.at(-1)):multiple):normalizeDimension(before,multiple);
                if(before!==value){item.value=value;normalizedControls.set(name,`${name==='step'?'Step':name==='width'?'Width':'Height'}: ${before} → ${value}`);changed=true;}
            }
        });
        if(changed)node.graph?.incrementVersion?.();
    }
    function applyStep(recalculate=true) {
        normalizeControls();
        widget('step').options ??= {};widget('step').options.values=steps;
        for(const name of ['width','height']) {
            widget(name).options ??= {};
            widget(name).options.min=multiple;widget(name).options.max=4096;
            widget(name).options.step2=Number(get('step'));
            widget(name).options.step=Number(get('step'))*10;
        }
        if(recalculate)pendingPreset();
    }
    function swapSize() {
        if(busy || sizeLinked())return;
        const width=get('width'),height=get('height');
        // One proposal transaction: neither an intermediate preset calculation
        // nor a document/history commit is triggered by swapping dimensions.
        mutate(()=>{
            widget('preset').value='Custom';
            widget('width').value=height;widget('height').value=width;
        });
        node.graph?.incrementVersion?.();dirty();node.vrpPreviewUI?.refresh();
    }
    function sizeLinked() {
        return node.inputs?.some(input=>['width','height'].includes(input.widget?.name) && input.link!=null);
    }
    observeValue(widget('preset'),pendingPreset);
    observeValue(widget('step'),()=>{if(!quiet)applyStep();});
    for(const name of ['width','height'])observeValue(widget(name),()=>{
        if(!quiet){normalizeControls();mutate(()=>{widget('preset').value='Custom';});dirty();}
    });
    function updateWorkingImage(trackPolicy=false) {
        if(!state || !activeImage)return;
        effectiveMode=get('latent_mode');
        if(effectiveMode==='Auto')effectiveMode=state.active.origin==='blank'&&isBlankRaster(activeImage)?'Empty':'Encode';
        const method=effectiveMode==='Empty'?'Pad':setting('alignment_method','Pad');
        view=viewMetadata(state.active,method,multiple);
        const aligned=view.width===state.active.width&&view.height===state.active.height;
        const key=JSON.stringify([state.active.id,view.width,view.height,aligned?'identity':method,multiple]);
        if(trackPolicy&&workingKey!==null&&workingKey!==key) {state.alignment_revision++;persist();}
        workingKey=key;
        workingImage=alignRaster(activeImage,view);
        workingMask=sourceMask ? alignRaster(sourceMask,view,false) : null;
        node.imageWorkingImage=workingImage;node.imageDocumentReady=true;node.imageEffectiveLatentMode=effectiveMode;
        node.imageAlignmentView=view;node.imageDocumentState=clone(state);
        integration.publish?.(node,{version:1,width:view.width,height:view.height,
            revision:state.revision+state.alignment_revision,source:state.active.origin==='blank'?'blank':'image',
            image_ref:aligned?state.active.image_ref:null,alignment:view,ready:true},workingImage);
    }
    const settingsChanged=()=>{if(!quiet){updateWorkingImage(true);dirty();}};
    observeValue(widget('latent_mode'),settingsChanged);
    if(widget('alignment_method'))observeValue(widget('alignment_method'),settingsChanged);
    if(widget('apply_to_image'))observeValue(widget('apply_to_image'),dirty);
    setWidgetVisible(widget('document_state'),false);
    observeValue(widget('document_state'),()=>{if(!quiet)void restoreWorkflow();});

    const preview=node.addWidget('custom','active_canvas',null,()=>{},{serialize:false});preview.serialize=false;
    preview.computeSize=()=>{const image=setting('apply_to_image',!!integration.publish)?workingImage:activeImage;
        return [0,Math.min(420,Math.max(100,(node.size[0]-16)*(image?.naturalHeight||image?.height||1024)/(image?.naturalWidth||image?.width||1024)))];};
    preview.draw=ctx=>{
        const height=preview.computeSize()[1],width=node.size[0]-16,y=preview.last_y ?? 0;
        ctx.save();ctx.fillStyle='#202020';ctx.fillRect(8,y,width,height);
        const displayed=setting('apply_to_image',!!integration.publish)?workingImage:activeImage;
        if(displayed) {
            const [iw,ih]=rasterSize(displayed),scale=Math.min(width/iw,height/ih);
            ctx.drawImage(displayed,8+(width-iw*scale)/2,y+(height-ih*scale)/2,iw*scale,ih*scale);
            const mask=setting('apply_to_image',!!integration.publish)?workingMask:sourceMask;
            if(mask)ctx.drawImage(mask,8+(width-iw*scale)/2,y+(height-ih*scale)/2,iw*scale,ih*scale);
        }
        ctx.restore();
    };
    // Keep canonical backend widgets first: classic positional serialization
    // must not acquire a non-serialized preview hole before its input values.
    const dimensions=node.addWidget('custom','Active canvas',null,()=>{},{serialize:false});dimensions.serialize=false;
    dimensions.computeSize=()=>[0,44];
    // Actual dimensions remain distinct from the pending creation controls.
    dimensions.draw=ctx=>{
        const doc=state?.active;
        dimensions.value=doc ? `Source: ${doc.width} × ${doc.height} · Working: ${view?.width} × ${view?.height}` : 'No active image';
        ctx.save();ctx.fillStyle='#ccc';ctx.font='12px sans-serif';ctx.fillText(dimensions.value,12,(dimensions.last_y ?? 0)+15);
        ctx.fillStyle=get('latent_mode')==='Auto'?'#96c9a7':'#ccc';
        ctx.fillText(`Latent: ${get('latent_mode')==='Auto'?'Auto → ':''}${effectiveMode || 'loading'}`,12,(dimensions.last_y ?? 0)+34);ctx.restore();
    };
    const pending=node.addWidget('custom','Proposed size preview',null,()=>{},{serialize:false});pending.serialize=false;
    pending.computeSize=()=>[0,112];
    pending.draw=ctx=>{
        const width=Number(get('width')),height=Number(get('height')),y=pending.last_y ?? 0;
        const available=Math.max(40,node.size[0]-24),scale=Math.min(available/width,76/height);
        ctx.save();ctx.fillStyle='#252525';ctx.fillRect(8,y,node.size[0]-16,112);
        if(width>0&&height>0&&Number.isFinite(scale)){
            ctx.fillStyle='#355f87';ctx.fillRect(12+(available-width*scale)/2,y+4+(76-height*scale)/2,width*scale,height*scale);
        }
        pending.value=`Pending: ${width} × ${height} · ${Number.isFinite(width/height)?Number((width/height).toFixed(2)):'?'} ratio`;
        ctx.fillStyle='#ccc';ctx.font='12px sans-serif';ctx.fillText(pending.value,12,y+100);ctx.restore();
    };
    addStatusWidget(node,()=>{
        if(busy)return [{level:'info',text:busy}];
        const messages=[];
        if(error)messages.push({level:'error',text:error});
        if(normalizedControls.size)messages.push({level:'warning',text:`Settings normalized to ${multiple}px. Source image unchanged. ${[...normalizedControls.values()].join('; ')}.`});
        if(multiple<32)messages.push({level:'warning',text:`${multiple}-pixel alignment enabled by configuration. Some models require dimensions divisible by 32.`});
        const doc=state?.active;
        const usesWorking=!!integration.publish||effectiveMode!=='Off'||setting('apply_to_image',false);
        const adjustment=usesWorking && doc && view && (doc.width!==view.width||doc.height!==view.height)
            ? {level:'warning',text:`${view.method} adjustment: ${doc.width} × ${doc.height} → ${view.width} × ${view.height}. Not a failure: source is preserved. IMAGE output: ${setting('apply_to_image',!!integration.publish)?'adjusted':'original'}.${view.method==='Crop'&&(doc.width<multiple||doc.height<multiple)?` Tiny axes are padded to ${multiple}.`:''}`} : null;
        if(effectiveMode?.startsWith('Encode') && !hasVAE())
            messages.unshift({level:'error',text:`${get('latent_mode')==='Auto'?'Auto → ':''}${effectiveMode}: connect a VAE before running`});
        if(adjustment)messages.push(adjustment);
        if(warning || maskWarning)messages.push({level:'warning',text:warning || maskWarning});
        if(messages.length)return messages;
        if(doc?.editor_ref && !doc.layers && imageURL(doc.editor_ref).ref.filename.startsWith('clipspace-painted-masked-'))
            return [{level:'warning',text:'Saved native layers are unavailable; layer-preserving editing/resize requires restoring the files.'}];
        if(get('latent_mode')==='Off')return [{level:'info',text:'Image/canvas ready; latent output is Off (connect your own latent)'}];
        return [{level:'ok',text:'Status: OK · size controls apply only on Create / Resize'}];
    },true);
    const button=(name,callback)=>{const item=node.addWidget('button',name,null,callback,{serialize:false});item.serialize=false;return item;};
    button('Create blank canvas',createBlank);
    button('Resize current canvas (stretch all layers)',resize);
    swapButton=button('Swap width and height',swapSize);
    undoButton=button('Undo canvas change',undo);
    redoButton=button('Redo canvas change',redo);
    button('Restore last blank canvas',()=>restore('blank'));
    button('Restore last imported canvas',()=>restore('imported'));
    button('Import image',()=>{
        const input=document.createElement('input');input.type='file';input.accept='image/*';
        input.onchange=()=>{if(input.files?.[0])void importFile(input.files[0]);};input.click();
    });
    button('Paste image from Clipspace',()=>{try{return importReference(clipspaceReference());}catch(e){report(e);}});
    const editorEntry=()=>node.comfyClass==='VRPCanvas'&&!Object.hasOwn(state.active,'canvas_document')?edit():editCanvas();
    // Keep the existing nonserialized holder name for presentation compatibility.
    button('Edit with Mask Editor',editorEntry);
    installDocumentInputs(node,importFile,importReference,editorEntry,report);
    hideNativeImagePreview(node);
    node.vrpFitWidgets=dirty;
    const configure=node.onConfigure;
    node.onConfigure=function(...args){configure?.apply(this,args);normalizedControls.clear();mutate(()=>{
        for(const name of ['document_state','width','height','step']){const saved=configuredWidgetValue(node,args[0],name);if(saved)widget(name).value=saved.value;}
    });applyStep(false);return restoreWorkflow();};
    const serialize=node.onSerialize;
    node.onSerialize=function(info,...args){serialize?.call(this,info,...args);for(const name of ['document_state','width','height','step'])writeSerializedWidgetValue(node,info,name,get(name));};
    const added=node.onAdded;
    node.onAdded=function(...args){added?.apply(this,args);return restoreWorkflow();};
    const connectionsChanged=node.onConnectionsChange;
    node.onConnectionsChange=function(...args){const result=connectionsChanged?.apply(this,args);Promise.resolve().then(()=>{if(!removed){dirty();node.vrpPreviewUI?.refresh();}});return result;};
    const removedCallback=node.onRemoved;
    node.onRemoved=function(...args){removed=true;epoch++;maskEpoch++;canvasSession?.close();canvasSession=null;sourceMask=null;workingMask=null;session=null;integration.clear?.(node);removedCallback?.apply(this,args);};
    // Testable controller, not serialized runtime or a frontend dependency of the backend.
    node.imageDocumentController={importReference,importFile,createBlank,resize,undo,redo,restore,edit,editCanvas,swapSize,
        multiple,stepChoices:steps,encodingUnavailable:value=>String(value).startsWith('Encode')&&!hasVAE()?'Connect a VAE to encode the image.':'',
        get editor(){return canvasSession?.editor??null;},get state(){return clone(state);},get idle(){return !busy&&!canvasSession;},get effectiveMode(){return effectiveMode;}};
    applyStep();node.setSize?.([Math.max(420,node.size[0]),node.size[1]]);
    void restoreWorkflow();
}
