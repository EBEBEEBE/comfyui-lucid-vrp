// File-backed boundary between loader edit turns and the independent editor.
// No graph lookup, native clipspace ownership or workflow execution here.
import * as model from './canvas_v1_document.js';
import {multiply,scaling} from './canvas_v1_geometry.js';
import {exportCanvasDocument} from './canvas_v1_renderer.js';
import {raster,emptyMask} from './canvas_v1_raster.js';
import {loadRaster,rasterSize,rasterBlob} from './canvas_document_adapter.js';
import {upload,imageURL,canvasPreferences} from './classic_adapter.js';
import {drawSource,TileRaster} from './canvas_v1_tiles.js';

const memory=ref=>ref.startsWith('memory:')||ref.startsWith('@');
const backgroundId=doc=>`background:${doc.id}`;
const checkSize=(image,w,h)=>{if(rasterSize(image).join('x')!==`${w}x${h}`)throw Error('Saved canvas asset dimensions disagree. Restore its original file before editing.');};
function maskPixels(image,width,height){
    const pixels=raster(width,height,image).getContext('2d').getImageData(0,0,width,height).data;
    for(let i=0;i<pixels.length;i+=4)if(pixels[i]!==pixels[i+1]||pixels[i]!==pixels[i+2]||pixels[i+3]!==255)throw Error('Saved canvas mask must be opaque grayscale coverage.');
    return pixels;
}

export async function loadCanvasDocument(doc) {
    if(Object.hasOwn(doc,'canvas_document')){
        const document=model.parseDocument(doc.canvas_document);
        if(document.id!==doc.id||document.width!==doc.width||document.height!==doc.height)throw Error('Saved editable canvas and loader dimensions disagree.');
        const refs=model.assetReferences(document);
        if(refs.some(memory))throw Error('Saved canvas contains an unsaved asset reference.');
        const assets=new Map(await Promise.all(refs.map(async ref=>[ref,await loadRaster(ref,'rgba',{fresh:true})])));
        for(const item of document.layers)if(item.asset_ref)checkSize(assets.get(item.asset_ref),item.width,item.height);
        if(document.mask.asset_ref)checkSize(assets.get(document.mask.asset_ref),doc.width,doc.height);
        // Validate coverage without rerendering RGB on every open/verification.
        if(document.mask.asset_ref)maskPixels(assets.get(document.mask.asset_ref),doc.width,doc.height);
        for(const item of document.layers)if(item.type==='paint'&&item.asset_ref)assets.set(item.asset_ref,TileRaster.from(assets.get(item.asset_ref)));
        if(document.mask.asset_ref)assets.set(document.mask.asset_ref,TileRaster.from(assets.get(document.mask.asset_ref),{mask:true}));
        return{document,assets,backgroundId:document.layers.some(l=>l.id===backgroundId(doc)&&l.type==='image')?backgroundId(doc):null};
    }
    if(!doc.layers&&doc.editor_ref&&imageURL(doc.editor_ref).ref.filename.startsWith('clipspace-painted-masked-'))
        throw Error('Saved native paint layers are unavailable. Restore them before opening Canvas, or explicitly import the RGB composite.');
    let document=model.createDocument({id:doc.id,width:doc.width,height:doc.height});
    const assets=new Map(),baseRef=doc.layers?.base_ref||doc.image_ref;
    const base=baseRef?await loadRaster(baseRef):raster(doc.width,doc.height);
    if(!baseRef){const c=base.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,doc.width,doc.height);}
    checkSize(base,doc.width,doc.height);
    const blank=doc.origin==='blank';
    if(blank){
        const pixels=raster(doc.width,doc.height,base).getContext('2d').getImageData(0,0,doc.width,doc.height).data;
        // White comes from the frame. Preserve any already painted legacy base
        // as editable paint instead of throwing it away during first conversion.
        if(!pixels.every(v=>v===255)){assets.set('memory:loader-base-paint',base);document=model.addLayer(document,model.createLayer({id:`base-paint:${doc.id}`,name:'Base paint',width:doc.width,height:doc.height,asset_ref:'memory:loader-base-paint'}));}
    }else{assets.set('memory:loader-background',base);document=model.addLayer(document,model.createLayer({id:backgroundId(doc),type:'image',name:'Background',width:doc.width,height:doc.height,asset_ref:'memory:loader-background'}));}
    if(doc.layers){
        const paint=await loadRaster(doc.layers.paint_ref,'rgba');checkSize(paint,doc.width,doc.height);
        assets.set('memory:loader-paint',paint);
        document=model.addLayer(document,model.createLayer({id:`native-paint:${doc.id}`,name:'Imported paint',width:doc.width,height:doc.height,asset_ref:'memory:loader-paint'}));
    }
    if(!blank||!document.layers.length)document=model.addLayer(document,model.createLayer({id:`paint:${doc.id}`,name:'Paint',width:doc.width,height:doc.height}));
    const ref=doc.editor_ref||doc.image_ref;
    if(ref){
        const source=await loadRaster(ref,'rgba');checkSize(source,doc.width,doc.height);
        const input=raster(doc.width,doc.height,source).getContext('2d').getImageData(0,0,doc.width,doc.height);
        const mask=emptyMask(doc.width,doc.height),ctx=mask.getContext('2d'),out=ctx.getImageData(0,0,doc.width,doc.height);let selected=false;
        for(let i=0;i<input.data.length;i+=4){const coverage=255-input.data[i+3];selected ||= coverage>0;out.data.set([coverage,coverage,coverage,255],i);}
        if(selected){ctx.putImageData(out,0,0);assets.set('memory:loader-mask',mask);document=model.setMaskReference(document,'memory:loader-mask');}
    }
    return{document,assets,backgroundId:blank?null:backgroundId(doc)};
}

