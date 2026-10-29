// Disposable preview rasters. Native pixels, document geometry and history are
// owned by the editor; preview resolution never becomes saved document state.
// Both paths evaluate the existing bilinear cage + radial outside extension.
// The GPU samples a padded premultiplied texture once per pixel: no mesh.
import {inverse,createLayerMapping} from './canvas_v1_geometry.js';

const makeSurface=(w,h)=>new OffscreenCanvas(w,h);
const cross=(ax,ay,bx,by)=>ax*by-ay*bx;
function clipCrop(ctx,layer){if(!layer.crop)return;const c=layer.crop;ctx.beginPath();if(layer.cropOutside)ctx.rect(0,0,layer.width,layer.height);ctx.rect(c.x,c.y,c.width,c.height);ctx.clip('evenodd');}
const vertex=`#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0,1);}`;
const fragment=`#version 300 es
precision highp float;
uniform sampler2D source;
uniform vec2 outputSize,documentSize,viewOrigin,textureSize,sourceSize,contentSize;
uniform vec4 bounds;
uniform vec2 q[4];
uniform mat3 affineInverse;
uniform bool warped;
uniform bool cropped;
uniform bool cropOutside;
uniform vec4 crop;
uniform float opacity;
out vec4 color;
float cross2(vec2 a,vec2 b){return a.x*b.y-a.y*b.x;}
vec2 uvFor(float u,vec2 P,vec2 B,vec2 C,vec2 D){
  vec2 divisor=C+D*u,rest=P-B*u;
  return vec2(u,abs(divisor.x)>abs(divisor.y)?rest.x/divisor.x:rest.y/divisor.y);
}
vec2 warpInverse(vec2 p){
  vec2 A=q[0],B=q[1]-A,C=q[3]-A,D=A-q[1]+q[2]-q[3];
  vec2 center=A+B*.5+C*.5+D*.25,ray=p-center;
  for(int i=0;i<4;i++){
    int j=(i+1)%4;vec2 edge=q[j]-q[i],start=q[i]-center;float den=cross2(ray,edge);
    if(abs(den)<1e-12)continue;
    float t=cross2(start,edge)/den,s=cross2(start,ray)/den;
    if(t>0.0&&t<1.0&&s>=-1e-6&&s<=1.000001){
      vec2 u0=vec2(i==1||i==2?1.0:0.0,i>=2?1.0:0.0);
      vec2 u1=vec2(j==1||j==2?1.0:0.0,j>=2?1.0:0.0);
      return bounds.xy+bounds.zw*(vec2(.5)+(mix(u0,u1,s)-vec2(.5))/t);
    }
  }
  vec2 P=p-A;float a=-cross2(B,D),b=cross2(P,D)-cross2(B,C),c=cross2(P,C);
  vec2 uv;
  if(abs(a)<1e-7*max(1.0,abs(b)))uv=uvFor(-c/b,P,B,C,D);
  else{
    float discriminant=max(0.0,b*b-4.0*a*c),r=-.5*(b+(b>=0.0?1.0:-1.0)*sqrt(discriminant));
    uv=uvFor(r/a,P,B,C,D);
    if(any(lessThan(uv,vec2(-1e-4)))||any(greaterThan(uv,vec2(1.0001))))uv=uvFor(c/r,P,B,C,D);
  }
  return bounds.xy+bounds.zw*uv;
}
void main(){
  vec2 p=viewOrigin+vec2(gl_FragCoord.x,outputSize.y-gl_FragCoord.y)*documentSize/outputSize;
  p=(affineInverse*vec3(p,1)).xy;
  if(warped)p=warpInverse(p);
  if(cropped){bool outside=any(lessThan(p,crop.xy))||any(greaterThanEqual(p,crop.xy+crop.zw));if(outside!=cropOutside){color=vec4(0);return;}}
  color=texture(source,(p*contentSize/sourceSize+vec2(1))/textureSize)*opacity;
}`;

