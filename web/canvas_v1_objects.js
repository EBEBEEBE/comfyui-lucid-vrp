// One-level image/paint objects. Derived composites never enter saved assets.
import {overlayFor,shiftedGeometry} from './canvas_v1_document.js';
import {drawSource,isTiled,TileRaster,TILE_SIZE,cell} from './canvas_v1_tiles.js';

function sparseObject(parent,child,base,paint,previous){
    const x=Math.floor(Math.min(0,child.transform[4])),y=Math.floor(Math.min(0,child.transform[5])),width=Math.ceil(Math.max(parent.width,child.transform[4]+child.width)-x),height=Math.ceil(Math.max(parent.height,child.transform[5]+child.height)-y);
    const baseTiles=isTiled(base)?base:null,output=new TileRaster(width,height,{originX:-x,originY:-y}),stamps=new Map(),keys=new Set(baseTiles?baseTiles.tiles.keys():new TileRaster(parent.width,parent.height).keys({x:0,y:0,width:parent.width,height:parent.height}));
    for(const key of paint.tiles.keys()){const p=paint.position(key),left=Math.floor((p.x+child.transform[4])/TILE_SIZE),top=Math.floor((p.y+child.transform[5])/TILE_SIZE),right=Math.floor((Math.ceil(p.x+child.transform[4]+TILE_SIZE)-1)/TILE_SIZE),bottom=Math.floor((Math.ceil(p.y+child.transform[5]+TILE_SIZE)-1)/TILE_SIZE);for(let yy=top;yy<=bottom;yy++)for(let xx=left;xx<=right;xx++)keys.add(`${xx},${yy}`);}
    for(const key of keys){const [tx,ty]=key.split(',').map(Number),left=tx*TILE_SIZE,top=ty*TILE_SIZE,area={x:left-child.transform[4],y:top-child.transform[5],width:TILE_SIZE,height:TILE_SIZE};
        const nearby=[...paint.keys({...area,x:Math.floor(area.x)-1,y:Math.floor(area.y)-1,width:TILE_SIZE+2,height:TILE_SIZE+2})].map(k=>paint.tiles.get(k)).filter(Boolean),baseCell=baseTiles?.tiles.get(key),stamp=JSON.stringify([baseCell?.id,baseCell?.revision,child.opacity,child.transform[4]+paint.originX,child.transform[5]+paint.originY,...nearby.map(c=>[c.id,c.revision])]);stamps.set(key,stamp);
        if(previous?.base===base&&previous?.stamps?.get(key)===stamp){output.tiles.set(key,previous.surface.tiles.get(key));continue;}
        const canvas=output.emptyCell(),ctx=canvas.getContext('2d');drawSource(ctx,base,-left,-top);ctx.globalAlpha=child.opacity;drawSource(ctx,paint,child.transform[4]-left,child.transform[5]-top);output.tiles.set(key,cell(canvas));
    }
    return{base,stamps,surface:output,x,y,width,height};
}

export function createObjectCache(createSurface){
    const entries=new Map();
    return{
        clear(){for(const entry of entries.values())if(!isTiled(entry.surface))entry.surface.width=entry.surface.height=1;entries.clear();},
        prepare(document,assets,changes=new Map()){
            const layers=[],sources=new Map(),updates=new Map(changes),keep=new Set();
            for(const parent of document.layers){
                if(parent.parent_id||!parent.visible||!parent.opacity||!parent.asset_ref)continue;
                const child=overlayFor(document,parent.id);
                if(!child?.visible||!child.opacity||!child.asset_ref){layers.push({...parent,source:parent.asset_ref});sources.set(parent.asset_ref,assets.get(parent.asset_ref));continue;}
                if(isTiled(assets.get(child.asset_ref))){const ref=`object:${parent.id}`,entry=sparseObject(parent,child,assets.get(parent.asset_ref),assets.get(child.asset_ref),entries.get(ref));entries.set(ref,entry);keep.add(ref);sources.set(ref,entry.surface);layers.push({...parent,width:entry.width,height:entry.height,...shiftedGeometry(parent,entry.x,entry.y),asset_ref:ref,source:ref});continue;}
                const x=Math.floor(Math.min(0,child.transform[4])),y=Math.floor(Math.min(0,child.transform[5]));
                const width=Math.ceil(Math.max(parent.width,child.transform[4]+child.width)-x),height=Math.ceil(Math.max(parent.height,child.transform[5]+child.height)-y);
                if(width*height*4>192*1024*1024)throw Error('Image object exceeds the raster budget');
                const key=JSON.stringify([parent.asset_ref,child.asset_ref,child.transform,child.width,child.height,child.opacity,x,y,width,height]);
                const base=assets.get(parent.asset_ref),paint=assets.get(child.asset_ref),ref=`object:${parent.id}`;let entry=entries.get(ref);
                const stable=entry?.key===key&&entry.base===base&&entry.paint===paint;
                if(!stable||changes.has(parent.asset_ref)||changes.has(child.asset_ref)){
                    let dirty=stable&&!changes.has(parent.asset_ref)?changes.get(child.asset_ref):null;
                    if(dirty)dirty={x:Math.floor(dirty.x+child.transform[4]-x),y:Math.floor(dirty.y+child.transform[5]-y),width:Math.ceil(dirty.width+1),height:Math.ceil(dirty.height+1)};
                    if(!entry||entry.surface.width!==width||entry.surface.height!==height){if(entry)entry.surface.width=entry.surface.height=1;entry={surface:createSurface(width,height)};dirty=null;}
                    const ctx=entry.surface.getContext('2d');ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;
                    if(dirty){ctx.beginPath();ctx.rect(dirty.x,dirty.y,dirty.width,dirty.height);ctx.clip();}
                    ctx.clearRect(0,0,width,height);drawSource(ctx,base,-x,-y);ctx.globalAlpha=child.opacity;drawSource(ctx,paint,child.transform[4]-x,child.transform[5]-y);ctx.restore();
                    Object.assign(entry,{key,base,paint});entries.set(ref,entry);updates.set(ref,dirty);
                }
                keep.add(ref);sources.set(ref,entry.surface);layers.push({...parent,width,height,...shiftedGeometry(parent,x,y),asset_ref:ref,source:ref});
            }
            for(const [ref,entry]of entries)if(!keep.has(ref)){if(!isTiled(entry.surface))entry.surface.width=entry.surface.height=1;entries.delete(ref);}
            return{layers,sources,changes:updates};
        },
    };
}
