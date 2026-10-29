// Shared native-resolution inverse sampler. Each output pixel is written once:
// no triangle overlap, alpha seams, viewport zoom or device-pixel-ratio input.
import {createLayerMapping,rasterAreaPoints,inverse,multiply,translation} from './canvas_v1_geometry.js';
import {drawSource} from './canvas_v1_tiles.js';

const surface=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};

export function drawMapped(context,source,mapping,area,createSurface=surface,crop=null) {
    const x=Math.max(0,Math.floor(area.x)),y=Math.max(0,Math.floor(area.y));
    const width=Math.min(context.canvas.width,Math.ceil(area.x+area.width))-x;
    const height=Math.min(context.canvas.height,Math.ceil(area.y+area.height))-y;
    if(width<=0||height<=0)return;
    const input=source.getContext?source:createSurface(source.naturalWidth??source.width,source.naturalHeight??source.height);
    if(input!==source)input.getContext('2d').drawImage(source,0,0);
    const sw=input.width,sh=input.height,data=input.getContext('2d').getImageData(0,0,sw,sh).data;
    const patch=createSurface(width,height),ctx=patch.getContext('2d'),out=ctx.createImageData(width,height);
    for(let py=0;py<height;py++)for(let px=0;px<width;px++){
        const p=mapping({x:x+px+.5,y:y+py+.5}),sx=p.x-.5,sy=p.y-.5;
        if(crop&&(p.x<crop.x||p.y<crop.y||p.x>=crop.x+crop.width||p.y>=crop.y+crop.height))continue;
        if(!Number.isFinite(sx)||!Number.isFinite(sy)||sx<=-1||sy<=-1||sx>=sw||sy>=sh)continue;
        const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;
        let alpha=0,r=0,g=0,b=0;
        for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
            const xx=ix+dx,yy=iy+dy;if(xx<0||yy<0||xx>=sw||yy>=sh)continue;
            const i=(yy*sw+xx)*4,weight=(dx?fx:1-fx)*(dy?fy:1-fy)*data[i+3];
            alpha+=weight;r+=data[i]*weight;g+=data[i+1]*weight;b+=data[i+2]*weight;
        }
        if(alpha){const i=(py*width+px)*4;out.data[i]=r/alpha;out.data[i+1]=g/alpha;out.data[i+2]=b/alpha;out.data[i+3]=alpha;}
    }
    ctx.putImageData(out,0,0);context.drawImage(patch,x,y);
}

// Paint document-space coverage back into native storage. Its geometry stays
// editable; only newly authored pixels are sampled into the retained source.
export function drawDocumentRaster(context,source,state,area,origin={x:0,y:0},targetOrigin={x:0,y:0}) {
    if(!state.warp){
        context.save();context.setTransform(...multiply(translation(-targetOrigin.x,-targetOrigin.y),inverse(state.transform)));
        context.drawImage(source,origin.x,origin.y);context.restore();return;
    }
    const points=rasterAreaPoints(state,area),x=Math.min(...points.map(p=>p.x))-1-targetOrigin.x,y=Math.min(...points.map(p=>p.y))-1-targetOrigin.y;
    const width=Math.max(...points.map(p=>p.x))+1-x-targetOrigin.x,height=Math.max(...points.map(p=>p.y))+1-y-targetOrigin.y;
    const mapping=createLayerMapping(state);
    drawMapped(context,source,p=>{const q=mapping.forward({x:p.x+targetOrigin.x,y:p.y+targetOrigin.y});return{x:q.x-origin.x,y:q.y-origin.y};},{x,y,width,height});
}

export function drawLayer(context,layer,source,{createSurface=surface,opacity=layer.opacity}={}) {
    context.save();
    try{
        context.globalAlpha=opacity;
        if(!layer.warp){context.setTransform(...layer.transform);if(layer.crop){const c=layer.crop;context.beginPath();context.rect(c.x,c.y,c.width,c.height);context.clip();}drawSource(context,source,0,0);}
        else{
            context.setTransform(1,0,0,1,0,0);
            drawMapped(context,source,createLayerMapping(layer).inverse,
                {x:0,y:0,width:context.canvas.width,height:context.canvas.height},createSurface,layer.crop);
        }
    }finally{context.restore();}
}