export class GpuPreview {
  constructor(sources,{budget=64*1024*1024}={}){
    this.canvas=makeSurface(1,1);this.output=makeSurface(1,1);this.lost=false;this.draws=0;this.uploads=0;this.bytes=0;this.textures=new Map();
    const gl=this.gl=this.canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false});
    if(!gl)throw Error('WebGL2 unavailable');
    this.canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();this.lost=true;});
    const debug=gl.getExtension('WEBGL_debug_renderer_info');
    this.maxSize=gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    this.renderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    if(/swiftshader|llvmpipe|softpipe|software|basic render driver/i.test(this.renderer)){this.dispose();throw Error('Software WebGL renderer');}
    const compile=(type,text)=>{const shader=gl.createShader(type);gl.shaderSource(shader,text);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const reason=gl.getShaderInfoLog(shader);gl.deleteShader(shader);this.dispose();throw Error(reason);}return shader;};
    const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment),program=this.program=gl.createProgram();
    gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)){const reason=gl.getProgramInfoLog(program);this.dispose();throw Error(reason);}
    this.uniform=Object.fromEntries(['source','outputSize','documentSize','viewOrigin','textureSize','sourceSize','contentSize','bounds','q','affineInverse','warped','opacity','cropped','crop','cropOutside'].map(name=>[name,gl.getUniformLocation(program,name)]));
    this.budget=budget;this.updateSources(sources);
    gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.disable(gl.DITHER);
  }
  updateSources(sources,layers=null,changes=new Map()){
    this.sources=sources;
    const warped=layers?new Set(layers.filter(l=>l.warp).map(l=>l.source)):new Set(sources.keys());
    sources=new Map([...sources].filter(([id])=>warped.has(id)));
    const gl=this.gl;let cost=0;
    for(const source of sources.values())cost+=(source.width+2)*(source.height+2)*4;
    const maxTexture=gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if(gl.isContextLost())throw Error('GPU context lost');
    let scale=Math.min(1,Math.sqrt(this.budget/Math.max(1,cost)));
    for(const source of sources.values())scale=Math.min(scale,(maxTexture-2)/Math.max(source.width,source.height));
    const size=source=>[Math.max(1,Math.floor(source.width*scale)),Math.max(1,Math.floor(source.height*scale))];
    const total=()=>[...sources.values()].reduce((sum,s)=>{const [w,h]=size(s);return sum+(w+2)*(h+2)*4;},0);
    while(total()>this.budget&&scale>1e-5)scale*=.99;
    if(total()>this.budget)throw Error('Texture budget exceeded');
    for(const [id,entry]of this.textures)if(!sources.has(id)){gl.deleteTexture(entry.texture);this.textures.delete(id);}
    for(const [id,source]of sources){
      const [width,height]=size(source),previous=this.textures.get(id),dirty=changes.get(id);
      if(previous?.source===source&&previous.width===width+2&&previous.height===height+2){
        if(!changes.has(id))continue;
        if(dirty){
          const x=Math.max(1,Math.floor(dirty.x*width/source.width)-1),y=Math.max(1,Math.floor(dirty.y*height/source.height)-1);
          const right=Math.min(width+1,Math.ceil((dirty.x+dirty.width)*width/source.width)+3),bottom=Math.min(height+1,Math.ceil((dirty.y+dirty.height)*height/source.height)+3);
          const ctx=previous.padded.getContext('2d');ctx.save();ctx.beginPath();ctx.rect(x,y,right-x,bottom-y);ctx.clip();ctx.clearRect(x,y,right-x,bottom-y);ctx.drawImage(source,1,1,width,height);ctx.restore();
          const patch=makeSurface(right-x,bottom-y);patch.getContext('2d').drawImage(previous.padded,x,y,right-x,bottom-y,0,0,right-x,bottom-y);
          gl.bindTexture(gl.TEXTURE_2D,previous.texture);gl.texSubImage2D(gl.TEXTURE_2D,0,x,y,gl.RGBA,gl.UNSIGNED_BYTE,patch);continue;
        }
      }
      if(previous)gl.deleteTexture(previous.texture);
      const padded=makeSurface(width+2,height+2);padded.getContext('2d').drawImage(source,1,1,width,height);
      const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,padded);
      this.textures.set(id,{texture,width:padded.width,height:padded.height,source,padded});this.uploads++;
    }
    this.bytes=total();
  }
  render({width,height,documentWidth,documentHeight,layers,originX=0,originY=0}){
    const gl=this.gl;if(this.lost||gl.isContextLost())throw Error('GPU context lost');
    if(width>this.maxSize||height>this.maxSize)throw Error('Preview exceeds GPU renderbuffer limit');
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
    if(this.output.width!==width||this.output.height!==height){this.output.width=width;this.output.height=height;}
    const out=this.output.getContext('2d'),sx=width/documentWidth,sy=height/documentHeight;
    out.setTransform(1,0,0,1,0,0);out.globalAlpha=1;out.fillStyle='#fff';out.fillRect(0,0,width,height);
    gl.viewport(0,0,width,height);gl.useProgram(this.program);gl.clearColor(0,0,0,0);
    const u=this.uniform;gl.uniform1i(u.source,0);gl.uniform2f(u.outputSize,width,height);gl.uniform2f(u.documentSize,documentWidth,documentHeight);
    gl.uniform2f(u.viewOrigin,originX,originY);
    for(const layer of layers){
      if(!layer.warp){const [a,b,c,d,e,f]=layer.transform;out.save();out.setTransform(a*sx,b*sy,c*sx,d*sy,(e-originX)*sx,(f-originY)*sy);out.globalAlpha=layer.opacity;clipCrop(out,layer);out.drawImage(this.sources.get(layer.source),0,0);out.restore();continue;}
      const entry=this.textures.get(layer.source);if(!entry)throw Error('Unknown source');
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindTexture(gl.TEXTURE_2D,entry.texture);gl.uniform2f(u.textureSize,entry.width,entry.height);
      gl.uniform2f(u.sourceSize,entry.source.width,entry.source.height);gl.uniform2f(u.contentSize,entry.width-2,entry.height-2);
      const [a,b,c,d,e,f]=inverse(layer.transform??[1,0,0,1,0,0]);gl.uniformMatrix3fv(u.affineInverse,false,[a,b,0,c,d,0,e,f,1]);
      gl.uniform1f(u.opacity,layer.opacity??1);gl.uniform1i(u.warped,!!layer.warp);
      gl.uniform1i(u.cropped,!!layer.crop);if(layer.crop){const c=layer.crop;gl.uniform4f(u.crop,c.x,c.y,c.width,c.height);}
      gl.uniform1i(u.cropOutside,!!layer.cropOutside);
      if(layer.warp){const {bounds:b,corners:q}=layer.warp;gl.uniform4f(u.bounds,b.x,b.y,b.width,b.height);gl.uniform2fv(u.q,q.flatMap(p=>[p.x,p.y]));}
      gl.drawArrays(gl.TRIANGLES,0,3);
      out.drawImage(this.canvas,0,0);
    }
    this.draws++;return this.output;
  }
  dispose(){const gl=this.gl;if(!gl)return;for(const {texture}of this.textures.values())gl.deleteTexture(texture);this.textures.clear();if(this.program)gl.deleteProgram(this.program);gl.getExtension('WEBGL_lose_context')?.loseContext();this.bytes=0;}
}

