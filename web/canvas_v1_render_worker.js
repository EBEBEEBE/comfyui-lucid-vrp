import {GpuPreview,CpuPreview} from './canvas_v1_accelerator.js';
import {renderDocument} from './canvas_v1_compositor.js';
import {createObjectCache} from './canvas_v1_objects.js';
import {bakeAttachment} from './canvas_v1_attachment.js';
import {TileRaster,isTiled,drawSource,residentBytes} from './canvas_v1_tiles.js';
import {createSourceWindows} from './canvas_v1_source_windows.js';
const surface=(w,h)=>new OffscreenCanvas(w,h);
const objects=createObjectCache(surface);
const windows=createSourceWindows();
const assets=new Map();let renderer=null,mode=null,forceCpu=false,overlay=null,overlayKey='',draws=0;
const changes=new Map();let fullBytes=0,patchBytes=0;
const cells=new Map();
function reset(){renderer?.dispose();renderer=null;overlay=null;overlayKey='';}
function stats(){return{mode,draws,textureBytes:renderer?.bytes??0,cacheBytes:renderer?.cacheBytes??0,fullBytes,patchBytes,sourceBytes:residentBytes(assets.values()),windowBytes:windows.bytes};}
function sync(data){
    const keep=new Set(data.refs);
    for(const [ref,bitmap]of assets)if(!keep.has(ref)){bitmap.close?.();assets.delete(ref);changes.delete(ref);}
    for(const [id,bitmap,,patch,rect]of data.cellUpdates??[]){const revision=(cells.get(id)?.revision??0)+1,cost=bitmap.width*bitmap.height*4;let canvas=bitmap;if(rect){const previous=cells.get(id)?.canvas;if(!previous)throw Error('Missing tile patch baseline');canvas=previous.getContext?previous:surface(previous.width,previous.height);if(canvas!==previous){canvas.getContext('2d').drawImage(previous,0,0);previous.close?.();}const ctx=canvas.getContext('2d');ctx.clearRect(rect.x,rect.y,rect.width,rect.height);ctx.drawImage(bitmap,rect.x,rect.y);bitmap.close();}else cells.get(id)?.canvas.close?.();cells.set(id,{id,canvas,revision});if(patch)patchBytes+=cost;else fullBytes+=cost;}
    for(const spec of data.tileSources??[]){const tiles=new Map(spec.tiles.map(([key,id])=>[key,cells.get(id)]));assets.set(spec.ref,new TileRaster(spec.width,spec.height,{...spec,tiles}));changes.set(spec.ref,null);if(spec.ref===data.maskRef)overlayKey='';}
    const live=new Set();for(const source of assets.values())if(isTiled(source))for(const entry of source.tiles.values())live.add(entry.id);for(const [id,entry]of cells)if(!live.has(id)){entry.canvas.close?.();cells.delete(id);}
    for(const [ref,bitmap,rect]of data.updates){
        if(rect){
            const target=assets.get(ref);if(!target?.getContext)throw Error('Missing mutable preview baseline');
            const ctx=target.getContext('2d');ctx.clearRect(rect.x,rect.y,rect.width,rect.height);ctx.drawImage(bitmap,rect.x,rect.y);patchBytes+=bitmap.width*bitmap.height*4;bitmap.close();
            const prior=changes.get(ref);
            if(!changes.has(ref))changes.set(ref,rect);
            else if(prior){const x=Math.min(prior.x,rect.x),y=Math.min(prior.y,rect.y);changes.set(ref,{x,y,width:Math.max(prior.x+prior.width,rect.x+rect.width)-x,height:Math.max(prior.y+prior.height,rect.y+rect.height)-y});}
        }else{
            assets.get(ref)?.close?.();fullBytes+=bitmap.width*bitmap.height*4;
            if(ref.startsWith('@')){const target=surface(bitmap.width,bitmap.height);target.getContext('2d').drawImage(bitmap,0,0);assets.set(ref,target);bitmap.close();}
            else assets.set(ref,bitmap);
            changes.set(ref,null);
        }
        if(ref===data.maskRef)overlayKey='';
    }
}
async function handle(data){
    const {id,kind}=data;
    try{
        if(kind==='init'){forceCpu=!!data.forceCpu;self.postMessage({id,mode:forceCpu?'cpu':null});return;}
        if(kind==='stats'){self.postMessage({id,...stats()});return;}
        if(kind==='lose-context'){renderer?.gl?.getExtension('WEBGL_lose_context')?.loseContext();self.postMessage({id});return;}
        sync(data);
        if(kind==='attach'){
            const result=bakeAttachment(data.document,data.paintId,data.parentId,ref=>assets.get(ref),surface,data.budget);
            const bitmap=result.surface?await createImageBitmap(result.surface):null;self.postMessage({id,state:result.state,bitmap},bitmap?[bitmap]:[]);return;
        }
        if(kind==='exact'||kind==='export'){
            if(kind==='export'){windows.clear();objects.clear();reset();}
            const result=await renderDocument(data.document,ref=>assets.get(ref),{createSurface:surface});
            if(kind==='exact'){
                const image=await createImageBitmap(result.image),mask=await createImageBitmap(result.mask);self.postMessage({id,image,mask},[image,mask]);return;
            }
            const maskPixels=result.mask.getContext('2d').getImageData(0,0,result.mask.width,result.mask.height);
            for(let i=0;i<maskPixels.data.length;i+=4)maskPixels.data[i+3]=255-maskPixels.data[i];
            const native=surface(result.mask.width,result.mask.height);native.getContext('2d').putImageData(maskPixels,0,0);
            const [imageBlob,maskBlob,nativeMaskBlob]=await Promise.all([result.image,result.mask,native].map(c=>c.convertToBlob({type:'image/png'})));
            const assetBlobs=new Map();for(const ref of data.refs)if(ref.startsWith('memory:')){const input=assets.get(ref),raster=isTiled(input)?input.materialize():surface(input.width,input.height);if(!isTiled(input))raster.getContext('2d').drawImage(input,0,0);assetBlobs.set(ref,await raster.convertToBlob({type:'image/png'}));raster.width=raster.height=1;}
            const image=await createImageBitmap(result.image),mask=await createImageBitmap(result.mask);
            self.postMessage({id,imageBlob,maskBlob,nativeMaskBlob,assetBlobs,image,mask},[image,mask]);return;
        }
        if(kind!=='preview')throw Error('Unknown canvas render request');
        const start=performance.now(),grouped=objects.prepare(data.document,assets,changes),prepared=windows.prepare(data.job,grouped.layers,grouped.sources,grouped.changes),job={...data.job,layers:prepared.layers},colorSources=prepared.sources;
        if(job.cropEditing)job.layers=job.layers.flatMap(layer=>layer.id===job.cropEditing&&layer.crop?[{...layer,cropOutside:true,opacity:layer.opacity*.2},layer]:[layer]);
        if(!renderer){
            if(!forceCpu)try{renderer=new GpuPreview(new Map());mode='gpu';}catch{reset();}
            if(!renderer){renderer=new CpuPreview(new Map());mode='cpu';}
        }
        let image,renderStart;
        try{renderer.updateSources(colorSources,job.layers,prepared.changes);renderStart=performance.now();image=renderer.render(job);}
        catch(error){if(mode!=='gpu')throw error;reset();renderer=new CpuPreview(new Map());mode='cpu';renderer.updateSources(colorSources,job.layers);renderStart=performance.now();image=renderer.render(job);}
        const renderElapsed=performance.now()-renderStart;
        changes.clear();
        const bitmap=await createImageBitmap(image);let maskBitmap=null;
        if(data.overlay){
            const key=JSON.stringify([data.maskRef,data.overlay,job.width,job.height,job.originX,job.originY,job.documentWidth,job.documentHeight]);
            if(key!==overlayKey){
                overlay=surface(job.width,job.height);const ctx=overlay.getContext('2d'),mask=assets.get(data.maskRef);
                if(mask){
                    drawSource(ctx,mask,job.originX,job.originY,job.documentWidth,job.documentHeight,0,0,job.width,job.height);
                    const pixels=ctx.getImageData(0,0,job.width,job.height),rgb=data.overlay.color.match(/\w\w/g).map(v=>parseInt(v,16));
                    for(let i=0;i<pixels.data.length;i+=4){const alpha=Math.round(pixels.data[i]*data.overlay.alpha);pixels.data[i]=rgb[0];pixels.data[i+1]=rgb[1];pixels.data[i+2]=rgb[2];pixels.data[i+3]=alpha;}
                    ctx.putImageData(pixels,0,0);
                }
                overlayKey=key;
            }
            maskBitmap=await createImageBitmap(overlay);
        }
        draws++;self.postMessage({id,bitmap,maskBitmap,elapsed:performance.now()-start,renderElapsed,pixels:[job.width,job.height],...stats()},[bitmap,...(maskBitmap?[maskBitmap]:[])]);
    }catch(error){self.postMessage({id,error:error.message??String(error)});}
}
// Asset updates, exact exports and preview work cannot interleave while an
// asynchronous bitmap/PNG conversion is using the previous source generation.
// Classic ComfyUI can eagerly import every extension .js in the window. Importing
// this worker entry there must not replace window.onmessage or start rendering.
let queue=Promise.resolve();
if(typeof document==='undefined')self.onmessage=({data})=>{queue=queue.then(()=>handle(data));};
