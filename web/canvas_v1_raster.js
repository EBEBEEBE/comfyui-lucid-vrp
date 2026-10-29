// Browser raster helpers. Stroke geometry is in document pixels, independent
// of pointer sample count, zoom, layer scale and display pixel ratio.
import {IDENTITY} from './canvas_v1_geometry.js';
import {tileStroke} from './canvas_v1_tile_stroke.js';
import {isTiled,drawSource} from './canvas_v1_tiles.js';
export {applyTileCoverage} from './canvas_v1_tile_stroke.js';

export function raster(width,height,source=null) {
    const canvas=document.createElement('canvas'); canvas.width=width; canvas.height=height;
    if (source) drawSource(canvas.getContext('2d'),source,0,0);
    return canvas;
}

export function emptyMask(width,height) {
    const canvas=raster(width,height),ctx=canvas.getContext('2d');
    ctx.fillStyle='#000'; ctx.fillRect(0,0,width,height); return canvas;
}

export function tipRaster(brush,color,random) {
    const size=Math.max(1,Math.min(250,brush.size)),side=Math.ceil(size)+4,canvas=raster(side,side);
    const ctx=canvas.getContext('2d'),radius=size/2;
    if (brush.tip==='spray') {
        ctx.fillStyle=color;
        const particle=Math.max(.65,Math.min(2.5,size*.018));
        const count=Math.max(14,Math.round(radius*radius*.45/(particle*particle)));
        for (let i=0;i<count;i++) {
            const r=radius*Math.sqrt(random()),a=random()*Math.PI*2;
            ctx.globalAlpha=.9*Math.min(1,(1-r/radius)/Math.max(.08,1-brush.hardness));
            ctx.beginPath();ctx.arc(side/2+Math.cos(a)*r,side/2+Math.sin(a)*r,
                particle*(.75+random()*.5),0,Math.PI*2);ctx.fill();
        }
        return canvas;
    }
    const pixels=ctx.createImageData(side,side),rgb=color.match(/\w\w/g).map(hex=>parseInt(hex,16));
    for (let y=0;y<side;y++) for(let x=0;x<side;x++) {
        let px=(x+.5-side/2)/radius,py=(y+.5-side/2)/radius;
        if (brush.tip==='ink') {
            const angle=-Math.PI/5.2,rx=px*Math.cos(angle)+py*Math.sin(angle);
            py=-px*Math.sin(angle)+py*Math.cos(angle);px=rx/.38;
        }
        const distance=brush.tip==='square'?Math.max(Math.abs(px),Math.abs(py)):Math.hypot(px,py);
        const edge=Math.max(1/radius,1-brush.hardness);
        const alpha=Math.max(0,Math.min(1,(1-distance)/edge+.5/radius));
        const i=(y*side+x)*4;pixels.data.set([...rgb,Math.round(alpha*255)],i);
    }
    ctx.putImageData(pixels,0,0);return canvas;
}

// The returned work surface is private until the completed gesture is accepted.
// Recompose from an immutable baseline so opacity caps a stroke, not each dab.
export function createRasterStroke({source,width,height,transform=IDENTITY,warp,brush,mask=false,erase=false,seed=1,
    expand=false,validateSize=()=>{},validateAllocation=()=>{}}) {
    const settings={...brush,size:Math.max(1,Math.min(250,brush.size))};
    return tileStroke({source,width,height,transform,warp,brush:settings,mask,erase,seed,expand,validateSize,validateAllocation},tipRaster);
}

export function alphaBounds(source,width,height) {
    if(isTiled(source))return source.bounds();
    const data=(source.getContext?source:raster(width,height,source)).getContext('2d').getImageData(0,0,width,height).data;
    let x0=width,y0=height,x1=-1,y1=-1;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>0) {
        x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);
    }
    return x1<0?{x:width/2-30,y:height/2-30,width:60,height:60}:
        {x:x0,y:y0,width:x1-x0+1,height:y1-y0+1};
}

// O(width*height) square-kernel dilation/erosion of grayscale coverage.
export function morphCoverage(source,width,height,radius,expand) {
    const pixels=source.getContext('2d').getImageData(0,0,width,height).data;
    let input=new Uint8Array(width*height),middle=new Uint8Array(input.length),result=new Uint8Array(input.length);
    for(let i=0;i<input.length;i++)input[i]=pixels[i*4];
    function pass(from,to,rows,length,index) {
        const queue=new Int32Array(length);
        for(let row=0;row<rows;row++) {
            let head=0,tail=0,right=-1;
            for(let p=0;p<length;p++) {
                const end=Math.min(length-1,p+radius);
                while(right<end) {
                    right++;const value=from[index(row,right)];
                    while(tail>head&&(expand?from[index(row,queue[tail-1])]<=value:from[index(row,queue[tail-1])]>=value))tail--;
                    queue[tail++]=right;
                }
                while(head<tail&&queue[head]<p-radius)head++;
                to[index(row,p)]=from[index(row,queue[head])];
            }
        }
    }
    pass(input,middle,height,width,(row,p)=>row*width+p);
    pass(middle,result,width,height,(row,p)=>p*width+row);
    const canvas=emptyMask(width,height),ctx=canvas.getContext('2d'),out=ctx.getImageData(0,0,width,height);
    for(let i=0;i<result.length;i++)out.data.set([result[i],result[i],result[i],255],i*4);
    ctx.putImageData(out,0,0);return canvas;
}

// Seed-relative, four-connected fill. Layer sampling compares premultiplied RGB
// and alpha so transparent pixels cannot masquerade as opaque black boundaries.
export function floodCoverage(image,x,y,tolerance=30,{alphaAware=false,allowed=null}={}) {
    if(!Number.isFinite(tolerance)||tolerance<0||tolerance>255)throw Error('Fill threshold must be between 0 and 255');
    const {width,height}=image,sx=Math.floor(x),sy=Math.floor(y);
    if(sx<0||sy<0||sx>=width||sy>=height)return null;
    if(allowed&&!allowed(sx+.5,sy+.5))return null;
    const pixels=image.getContext('2d').getImageData(0,0,width,height).data;
    const seed=(sy*width+sx)*4,seedAlpha=pixels[seed+3]/255;
    const seedRGB=[0,1,2].map(channel=>pixels[seed+channel]*(alphaAware?seedAlpha:1));
    const seen=new Uint8Array(width*height),queue=new Int32Array(seen.length);
    let head=0,tail=1;queue[0]=sy*width+sx;seen[queue[0]]=1;
    while(head<tail) {
        const at=queue[head++],px=at%width,py=Math.floor(at/width);
        for(const next of [px>0?at-1:-1,px<width-1?at+1:-1,py>0?at-width:-1,py<height-1?at+width:-1]) {
            if(next<0||seen[next])continue;seen[next]=1;const i=next*4;
            if(allowed&&!allowed(next%width+.5,Math.floor(next/width)+.5))continue;
            const alpha=alphaAware?pixels[i+3]/255:1;
            const error=(pixels[i]*alpha-seedRGB[0])**2+(pixels[i+1]*alpha-seedRGB[1])**2+(pixels[i+2]*alpha-seedRGB[2])**2;
            const alphaMatches=!alphaAware||Math.abs(pixels[i+3]-pixels[seed+3])<=tolerance;
            if(alphaMatches&&error<=tolerance*tolerance*3)queue[tail++]=next;
        }
    }
    const canvas=raster(width,height),ctx=canvas.getContext('2d'),out=ctx.createImageData(width,height);
    for(let p=0;p<tail;p++)out.data.set([255,255,255,255],queue[p]*4);
    ctx.putImageData(out,0,0);return canvas;
}