// Independent closed-form scalar CPU inverse. The current production mapping
// is retained as a rare numerical fallback and as the separate test oracle.
function scalarInverse(layer){
  const affine=inverse(layer.transform??[1,0,0,1,0,0]),warp=layer.warp;
  if(!warp)return(x,y,out)=>{out[0]=affine[0]*x+affine[2]*y+affine[4];out[1]=affine[1]*x+affine[3]*y+affine[5];};
  const {bounds:b,corners:q}=warp,A=q[0],B={x:q[1].x-A.x,y:q[1].y-A.y},C={x:q[3].x-A.x,y:q[3].y-A.y},D={x:A.x-q[1].x+q[2].x-q[3].x,y:A.y-q[1].y+q[2].y-q[3].y};
  const cx=A.x+B.x*.5+C.x*.5+D.x*.25,cy=A.y+B.y*.5+C.y*.5+D.y*.25;
  const aa=-cross(B.x,B.y,D.x,D.y),bc=cross(B.x,B.y,C.x,C.y),uv=[[0,0],[1,0],[1,1],[0,1]],fallback=createLayerMapping(layer);
  const edges=q.map((p,i)=>({x:q[(i+1)%4].x-p.x,y:q[(i+1)%4].y-p.y,sx:p.x-cx,sy:p.y-cy}));
  return(x,y,out)=>{
    const lx=affine[0]*x+affine[2]*y+affine[4],ly=affine[1]*x+affine[3]*y+affine[5],rx=lx-cx,ry=ly-cy;
    for(let i=0;i<4;i++){
      const edge=edges[i],den=cross(rx,ry,edge.x,edge.y);if(Math.abs(den)<1e-16)continue;
      const t=cross(edge.sx,edge.sy,edge.x,edge.y)/den,s=cross(edge.sx,edge.sy,rx,ry)/den;
      if(t>0&&t<1&&s>=-1e-9&&s<=1+1e-9){const j=(i+1)%4;out[0]=b.x+b.width*(.5+(uv[i][0]+(uv[j][0]-uv[i][0])*s-.5)/t);out[1]=b.y+b.height*(.5+(uv[i][1]+(uv[j][1]-uv[i][1])*s-.5)/t);return;}
    }
    const px=lx-A.x,py=ly-A.y,bb=cross(px,py,D.x,D.y)-bc,cc=cross(px,py,C.x,C.y);
    let u,other;
    if(Math.abs(aa)<1e-12*Math.max(1,Math.abs(bb)))u=-cc/bb;
    else{const r=-.5*(bb+(bb>=0?1:-1)*Math.sqrt(Math.max(0,bb*bb-4*aa*cc)));u=r/aa;other=cc/r;}
    const solveV=u=>Math.abs(C.x+D.x*u)>Math.abs(C.y+D.y*u)?(px-B.x*u)/(C.x+D.x*u):(py-B.y*u)/(C.y+D.y*u);
    let v=solveV(u);if((u< -1e-8||u>1+1e-8||v< -1e-8||v>1+1e-8)&&other!==undefined){u=other;v=solveV(u);}
    if(!Number.isFinite(u+v)){const p=fallback.inverse({x,y});out[0]=p.x;out[1]=p.y;return;}
    out[0]=b.x+b.width*u;out[1]=b.y+b.height*v;
  };
}

