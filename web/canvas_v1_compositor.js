// Canvas 2D rendering only. No viewport overlays, graph access or uploads.
import { parseDocument } from './canvas_v1_document.js';
import { drawLayer } from './canvas_v1_layer_render.js';
import {createObjectCache} from './canvas_v1_objects.js';
import {drawSource} from './canvas_v1_tiles.js';

function abortIfNeeded(signal) {
    if (signal?.aborted) {
        const error=Error('Canvas render aborted'); error.name='AbortError'; throw error;
    }
}

function browserSurface(width,height) {
    const surface=document.createElement('canvas');
    surface.width=width; surface.height=height; return surface;
}

function context(surface,width,height) {
    if (surface.width!==width || surface.height!==height)
        throw Error('Canvas surface dimensions disagree with document');
    const ctx=surface.getContext('2d');
    if (!ctx) throw Error('Cannot create a Canvas 2D context');
    ctx.setTransform(1,0,0,1,0,0); ctx.globalAlpha=1;
    ctx.globalCompositeOperation='source-over'; ctx.clearRect(0,0,width,height);
    return ctx;
}

function assertSize(source,width,height,reference) {
    // Natural dimensions take precedence even when zero (not yet decoded).
    const sw=source?.naturalWidth??source?.width, sh=source?.naturalHeight??source?.height;
    if (sw!==width || sh!==height) throw Error(`Canvas asset dimensions disagree: ${reference}`);
}

// One native-resolution result per warped layer. Opacity is applied afterwards,
// so changing another layer or a slider does not resample unchanged warp pixels.
// A strict byte budget bounds retained derived surfaces, independent of assets.
export function createLayerRenderCache({maxBytes=64*1024*1024}={}) {
    const entries=new Map();let bytes=0;
    const remove=id=>{const entry=entries.get(id);if(entry){bytes-=entry.bytes;entries.delete(id);}};
    return {
        retain(ids){for(const id of entries.keys())if(!ids.has(id))remove(id);},
        clear(){entries.clear();bytes=0;},
        get size(){return entries.size;},get bytes(){return bytes;},
        render(layer,source,width,height,createSurface){
            const key=JSON.stringify([width,height,layer.asset_ref,layer.transform,layer.warp,layer.crop]),previous=entries.get(layer.id);
            if(previous?.key===key&&previous.source===source){entries.delete(layer.id);entries.set(layer.id,previous);return previous.image;}
            remove(layer.id);const image=createSurface(width,height),ctx=context(image,width,height);
            drawLayer(ctx,layer,source,{createSurface,opacity:1});const cost=width*height*4;
            if(cost<=maxBytes&&!layer.asset_ref.startsWith('@')){
                while(bytes+cost>maxBytes&&entries.size)remove(entries.keys().next().value);
                entries.set(layer.id,{key,source,image,bytes:cost});bytes+=cost;
            }
            return image;
        },
    };
}

// loadAsset returns a decoded CanvasImageSource for an immutable reference.
// Mask assets use opaque grayscale RGB: 0 unselected, 255 fully selected.
// Existing native inverse-alpha masks need conversion at the future import bridge.
export async function renderDocument(value,loadAsset,{createSurface=browserSurface,signal,layerCache}={}) {
    abortIfNeeded(signal);
    const doc=parseDocument(value);
    const visible=doc.layers.filter(layer=>layer.visible&&layer.opacity>0&&layer.asset_ref!==null);
    const refs=[...new Set([...visible.map(layer=>layer.asset_ref),doc.mask.asset_ref]
        .filter(reference=>reference!==null))];
    const sources=new Map(await Promise.all(refs.map(async reference=>{
        const source=await loadAsset(reference,{signal}); abortIfNeeded(signal);
        return [reference,source];
    })));
    abortIfNeeded(signal);
    for (const layer of visible) assertSize(sources.get(layer.asset_ref),layer.width,layer.height,layer.asset_ref);
    if (doc.mask.asset_ref!==null)
        assertSize(sources.get(doc.mask.asset_ref),doc.width,doc.height,doc.mask.asset_ref);

    const image=createSurface(doc.width,doc.height), rgb=context(image,doc.width,doc.height);
    // Match the existing white blank and expose an opaque RGB result even if
    // the background is hidden/transformed. Layer/source alpha stays intact.
    rgb.fillStyle='#fff'; rgb.fillRect(0,0,doc.width,doc.height);
    layerCache?.retain(new Set(visible.filter(layer=>layer.warp).map(layer=>layer.id)));
    const objects=createObjectCache(createSurface),prepared=objects.prepare(doc,sources);
    try{for (const layer of prepared.layers) {
        const source=prepared.sources.get(layer.asset_ref);
        if(layer.warp&&layerCache){
            const cached=layerCache.render(layer,source,doc.width,doc.height,createSurface);
            rgb.save();try{rgb.globalAlpha=layer.opacity;rgb.drawImage(cached,0,0);}finally{rgb.restore();}
        }else drawLayer(rgb,layer,source,{createSurface});
    }}finally{objects.clear();}

    const mask=createSurface(doc.width,doc.height), coverage=context(mask,doc.width,doc.height);
    if (doc.mask.asset_ref===null) {
        coverage.fillStyle='#000'; coverage.fillRect(0,0,doc.width,doc.height);
    } else {
        drawSource(coverage,sources.get(doc.mask.asset_ref),0,0);
        const pixels=coverage.getImageData(0,0,doc.width,doc.height).data;
        for (let i=0;i<pixels.length;i+=4) {
            if (pixels[i]!==pixels[i+1] || pixels[i]!==pixels[i+2] || pixels[i+3]!==255)
                throw Error('Mask asset must be opaque grayscale coverage, not color or inverse alpha');
        }
    }
    abortIfNeeded(signal);
    return {image,mask};
}
