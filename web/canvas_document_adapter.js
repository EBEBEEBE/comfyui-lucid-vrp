// Current classic frontend's native layered PNG bridge. No global menu/editor patches.
import { ComfyApp } from '../../scripts/app.js';
import { imageURL, upload, installDrop } from './classic_adapter.js';

export function referenceString(value) {
    if (typeof value === 'string') return value.trim();
    if (!value?.filename) return null;
    return `${value.subfolder ? value.subfolder+'/' : ''}${value.filename} [${value.type || 'input'}]`;
}

export async function loadRaster(ref, channel='rgb', {fresh=false}={}) {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = imageURL(ref, channel).url+(fresh?`&lucid_canvas=${crypto.randomUUID()}`:'');
    await image.decode();
    return image;
}

export function raster(width,height,image=null) {
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    if(image)canvas.getContext('2d').drawImage(image,0,0,width,height);
    return canvas;
}
export function whiteRaster(width,height) {
    const canvas=raster(width,height),ctx=canvas.getContext('2d');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);return canvas;
}
export const rasterBlob=canvas=>new Promise((resolve,reject)=>canvas.toBlob(
    blob=>blob?resolve(blob):reject(Error('Cannot encode canvas PNG')), 'image/png'));
export const rasterSize=image=>[image.naturalWidth || image.width,image.naturalHeight || image.height];

export function editorMaskOverlay(image) {
    const [width,height]=rasterSize(image),canvas=raster(width,height,image);
    const ctx=canvas.getContext('2d'),pixels=ctx.getImageData(0,0,width,height);
    let selected=false;
    for(let i=0;i<pixels.data.length;i+=4) {
        const alpha=255-pixels.data[i+3];
        selected ||= alpha>0;
        pixels.data[i]=255;pixels.data[i+1]=80;pixels.data[i+2]=140;
        pixels.data[i+3]=Math.round(alpha*.45);
    }
    if(!selected)return null;
    ctx.putImageData(pixels,0,0);return canvas;
}

export function nativeLayerRefs(reference) {
    const {ref}=imageURL(reference);
    // Same filename protocol as the installed native loader. Do not guess
    // collision-renamed/unknown layer names; verified loads are mandatory.
    const match=/^clipspace-painted-masked-(\d+)\.png$/.exec(ref.filename);
    if(!match || ref.type!=='input')return null;
    const named=name=>referenceString({...ref,filename:`clipspace-${name}-${match[1]}.png`});
    return {base_ref:named('mask'),paint_ref:named('paint'),image_ref:named('painted'),editor_ref:reference};
}

export async function inspectSavedRaster(reference, origin, id) {
    const main=await loadRaster(reference),[width,height]=rasterSize(main);
    const doc={id,width,height,origin,image_ref:reference,editor_ref:reference,layers:null};
    const refs=nativeLayerRefs(reference);
    let warning=null;
    if(refs) {
        try {
            const layers=await Promise.all([loadRaster(refs.base_ref),loadRaster(refs.paint_ref,'rgba'),loadRaster(refs.image_ref)]);
            if(layers.some(layer=>rasterSize(layer).join('x')!==`${width}x${height}`))throw Error('Layer dimensions disagree');
            doc.image_ref=refs.image_ref;doc.layers={base_ref:refs.base_ref,paint_ref:refs.paint_ref};
        } catch(error) {warning='Native editor layers are missing or mismatched; RGB is available, but layer-preserving resize is unavailable.';}
    } else if(imageURL(reference).ref.filename.startsWith('clipspace-painted-masked-')) {
        warning='Unknown native layer filename; layer-preserving resize is unavailable.';
    }
    return {document:doc,warning};
}