export class CpuPreview {
  constructor(sources){
    this.canvas=makeSurface(1,1);this.patch=makeSurface(1,1);this.sources=new Map();this.draws=0;
    this.cache=new Map();this.cacheBytes=0;this.cacheBudget=32*1024*1024;this.rasterized=0;
    this.updateSources(sources);
  }
  updateSources(sources,layers=null,changes=new Map()){
    let changed=false;
    const warped=layers?new Set(layers.filter(l=>l.warp).map(l=>l.source)):new Set(sources.keys());
    for(const id of this.sources.keys())if(!sources.has(id)){this.sources.delete(id);changed=true;}
    for(const [id,source]of sources){
      const previous=this.sources.get(id),needsData=warped.has(id);
      if(previous?.source===source&&!changes.has(id)&&!!previous.data===needsData)continue;
      if(previous?.data||needsData)changed=true;
      if(!needsData){this.sources.set(id,{source});continue;}
      const pad=makeSurface(source.width+2,source.height+2),ctx=pad.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,1,1);this.sources.set(id,{source,width:pad.width,height:pad.height,data:ctx.getImageData(0,0,pad.width,pad.height).data});
    }
    if(changed){this.cache.clear();this.cacheBytes=0;}
  }
  render({width,height,documentWidth,documentHeight,layers,originX=0,originY=0}){
    if(!this.pixels||this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;this.patch.width=width;this.patch.height=height;this.pixels=this.patch.getContext('2d').createImageData(width,height);}
    const ctx=this.canvas.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
    const sx=documentWidth/width,sy=documentHeight/height,point=new Float64Array(2),target=this.pixels.data;
    for(const id of this.cache.keys())if(id>=layers.length){this.cacheBytes-=this.cache.get(id).bytes;this.cache.delete(id);}
    for(const [index,layer]of layers.entries()){
      const input=this.sources.get(layer.source);if(!input)throw Error('Unknown source');
      if(!layer.warp){const [a,b,c,d,e,f]=layer.transform??[1,0,0,1,0,0];ctx.save();ctx.setTransform(a/sx,b/sy,c/sx,d/sy,(e-originX)/sx,(f-originY)/sy);ctx.globalAlpha=layer.opacity??1;clipCrop(ctx,layer);ctx.drawImage(input.source,0,0);ctx.restore();continue;}
      const key=JSON.stringify([layer.source,layer.transform,layer.warp,layer.crop,layer.cropOutside,width,height,documentWidth,documentHeight,originX,originY]),cached=this.cache.get(index);
      if(cached?.key===key){ctx.globalAlpha=layer.opacity??1;ctx.drawImage(cached.surface,0,0);ctx.globalAlpha=1;continue;}
      if(cached){this.cacheBytes-=cached.bytes;this.cache.delete(index);}
      target.fill(0);const map=scalarInverse(layer),data=input.data,sw=input.width,sh=input.height;
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        map(originX+(x+.5)*sx,originY+(y+.5)*sy,point);const px=point[0]+.5,py=point[1]+.5;
        if(layer.crop){const c=layer.crop,outside=point[0]<c.x||point[1]<c.y||point[0]>=c.x+c.width||point[1]>=c.y+c.height;if(outside!==!!layer.cropOutside)continue;}
        if(px<0||py<0||px>=sw-1||py>=sh-1)continue;
        const ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy;
        let alpha=0,r=0,g=0,b=0;
        for(let yy=0;yy<2;yy++)for(let xx=0;xx<2;xx++){
          const i=((iy+yy)*sw+ix+xx)*4,w=(xx?fx:1-fx)*(yy?fy:1-fy)*data[i+3];alpha+=w;r+=data[i]*w;g+=data[i+1]*w;b+=data[i+2]*w;
        }
        if(alpha){const i=(y*width+x)*4;target[i]=r/alpha;target[i+1]=g/alpha;target[i+2]=b/alpha;target[i+3]=alpha;}
      }
      this.rasterized++;
      this.patch.getContext('2d').putImageData(this.pixels,0,0);ctx.globalAlpha=layer.opacity??1;ctx.drawImage(this.patch,0,0);ctx.globalAlpha=1;
      const bytes=width*height*4;
      if(bytes<=this.cacheBudget){
        while(this.cacheBytes+bytes>this.cacheBudget&&this.cache.size){const id=this.cache.keys().next().value;this.cacheBytes-=this.cache.get(id).bytes;this.cache.delete(id);}
        const surface=makeSurface(width,height);surface.getContext('2d').drawImage(this.patch,0,0);this.cache.set(index,{key,surface,bytes});this.cacheBytes+=bytes;
      }
    }
    this.draws++;return this.canvas;
  }
  dispose(){this.sources.clear();this.cache.clear();this.cacheBytes=0;this.canvas.width=this.patch.width=1;}
}