// Uploading files is preparatory. Only the caller commits the returned snapshot.
// Retry cache belongs to one editor session; partial failures cannot publish.
export async function saveCanvasDocument(doc,payload,{assertCurrent=()=>{},saved=new Map()}={}) {
    assertCurrent();const document=model.parseDocument(payload.document);
    if(document.id!==doc.id||document.width!==doc.width||document.height!==doc.height)throw Error('Canvas identity or output dimensions changed during editing.');
    const assets=payload.assets,refs=model.assetReferences(document),replacements=new Map();
    const output=payload.imageBlob&&payload.nativeMaskBlob?payload:await exportCanvasDocument(document,assets);assertCurrent();
    for(const ref of refs){
        assertCurrent();if(!assets.has(ref))throw Error(`Missing editable canvas asset: ${ref}`);
        const item=document.layers.find(item=>item.asset_ref===ref),image=assets.get(ref);
        checkSize(image,item?.width??doc.width,item?.height??doc.height);
        if(!memory(ref)){replacements.set(ref,ref);continue;}
        if(!saved.has(ref))saved.set(ref,await upload(output.assetBlobs?.get(ref)??await rasterBlob(raster(...rasterSize(image),image)),`lucid-asset-${crypto.randomUUID()}.png`));
        assertCurrent();replacements.set(ref,saved.get(ref));
    }
    const persistent=model.parseDocument({...document,layers:document.layers.map(item=>({...item,asset_ref:item.asset_ref===null?null:replacements.get(item.asset_ref)})),mask:{asset_ref:document.mask.asset_ref===null?null:replacements.get(document.mask.asset_ref)}});
    // Use one canonical render, including hidden-asset validation at reopen.
    const image_ref=await upload(output.imageBlob,`lucid-composite-${crypto.randomUUID()}.png`);assertCurrent();
    // /upload/mask copies alpha onto the opaque composite without destroying
    // RGB under fully selected mask pixels through PNG premultiplication.
    const editor_ref=await upload(output.nativeMaskBlob,`lucid-mask-${crypto.randomUUID()}.png`,imageURL(image_ref).ref);assertCurrent();
    const next={...doc,image_ref,editor_ref,layers:null,canvas_document:persistent};
    const loaded=await loadCanvasDocument(next);assertCurrent();
    const image=await loadRaster(image_ref);checkSize(image,doc.width,doc.height);assertCurrent();
    // Native-mask output is used by the backend; verify it before publication.
    const native=await loadRaster(editor_ref,'rgba');checkSize(native,doc.width,doc.height);
    const data=raster(doc.width,doc.height,native).getContext('2d').getImageData(0,0,doc.width,doc.height).data;
    const maskRef=loaded.document.mask.asset_ref,coverage=maskRef?maskPixels(loaded.assets.get(maskRef),doc.width,doc.height):null;
    for(let i=0;i<data.length;i+=4)if(255-data[i+3]!== (coverage?.[i]??0))throw Error('Saved native mask disagrees with editable mask coverage. Apply was not committed.');
    assertCurrent();return{document:next,image};
}