let lastStamp=0;
export async function resizeDocument(doc,width,height) {
    if(!doc.image_ref)return {...doc,width,height};
    if(!doc.layers && imageURL(doc.editor_ref || doc.image_ref).ref.filename.startsWith('clipspace-painted-masked-'))
        throw Error('Cannot resize without the saved paint layers. Restore them or import a flattened image explicitly.');
    // Scale all native editor layers, not a transparent preview/composite alone.
    const baseRef=doc.layers?.base_ref || doc.image_ref;
    const [base,alpha,paint]=await Promise.all([loadRaster(baseRef),loadRaster(baseRef,'a'),
        doc.layers ? loadRaster(doc.layers.paint_ref,'rgba') : Promise.resolve(null)]);
    if(doc.layers && [base,alpha,paint].some(layer=>rasterSize(layer).join('x')!==`${doc.width}x${doc.height}`))
        throw Error('Saved layer dimensions disagree; restore the original layer files before resizing');
    const baseCanvas=raster(width,height,base),paintCanvas=raster(width,height,paint);
    const alphaCanvas=raster(width,height,alpha),composite=raster(width,height,base);
    composite.getContext('2d').drawImage(paintCanvas,0,0);
    const stamp=lastStamp=Math.max(lastStamp+1,Date.now()*1000+Math.floor(Math.random()*1000));
    const [baseBlob,paintBlob,alphaBlob,compositeBlob]=await Promise.all(
        [baseCanvas,paintCanvas,alphaCanvas,composite].map(rasterBlob));
    const opaqueBase=await upload(baseBlob,`vrp-base-${crypto.randomUUID()}.png`);
    const base_ref=await upload(alphaBlob,`clipspace-mask-${stamp}.png`,imageURL(opaqueBase).ref);
    const paint_ref=await upload(paintBlob,`clipspace-paint-${stamp}.png`);
    const image_ref=await upload(compositeBlob,`clipspace-painted-${stamp}.png`);
    // Native /upload/mask copies alpha onto opaque original RGB. Canvas PNG
    // premultiplication would otherwise erase RGB underneath masked pixels.
    const editor_ref=await upload(alphaBlob,`clipspace-painted-masked-${stamp}.png`,imageURL(image_ref).ref);
    const expected=nativeLayerRefs(editor_ref);
    if(!expected || expected.base_ref!==base_ref || expected.paint_ref!==paint_ref || expected.image_ref!==image_ref)
        throw Error('Upload renamed editor layers; resized document was not committed');
    return {...doc,width,height,image_ref,editor_ref,layers:{base_ref,paint_ref}};
}

export function clipspaceReference() {
    const clipspace=ComfyApp.clipspace;
    const ref=referenceString(clipspace?.images?.[clipspace.selectedIndex || 0]);
    if(!ref)throw Error('Copy an image to Clipspace first');
    return ref;
}

export function installDocumentInputs(node, importFile, importReference, edit, report) {
    installDrop(node,importFile);
    const priorPaste=node.pasteFiles;
    node.pasteFiles=async files=>{
        const file=Array.from(files).find(file=>file.type.startsWith('image/'));
        if(file){await importFile(file);return true;}
        return priorPaste?.call(node,files) || false;
    };
    // Only this node's context menu changes. Native Copy remains untouched;
    // native Paste is replaced to avoid copying matching state/config widgets.
    const priorMenu=node.getExtraMenuOptions;
    node.getExtraMenuOptions=function(canvas,options) {
        const result=priorMenu?.call(this,canvas,options);
        let foundEdit=false;
        for(const option of [...options,...(Array.isArray(result)?result:[])]) {
            if(/Open.*MaskEditor|Open Mask Editor/.test(option?.content || '')) {
                option.callback=edit;foundEdit=true;if(node.comfyClass!=='VRPCanvas')option.content='Edit Image';
            }
            if(option?.content==='Paste (Clipspace)')option.callback=()=>{
                try {return importReference(clipspaceReference());}catch(error){report(error);}
            };
        }
        if(!foundEdit)options.push({content:node.comfyClass==='VRPCanvas'?'Open in MaskEditor | Image Canvas':'Edit Image',callback:edit});
        return result || [];
    };
}
