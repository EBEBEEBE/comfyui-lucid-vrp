import {inverse,multiply,translation,expandRasterState,rasterAreaPoints} from './canvas_v1_geometry.js';
import {drawDocumentRaster} from './canvas_v1_layer_render.js';
import {TileRaster,TILE_SIZE,isTiled,cell} from './canvas_v1_tiles.js';

export function tileStroke({source,width,height,transform,warp,brush,mask,erase,seed,expand,validateSize,validateAllocation=()=>{}},makeTip){
    validateSize(width,height);const settings={...brush},bytes=TILE_SIZE*TILE_SIZE*4;
    const base=source?(isTiled(source)?source:TileRaster.from(source,{mask})):new TileRaster(width,height,{mask}),work=base.fork();
    let state={width,height,transform:[...transform],...(warp?{warp:structuredClone(warp)}:{})},revision=0,last=null,lastDab=null,carry=0,journal=[],journalFloor=0,dirty=null,legacy=null;
    const scratches=new Map(),outputs=new Map(),pending=new Set(),touched=new Set();
    const union=(a,b)=>!a?{...b}:{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.max(a.x+a.width,b.x+b.width)-Math.min(a.x,b.x),height:Math.max(a.y+a.height,b.y+b.height)-Math.min(a.y,b.y)};
    const spacing=Math.max(.5,settings.size*(settings.tip==='spray'?.16:.12)),color=mask?(erase?'#000000':'#ffffff'):(erase?'#ffffff':settings.color);
    let randomState=seed>>>0;const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
    const fixed=settings.tip==='spray'?null:makeTip(settings,color,random);
    function dab(p){const tip=fixed||makeTip(settings,color,random),area={x:p.x-tip.width/2,y:p.y-tip.height/2,width:tip.width,height:tip.height};
        if(expand&&!mask&&!erase){const next=expandRasterState(state,area);if(next.changed){validateSize(next.width,next.height);work.grow(next.width,next.height,next.offset.x,next.offset.y);state={width:next.width,height:next.height,transform:next.transform,...(next.warp?{warp:next.warp}:{})};journal=[];journalFloor=revision;if(dirty){dirty.x+=next.offset.x;dirty.y+=next.offset.y;}}}
        const points=rasterAreaPoints(state,area),x=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x)))-2),y=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y)))-2),right=Math.min(state.width,Math.ceil(Math.max(...points.map(p=>p.x)))+2),bottom=Math.min(state.height,Math.ceil(Math.max(...points.map(p=>p.y)))+2);
        if(right<=x||bottom<=y){lastDab={...p};return;}
        const columns=Math.floor((right-1-work.originX)/TILE_SIZE)-Math.floor((x-work.originX)/TILE_SIZE)+1,rows=Math.floor((bottom-1-work.originY)/TILE_SIZE)-Math.floor((y-work.originY)/TILE_SIZE)+1;
        if(columns*rows>1024)validateAllocation({workBytes:columns*rows*bytes,scratchBytes:columns*rows*bytes});
        for(const key of work.keys({x,y,width:right-x,height:bottom-y})){
            if(erase&&!base.tiles.has(key))continue;
            const at=work.position(key);let scratch=scratches.get(key);
            if(!scratch){validateAllocation({workBytes:(outputs.size+1)*bytes,scratchBytes:(scratches.size+1)*bytes});scratch=work.emptyCell();scratch.getContext('2d').clearRect(0,0,TILE_SIZE,TILE_SIZE);scratches.set(key,scratch);const output=work.emptyCell(),original=base.readCell(key);if(original)output.getContext('2d').drawImage(original,0,0);outputs.set(key,cell(output));}
            const ctx=scratch.getContext('2d');if(state.warp)drawDocumentRaster(ctx,tip,state,area,{x:area.x,y:area.y},at);else{ctx.save();ctx.setTransform(...multiply(translation(-at.x,-at.y),inverse(state.transform)));ctx.drawImage(tip,area.x,area.y);ctx.restore();}
            pending.add(key);touched.add(key);
        }
        if(pending.size)dirty=union(dirty,{x,y,width:right-x,height:bottom-y});lastDab={...p};
    }
    function composite(){if(!pending.size)return;for(const key of pending){const entry=outputs.get(key),ctx=entry.canvas.getContext('2d'),original=base.readCell(key);ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,TILE_SIZE,TILE_SIZE);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';if(mask){ctx.fillStyle='#000';ctx.fillRect(0,0,TILE_SIZE,TILE_SIZE);}if(original)ctx.drawImage(original,0,0);ctx.globalAlpha=settings.opacity;ctx.globalCompositeOperation=erase&&!mask?'destination-out':'source-over';ctx.drawImage(scratches.get(key),0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';entry.revision++;work.tiles.set(key,entry);}
        pending.clear();journal.push({revision:++revision,rect:dirty});if(legacy)updateLegacy(dirty);dirty=null;}
    function updateLegacy(area){if(legacy.width!==work.width||legacy.height!==work.height){legacy=work.materialize();return;}const patch=work.materialize(area),ctx=legacy.getContext('2d');ctx.clearRect(area.x,area.y,area.width,area.height);ctx.drawImage(patch,area.x,area.y);patch.width=patch.height=1;}
    return{
        get raster(){return work;},get surface(){if(!legacy)legacy=work.materialize();return legacy;},get state(){return structuredClone(state);},get revision(){return revision;},
        get allocation(){return{workBytes:outputs.size*bytes,scratchBytes:scratches.size*bytes};},
        // Growth discards rectangles expressed in the former local coordinates.
        // A consumer behind that reset needs complete changed tiles, not a
        // partial rectangle covering only the surviving end of the journal.
        dirtySince(after,through=revision){if(after<journalFloor||through<journalFloor)return null;return journal.filter(e=>e.revision>after&&e.revision<=through).reduce((box,e)=>union(box,e.rect),null);},
        pulse(){if(settings.tip!=='spray'||!last)return false;dab(last);composite();return true;},
        move(p){if(!last){dab(p);last={...p};composite();return;}let a={...last},distance=Math.hypot(p.x-a.x,p.y-a.y),needed=spacing-carry;while(distance+1e-9>=needed){const ratio=needed/distance;a={x:a.x+(p.x-a.x)*ratio,y:a.y+(p.y-a.y)*ratio};dab(a);distance=Math.hypot(p.x-a.x,p.y-a.y);carry=0;needed=spacing;}carry+=distance;last={...p};composite();},
        finish({materialize=true}={}){if(last&&lastDab&&Math.hypot(last.x-lastDab.x,last.y-lastDab.y)>.01)dab(last);composite();for(const [key,entry]of outputs){const p=entry.canvas.getContext('2d').getImageData(0,0,TILE_SIZE,TILE_SIZE).data;if(!p.some((v,i)=>mask?i%4===0&&v!==0:i%4===3&&v!==0))work.tiles.delete(key);}return materialize?(legacy??=work.materialize()):work;},
        changed(){for(const key of touched){const previous=base.readCell(key),next=work.readCell(key),a=previous?.getContext('2d').getImageData(0,0,TILE_SIZE,TILE_SIZE).data,b=next?.getContext('2d').getImageData(0,0,TILE_SIZE,TILE_SIZE).data;if(a||b){const left=a??new Uint8ClampedArray(TILE_SIZE*TILE_SIZE*4),right=b??new Uint8ClampedArray(left.length);if(mask){if(!a)for(let i=3;i<left.length;i+=4)left[i]=255;if(!b)for(let i=3;i<right.length;i+=4)right[i]=255;}if(right.some((v,i)=>v!==left[i]))return true;}}return false;},
    };
}

