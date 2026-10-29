// Derived views only: no uploads, graph traversal or source-state mutations.
export const minimumStep=config=>[0,1,2].includes(config?.minimalstepgranularity)?[32,16,8][config.minimalstepgranularity]:32;
export const normalizeDimension=(value,multiple)=>Math.min(4096,Math.max(multiple,Math.ceil((Number.isFinite(Number(value))?Number(value):multiple)/multiple)*multiple));
export function alignedSize(width,height,method,multiple=32) {
    const round=n=>Math.max(multiple,(method==='Crop'?Math.floor(n/multiple):Math.ceil(n/multiple))*multiple);
    return [round(width),round(height)];
}
export function viewMetadata(doc,method,multiple=32) {
    const [width,height]=alignedSize(doc.width,doc.height,method,multiple);
    return {source_id:doc.id,source_width:doc.width,source_height:doc.height,width,height,method,multiple};
}
const surface=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
export function alignRaster(image,view,padEdges=true) {
    const sw=image.naturalWidth||image.width,sh=image.naturalHeight||image.height;
    const {width:w,height:h,method}=view;
    if(sw===w&&sh===h)return image;
    const canvas=surface(w,h),ctx=canvas.getContext('2d');
    if(method==='Stretch'){ctx.drawImage(image,0,0,w,h);return canvas;}
    const cw=Math.min(sw,w),ch=Math.min(sh,h),sx=Math.floor((sw-cw)/2),sy=Math.floor((sh-ch)/2);
    const dx=Math.floor((w-cw)/2),dy=Math.floor((h-ch)/2);
    // Edge replication matches the backend; masks instead pad with no selection.
    if(padEdges&&(dx||dy||w>cw||h>ch)) {
        ctx.drawImage(image,sx,sy,1,ch,0,dy,dx,ch);
        ctx.drawImage(image,sx+cw-1,sy,1,ch,dx+cw,dy,w-dx-cw,ch);
        ctx.drawImage(image,sx,sy,cw,1,dx,0,cw,dy);
        ctx.drawImage(image,sx,sy+ch-1,cw,1,dx,dy+ch,cw,h-dy-ch);
        for(const [x,y,iw,ih,tx,ty,tw,th] of [
            [sx,sy,1,1,0,0,dx,dy],[sx+cw-1,sy,1,1,dx+cw,0,w-dx-cw,dy],
            [sx,sy+ch-1,1,1,0,dy+ch,dx,h-dy-ch],
            [sx+cw-1,sy+ch-1,1,1,dx+cw,dy+ch,w-dx-cw,h-dy-ch]])
            if(tw&&th)ctx.drawImage(image,x,y,iw,ih,tx,ty,tw,th);
    }
    ctx.drawImage(image,sx,sy,cw,ch,dx,dy,cw,ch);return canvas;
}
export function isBlankRaster(image) {
    const c=surface(image.naturalWidth||image.width,image.naturalHeight||image.height);
    const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
    const data=ctx.getImageData(0,0,c.width,c.height).data;
    for(let i=0;i<data.length;i+=4)if(data[i]!==255||data[i+1]!==255||data[i+2]!==255)return false;
    return true;
}
export function transferSelection(image,old,next) {
    if(!old||!next)return image;
    if(['source_id','source_width','source_height'].some(k=>old[k]!==next[k]))return image;
    if((image.naturalWidth||image.width)!==old.width||(image.naturalHeight||image.height)!==old.height)
        throw Error('Painted mask dimensions disagree with saved alignment view');
    const source=surface(old.source_width,old.source_height),ctx=source.getContext('2d');
    if(old.method==='Stretch')ctx.drawImage(image,0,0,source.width,source.height);
    else {
        const cw=Math.min(source.width,old.width),ch=Math.min(source.height,old.height);
        ctx.drawImage(image,Math.floor((old.width-cw)/2),Math.floor((old.height-ch)/2),cw,ch,
            Math.floor((source.width-cw)/2),Math.floor((source.height-ch)/2),cw,ch);
    }
    return alignRaster(source,next,false);
}
