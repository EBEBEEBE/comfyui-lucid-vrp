// One disposable worker per editor session. Preview requests are latest-only;
// exact reads/exports are serialized and never use reduced preview pixels.
import {parseDocument,assetReferences} from './canvas_v1_document.js';
import {isTiled} from './canvas_v1_tiles.js';
const abortError=()=>new DOMException('Canvas render cancelled','AbortError');
const close=result=>{result?.bitmap?.close();result?.maskBitmap?.close();};
const bitmapSurface=bitmap=>{const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;c.getContext('2d').drawImage(bitmap,0,0);bitmap.close();return c;};
function captureSources(refs,loadAsset){
    const sources=new Map(),revisions=new Map();for(const ref of refs){const source=loadAsset(ref);sources.set(ref,isTiled(source)?source.fork():source);if(isTiled(source))for(const entry of source.tiles.values())revisions.set(entry.id,entry.revision);}return{sources,revisions};
}

export function createCanvasRenderer({forceCpu=false}={}){
    let worker=null,serial=0,disposed=false,inflight=false,pending=null,generation=0,known=new Map(),knownCells=new Map(),chain=Promise.resolve();
    let status={mode:forceCpu?'cpu':null,draws:0,pixels:null},cpuPixels=512*512,dragActive=false;
    const waiting=new Map();
    function terminate(error=abortError()){
        worker?.terminate();worker=null;known.clear();knownCells.clear();
        for(const task of waiting.values())task.reject(error);waiting.clear();
    }
    function call(kind,body={},transfer=[]){
        if(disposed)return Promise.reject(abortError());
        if(!worker){
            worker=new Worker(new URL('./canvas_v1_render_worker.js',import.meta.url),{type:'module'});
            worker.onmessage=({data})=>{const task=waiting.get(data.id);if(!task){close(data);data.image?.close();data.mask?.close();return;}waiting.delete(data.id);data.error?task.reject(Error(data.error)):task.resolve(data);};
            worker.onerror=()=>terminate(Error('Canvas rendering worker could not load. Reload the frontend and check browser worker permissions.'));
            worker.postMessage({kind:'init',forceCpu,id:0});
        }
        const id=++serial;
        return new Promise((resolve,reject)=>{waiting.set(id,{resolve,reject});worker.postMessage({id,kind,...body},transfer);});
    }
    function send(kind,document,loadAsset,body={},revision='',patches={},snapshot=null){
        const token=generation,value=parseDocument(document),refs=assetReferences(value),{sources:captured,revisions:capturedRevisions}=snapshot??captureSources(refs,loadAsset);
        // Forks share mutable gesture cells. Capture their revisions before any
        // bitmap await, alongside the document/dirty-journal cutoff.
        const operation=chain.catch(()=>{}).then(async()=>{
            if(disposed||token!==generation)throw abortError();
            const updates=[],tileSources=[],cellUpdates=[],liveCells=new Set(),queuedCells=new Set();
            try{
                for(const ref of refs){
                    const source=captured.get(ref),meta=patches[ref],stamp=ref.startsWith('@')?String(meta?.revision??revision):'';
                    if(isTiled(source)){
                        for(const entry of source.tiles.values())liveCells.add(entry.id);
                        if(known.get(ref)?.source===(source.identity??source)&&known.get(ref)?.stamp===stamp)continue;
                        tileSources.push({ref,width:source.width,height:source.height,originX:source.originX,originY:source.originY,mask:source.mask,tiles:[...source.tiles].map(([key,c])=>[key,c.id])});
                        const dirty=meta?.dirtySince(known.get(ref)?.revision??0);
                        for(const [key,entry]of source.tiles){const cellRevision=entry.revision,p=source.position(key);let rect=null;if(dirty&&knownCells.has(entry.id)&&cellRevision===capturedRevisions.get(entry.id)){const x=Math.max(0,Math.floor(dirty.x-p.x)),y=Math.max(0,Math.floor(dirty.y-p.y)),right=Math.min(entry.canvas.width,Math.ceil(dirty.x+dirty.width-p.x)),bottom=Math.min(entry.canvas.height,Math.ceil(dirty.y+dirty.height-p.y));if(right>x&&bottom>y)rect={x,y,width:right-x,height:bottom-y};}
                            // A changed-after-capture cell needs a full tile;
                            // its newer pixels are outside this dirty cutoff.
                            // Still send later dirty regions at equal revisions.
                            if(queuedCells.has(entry.id)||knownCells.get(entry.id)===cellRevision&&!rect)continue;queuedCells.add(entry.id);
                            cellUpdates.push([entry.id,rect?await createImageBitmap(entry.canvas,rect.x,rect.y,rect.width,rect.height):await createImageBitmap(entry.canvas),cellRevision,ref.startsWith('@'),rect]);}
                        continue;
                    }
                    if(known.get(ref)?.source===source&&known.get(ref)?.stamp===stamp)continue;
                    const rect=meta&&known.get(ref)?.source===source?meta.dirtySince(known.get(ref).revision??0):null;
                    updates.push([ref,rect?await createImageBitmap(source,rect.x,rect.y,rect.width,rect.height):await createImageBitmap(source),rect]);
                }
                if(disposed||token!==generation)throw abortError();
                for(const ref of known.keys())if(!refs.includes(ref))known.delete(ref);
                for(const [ref]of updates)known.set(ref,{source:captured.get(ref),stamp:ref.startsWith('@')?String(patches[ref]?.revision??revision):'',revision:patches[ref]?.revision});
                for(const spec of tileSources){const source=captured.get(spec.ref);known.set(spec.ref,{source:source.identity??source,stamp:spec.ref.startsWith('@')?String(patches[spec.ref]?.revision??revision):'',revision:patches[spec.ref]?.revision});}
                for(const [id,,rev]of cellUpdates)knownCells.set(id,rev);for(const id of knownCells.keys())if(!liveCells.has(id))knownCells.delete(id);
                const result=await call(kind,{document:value,refs,maskRef:value.mask.asset_ref,updates,tileSources,cellUpdates,...body},[...updates,...cellUpdates].map(entry=>entry[1]));
                if(disposed||token!==generation){close(result);result.image?.close();result.mask?.close();throw abortError();}
                return result;
            }catch(error){for(const [,bitmap]of [...updates,...cellUpdates])bitmap.close();known.clear();knownCells.clear();throw error;}
        });
        chain=operation.then(()=>{},()=>{});return operation;
    }
    async function pump(){
        if(inflight||!pending)return;inflight=true;const task=pending;pending=null;
        try{
            const result=await send('preview',task.value,null,{job:task.job,overlay:task.overlay},task.revision,task.patches,task.snapshot);
            status={mode:result.mode,draws:result.draws,pixels:result.pixels,textureBytes:result.textureBytes,cacheBytes:result.cacheBytes,fullBytes:result.fullBytes,patchBytes:result.patchBytes,sourceBytes:result.sourceBytes,windowBytes:result.windowBytes};
            // Hysteresis avoids resizing every frame (which invalidates all
            // cached layers). Restore visible resolution when dragging ends.
            if(result.mode==='cpu'&&task.dragging&&result.renderElapsed>22){cpuPixels=Math.max(128*128,Math.min(cpuPixels*.8,cpuPixels*14/result.renderElapsed));}
            if(pending){close(result);task.resolve(null);}else task.resolve(result);
        }catch(error){if(error.name==='AbortError')task.resolve(null);else task.reject(error);}finally{inflight=false;pump();}
    }
    return{
        get status(){return{...status};},
        preview(value,loadAsset,{area,scale,dragging=false,overlay=null,revision='',patches={},cropEditing=null}={}){
            if(disposed)return Promise.resolve(null);
            if(dragging&&!dragActive)cpuPixels=512*512;
            dragActive=dragging;
            const cpu=status.mode==='cpu'&&value.layers.some(l=>l.visible&&l.warp),cap=cpu&&dragging?cpuPixels:2*1024*1024;
            const desiredWidth=Math.max(1,Math.ceil(area.width*scale)),desiredHeight=Math.max(1,Math.ceil(area.height*scale)),factor=Math.min(1,4096/Math.max(desiredWidth,desiredHeight),Math.sqrt(cap/(desiredWidth*desiredHeight)));
            const job={width:Math.max(1,Math.floor(desiredWidth*factor)),height:Math.max(1,Math.floor(desiredHeight*factor)),documentWidth:area.width,documentHeight:area.height,originX:area.x,originY:area.y,cropEditing,
                layers:value.layers.filter(l=>l.visible&&l.opacity>0&&l.asset_ref).map(l=>({...l,source:l.asset_ref}))};
            const snapshot=captureSources(assetReferences(value),loadAsset);
            return new Promise((resolve,reject)=>{pending?.resolve(null);pending={value,snapshot,job,overlay,revision,patches,dragging,resolve,reject};pump();});
        },
        async exact(value,loadAsset){const r=await send('exact',value,loadAsset);return{image:bitmapSurface(r.image),mask:bitmapSurface(r.mask)};},
        async attach(value,loadAsset,paintId,parentId,budget){const r=await send('attach',value,loadAsset,{paintId,parentId,budget});return{state:r.state,surface:r.bitmap?bitmapSurface(r.bitmap):null};},
        async export(value,loadAsset){
            const r=await send('export',value,loadAsset);let image,mask;
            return{imageBlob:r.imageBlob,maskBlob:r.maskBlob,nativeMaskBlob:r.nativeMaskBlob,assetBlobs:r.assetBlobs,
                get image(){return image??=bitmapSurface(r.image);},get mask(){return mask??=bitmapSurface(r.mask);},
                dispose(){r.image.close();r.mask.close();}};
        },
        // Useful for fallback acceptance without adding rendering controls to UI.
        loseContext:()=>call('lose-context'),
        cancel(){generation++;pending?.resolve(null);pending=null;terminate();status={...status,draws:0};},
        dispose(){disposed=true;generation++;pending?.resolve(null);pending=null;terminate();},
    };
}

export async function exportCanvasDocument(value,assets){
    const renderer=createCanvasRenderer({forceCpu:true});
    try{const output=await renderer.export(value,ref=>assets.get(ref));output.dispose();return{imageBlob:output.imageBlob,maskBlob:output.maskBlob,nativeMaskBlob:output.nativeMaskBlob,assetBlobs:output.assetBlobs};}finally{renderer.dispose();}
}