export async function resizeCanvasDocument(doc,width,height,options={}) {
    const {document,assets}=await loadCanvasDocument(doc),matrix=scaling(width/doc.width,height/doc.height);
    const next={...document,width,height,layers:document.layers.map(item=>item.parent_id?item:{...item,transform:multiply(matrix,item.transform)})};
    if(document.mask.asset_ref){
        const ref=`memory:resize:${crypto.randomUUID()}`,mask=emptyMask(width,height);
        drawSource(mask.getContext('2d'),assets.get(document.mask.asset_ref),0,0,width,height);assets.set(ref,mask);next.mask={asset_ref:ref};
    }
    return saveCanvasDocument({...doc,width,height},{document:next,assets},options);
}

// Native dialog supplies focus trapping/inert background. Stop events at this
// boundary as Shadow DOM retargeting can hide text inputs from graph shortcuts.
export async function openCanvasEditor(options) {
    const {mountCanvasEditor}=await import('./canvas_v1_editor.js');
    const previous=document.activeElement,dialog=document.createElement('dialog'),host=document.createElement('div');
    dialog.setAttribute('aria-label','LuCiD Canvas');dialog.setAttribute('aria-modal','true');dialog.dataset.lucidCanvas='';
    dialog.style.cssText='position:fixed;inset:0;width:calc(100vw - 24px);height:calc(100dvh - 24px);max-width:1700px;max-height:1200px;padding:0;border:1px solid #637b96;border-radius:12px;background:#182634;color:#ddd;overflow:hidden;z-index:100000;';
    host.style.cssText='display:block;width:100%;height:100%;';dialog.append(host);document.body.append(dialog);
    let editor,closed=false;
    const close=()=>{if(closed)return;closed=true;editor?.destroy();dialog.close();dialog.remove();options.onClose?.();if(previous?.isConnected)previous.focus({preventScroll:true});};
    for(const name of ['keydown','keyup','pointerdown','pointermove','pointerup','click','dblclick','contextmenu','wheel','dragover','drop'])dialog.addEventListener(name,event=>event.stopPropagation());
    dialog.addEventListener('dragover',event=>event.preventDefault());dialog.addEventListener('drop',event=>event.preventDefault());
    dialog.addEventListener('cancel',event=>event.preventDefault());
    dialog.addEventListener('close',close);
    try{
        dialog.showModal();
        const preferences=await canvasPreferences();
        if(closed)return{editor:null,close,focus:()=>{}};
        editor=await mountCanvasEditor(host,{...options,preferences,preview:false,onCancel:close,onApply:async payload=>{await options.onApply(payload);close();}});
        if(closed)editor.destroy();else host.shadowRoot.querySelector('.viewport').focus({preventScroll:true});
        return{editor,close,focus:()=>host.shadowRoot?.querySelector('.viewport')?.focus({preventScroll:true})};
    }catch(error){close();throw error;}
}