export function applyTileCoverage(source,state,coverage,area,{mask=false,color='#ffffff',opacity=1,validateAllocation=()=>{}}={}){
    const base=source?(isTiled(source)?source:TileRaster.from(source,{mask})):new TileRaster(state.width,state.height,{mask}),work=base.fork();if(state.offset)work.grow(state.width,state.height,state.offset.x,state.offset.y);
    const points=rasterAreaPoints(state,area),x=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x)))-2),y=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y)))-2),right=Math.min(work.width,Math.ceil(Math.max(...points.map(p=>p.x)))+2),bottom=Math.min(work.height,Math.ceil(Math.max(...points.map(p=>p.y)))+2);let changed=false,count=0;
    const columns=Math.floor((right-1-work.originX)/TILE_SIZE)-Math.floor((x-work.originX)/TILE_SIZE)+1,rows=Math.floor((bottom-1-work.originY)/TILE_SIZE)-Math.floor((y-work.originY)/TILE_SIZE)+1;
    if(right>x&&bottom>y&&columns*rows>1024)validateAllocation({workBytes:columns*rows*TILE_SIZE*TILE_SIZE*4,scratchBytes:TILE_SIZE*TILE_SIZE*8});
    for(const key of right>x&&bottom>y?work.keys({x,y,width:right-x,height:bottom-y}):[]){const at=work.position(key),ink=work.emptyCell(),c=ink.getContext('2d');c.clearRect(0,0,TILE_SIZE,TILE_SIZE);drawDocumentRaster(c,coverage,state,area,{x:0,y:0},at);c.globalCompositeOperation='source-in';c.fillStyle=color;c.fillRect(0,0,TILE_SIZE,TILE_SIZE);
        const output=work.emptyCell(),ctx=output.getContext('2d'),original=base.readCell(key);if(original)ctx.drawImage(original,0,0);const before=ctx.getImageData(0,0,TILE_SIZE,TILE_SIZE).data;ctx.globalAlpha=opacity;ctx.drawImage(ink,0,0);const after=ctx.getImageData(0,0,TILE_SIZE,TILE_SIZE).data;
        if(after.some((v,i)=>v!==before[i])){validateAllocation({workBytes:(++count)*TILE_SIZE*TILE_SIZE*4,scratchBytes:TILE_SIZE*TILE_SIZE*8});work.tiles.set(key,cell(output));changed=true;}else output.width=output.height=1;ink.width=ink.height=1;
    }
    return{raster:work,changed};
}
