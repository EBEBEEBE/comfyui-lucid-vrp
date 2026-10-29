// Native pixels in persistent sparse tiles. Snapshots share untouched cells;
// source dimensions and the stable grid origin survive off-frame growth.
export const TILE_SIZE=128;
let sequence=0;
const make=(w,h)=>typeof document==='undefined'?new OffscreenCanvas(w,h):Object.assign(document.createElement('canvas'),{width:w,height:h});
export const isTiled=source=>source instanceof TileRaster;
export const keyFor=(x,y)=>`${x},${y}`;
export function cell(canvas,revision=0,id=`${typeof document==='undefined'?'derived':'cell'}:${++sequence}`){return{canvas,revision,id};}
export function drawSource(ctx,source,...args){if(isTiled(source)){if(!source.mask&&!source.tiles.size)return;if(args.length===4&&args[2]*args[3]<=4096){const [x,y,w,h]=args;ctx.save();ctx.translate(x,y);ctx.scale(w/source.width,h/source.height);if(source.mask){ctx.fillStyle='#000';ctx.fillRect(0,0,source.width,source.height);}for(const [key,entry]of source.tiles){const p=source.position(key);ctx.drawImage(entry.canvas,p.x,p.y);}ctx.restore();return;}if(args.length===2){const [dx,dy]=args,m=ctx.getTransform().inverse(),points=[[0,0],[ctx.canvas.width,0],[ctx.canvas.width,ctx.canvas.height],[0,ctx.canvas.height]].map(([x,y])=>({x:m.a*x+m.c*y+m.e-dx,y:m.b*x+m.d*y+m.f-dy}));const x=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x)))-2),y=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y)))-2),right=Math.min(source.width,Math.ceil(Math.max(...points.map(p=>p.x)))+2),bottom=Math.min(source.height,Math.ceil(Math.max(...points.map(p=>p.y)))+2);if(right<=x||bottom<=y)return;const image=source.materialize({x,y,width:right-x,height:bottom-y});try{ctx.drawImage(image,dx+x,dy+y);}finally{image.width=image.height=1;}return;}const image=source.materialize();try{ctx.drawImage(image,...args);}finally{image.width=image.height=1;}}else ctx.drawImage(source,...args);}
export function residentBytes(sources){const seen=new Set();let bytes=0;for(const source of sources){const values=isTiled(source)?[...source.tiles.values()].map(c=>c.canvas):[source];for(const value of values)if(value&&!seen.has(value)){seen.add(value);bytes+=(value.naturalWidth??value.width)*(value.naturalHeight??value.height)*4;}}return bytes;}
export class TileRaster{
    constructor(width,height,{tiles=new Map(),originX=0,originY=0,mask=false}={}){this.width=width;this.height=height;this.tiles=tiles;this.originX=originX;this.originY=originY;this.mask=mask;}
    fork(){const next=new TileRaster(this.width,this.height,{tiles:new Map(this.tiles),originX:this.originX,originY:this.originY,mask:this.mask});next.identity=this.identity??this;return next;}
    grow(width,height,x,y){this.width=width;this.height=height;this.originX+=x;this.originY+=y;}
    position(key){const [x,y]=key.split(',').map(Number);return{x:x*TILE_SIZE+this.originX,y:y*TILE_SIZE+this.originY};}
    *keys(area){const left=Math.floor((area.x-this.originX)/TILE_SIZE),right=Math.floor((area.x+area.width-1-this.originX)/TILE_SIZE),top=Math.floor((area.y-this.originY)/TILE_SIZE),bottom=Math.floor((area.y+area.height-1-this.originY)/TILE_SIZE);for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++)yield keyFor(x,y);}
    emptyCell(){const canvas=make(TILE_SIZE,TILE_SIZE);if(this.mask){const ctx=canvas.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,TILE_SIZE,TILE_SIZE);}return canvas;}
    readCell(key){return this.tiles.get(key)?.canvas;}
    // Integer-position assembly avoids interpolation seams at tile boundaries.
    materialize(area={x:0,y:0,width:this.width,height:this.height}){if(![area.width,area.height].every(n=>Number.isSafeInteger(n)&&n>0)||area.width*area.height*4>192*1024*1024)throw Error('This native raster region exceeds the 192 MiB assembly budget. Undo distant off-frame paint or use a smaller region.');const canvas=make(area.width,area.height),ctx=canvas.getContext('2d');ctx.save();ctx.beginPath();ctx.rect(-area.x,-area.y,this.width,this.height);ctx.clip();if(this.mask){ctx.fillStyle='#000';ctx.fillRect(0,0,area.width,area.height);}for(const key of this.keys(area)){const entry=this.tiles.get(key);if(!entry)continue;const p=this.position(key);ctx.drawImage(entry.canvas,p.x-area.x,p.y-area.y);}ctx.restore();return canvas;}
    getContext(){return{getImageData:(x,y,width,height)=>{const image=this.materialize({x,y,width,height});try{return image.getContext('2d').getImageData(0,0,width,height);}finally{image.width=image.height=1;}}};}
    bounds(){let x0=this.width,y0=this.height,x1=-1,y1=-1;for(const [key,entry]of this.tiles){const p=this.position(key);if(entry.boundsRevision!==entry.revision){const pixels=entry.canvas.getContext('2d').getImageData(0,0,TILE_SIZE,TILE_SIZE).data;let left=TILE_SIZE,top=TILE_SIZE,right=-1,bottom=-1;for(let y=0;y<TILE_SIZE;y++)for(let x=0;x<TILE_SIZE;x++)if(pixels[(y*TILE_SIZE+x)*4+3]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}entry.bounds={left,top,right,bottom};entry.boundsRevision=entry.revision;}const b=entry.bounds;if(b.right>=0){x0=Math.min(x0,p.x+b.left);y0=Math.min(y0,p.y+b.top);x1=Math.max(x1,p.x+b.right);y1=Math.max(y1,p.y+b.bottom);}}return x1<0?{x:this.width/2-30,y:this.height/2-30,width:60,height:60}:{x:x0,y:y0,width:x1-x0+1,height:y1-y0+1};}
    static from(source,{mask=false,base=null}={}){
        if(isTiled(source))return source;
        const width=source.naturalWidth??source.width,height=source.naturalHeight??source.height,result=new TileRaster(width,height,{mask});
        const strip=make(width,TILE_SIZE),ctx=strip.getContext('2d',{willReadFrequently:true});
        for(let y=0;y<height;y+=TILE_SIZE){ctx.clearRect(0,0,width,TILE_SIZE);ctx.drawImage(source,0,-y);const pixels=ctx.getImageData(0,0,width,TILE_SIZE).data;
            for(let x=0;x<width;x+=TILE_SIZE){let occupied=false;for(let yy=0;yy<Math.min(TILE_SIZE,height-y)&&!occupied;yy++)for(let xx=0;xx<Math.min(TILE_SIZE,width-x);xx++){const i=(yy*width+x+xx)*4;if(mask?pixels[i]!==0:pixels[i+3]!==0){occupied=true;break;}}
                if(!occupied)continue;const key=keyFor(x/TILE_SIZE,y/TILE_SIZE),canvas=result.emptyCell();canvas.getContext('2d').clearRect(0,0,TILE_SIZE,TILE_SIZE);canvas.getContext('2d').drawImage(strip,x,0,Math.min(TILE_SIZE,width-x),Math.min(TILE_SIZE,height-y),0,0,Math.min(TILE_SIZE,width-x),Math.min(TILE_SIZE,height-y));
                let previous=base?.originX===0&&base?.originY===0?base.tiles.get(key):null;if(previous){const a=previous.canvas.getContext('2d').getImageData(0,0,TILE_SIZE,TILE_SIZE).data,b=canvas.getContext('2d').getImageData(0,0,TILE_SIZE,TILE_SIZE).data;if(a.every((v,i)=>v===b[i])){canvas.width=canvas.height=1;result.tiles.set(key,previous);continue;}}
                result.tiles.set(key,cell(canvas));
            }
        }strip.width=strip.height=1;return result;
    }
}
