// Assemble only the source region visible in this preview. Tiles are copied at
// native integer coordinates before interpolation, so no tile-edge seams occur.
import {rasterAreaPoints} from './canvas_v1_geometry.js';
import {shiftedGeometry} from './canvas_v1_document.js';
import {isTiled,TILE_SIZE} from './canvas_v1_tiles.js';
export function createSourceWindows(){const entries=new Map();return{
    get bytes(){return[...entries.values()].reduce((n,e)=>n+e.canvas.width*e.canvas.height*4,0);},
    clear(){for(const entry of entries.values())entry.canvas.width=entry.canvas.height=1;entries.clear();},
    prepare(job,layers,sources,changes){const result=[],output=new Map(),updates=new Map(changes),keep=new Set(),visible=new Set(layers.map(layer=>`window:${layer.id}`));
        for(const [id,entry]of entries)if(!visible.has(id)){entry.canvas.width=entry.canvas.height=1;entries.delete(id);}
        for(const layer of layers){const source=sources.get(layer.source);if(!isTiled(source)){result.push(layer);output.set(layer.source,source);continue;}
            if(!source.mask&&!source.tiles.size)continue;
            const points=rasterAreaPoints(layer,{x:job.originX??0,y:job.originY??0,width:job.documentWidth,height:job.documentHeight});
            let x=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x)))-2),y=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y)))-2),right=Math.min(source.width,Math.ceil(Math.max(...points.map(p=>p.x)))+2),bottom=Math.min(source.height,Math.ceil(Math.max(...points.map(p=>p.y)))+2);if(right<=x||bottom<=y)continue;
            // Empty virtual space needs no assembly surface. Include a filter
            // halo so interpolation at the occupied boundary remains seamless.
            if(!source.mask){let left=Infinity,top=Infinity,r=-Infinity,b=-Infinity;for(const key of source.tiles.keys()){const p=source.position(key);if(p.x+TILE_SIZE+2<=x||p.y+TILE_SIZE+2<=y||p.x-2>=right||p.y-2>=bottom)continue;left=Math.min(left,p.x-2);top=Math.min(top,p.y-2);r=Math.max(r,p.x+TILE_SIZE+2);b=Math.max(b,p.y+TILE_SIZE+2);}x=Math.max(x,left);y=Math.max(y,top);right=Math.min(right,r);bottom=Math.min(bottom,b);if(right<=x||bottom<=y)continue;}
            const gridX=Math.floor((x-source.originX)/TILE_SIZE)*TILE_SIZE-TILE_SIZE,gridY=Math.floor((y-source.originY)/TILE_SIZE)*TILE_SIZE-TILE_SIZE;
            const width=Math.ceil((right-source.originX-gridX)/TILE_SIZE)*TILE_SIZE+TILE_SIZE,height=Math.ceil((bottom-source.originY-gridY)/TILE_SIZE)*TILE_SIZE+TILE_SIZE;
            if(width*height*4>192*1024*1024)throw Error(`Preview assembly budget: ${(width*height*4/1048576).toFixed(1)} MiB required for this region; 192 MiB available. Zoom in to reduce it.`);
            const id=`window:${layer.id}`,prior=entries.get(id),stable=prior&&x-source.originX>=prior.x&&y-source.originY>=prior.y&&right-source.originX<=prior.x+prior.width&&bottom-source.originY<=prior.y+prior.height;
            let entry=prior;if(!stable){const retained=[...entries.values()].reduce((n,e)=>n+(e===prior?0:e.canvas.width*e.canvas.height*4),0);if(retained+width*height*4>192*1024*1024)throw Error(`Preview assembly budget: ${((retained+width*height*4)/1048576).toFixed(1)} MiB required for visible windows; 192 MiB available. Zoom in to reduce them.`);if(prior)prior.canvas.width=prior.canvas.height=1;entry={x:gridX,y:gridY,width,height,canvas:new OffscreenCanvas(width,height),tiles:new Map()};entries.set(id,entry);}
            const area={x:entry.x+source.originX,y:entry.y+source.originY,width:entry.width,height:entry.height},keys=source.keys(area),ctx=entry.canvas.getContext('2d');let dirty=null;
            const union=(a,b)=>!a?b:{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.max(a.x+a.width,b.x+b.width)-Math.min(a.x,b.x),height:Math.max(a.y+a.height,b.y+b.height)-Math.min(a.y,b.y)};
            for(const key of keys){const cell=source.tiles.get(key),stamp=cell?`${cell.id}:${cell.revision}`:'empty';if(stable&&entry.tiles.get(key)===stamp)continue;const p=source.position(key),left=p.x-area.x,top=p.y-area.y;ctx.clearRect(left,top,TILE_SIZE,TILE_SIZE);if(source.mask){ctx.fillStyle='#000';ctx.fillRect(left,top,TILE_SIZE,TILE_SIZE);}if(cell)ctx.drawImage(cell.canvas,left,top);entry.tiles.set(key,stamp);dirty=union(dirty,{x:left,y:top,width:TILE_SIZE,height:TILE_SIZE});}
            keep.add(id);if(dirty)updates.set(id,stable?dirty:null);output.set(id,entry.canvas);result.push({...layer,width:entry.width,height:entry.height,...shiftedGeometry(layer,area.x,area.y),source:id,asset_ref:id});
        }
        for(const [id,entry]of entries)if(!keep.has(id)){entry.canvas.width=entry.canvas.height=1;entries.delete(id);}return{layers:result,sources:output,changes:updates};
    },
};}
