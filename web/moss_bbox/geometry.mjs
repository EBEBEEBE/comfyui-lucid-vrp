// Pure editor geometry. Version-2 VRP state stays compatible with Anima's bbox UX.
export const emptyState = () => ({version:2, canvas:{width:1024,height:1024}, regions:[]});
export function readState(value) {
    const state=typeof value==='string'?JSON.parse(value):structuredClone(value);
    const keys=(object,names)=>object && Object.keys(object).sort().join()===names;
    if(!keys(state,'canvas,regions,version') || state.version!==2 || !keys(state.canvas,'height,width') ||
        !['width','height'].every(k=>Number.isInteger(state.canvas[k])&&state.canvas[k]>=8&&state.canvas[k]%8===0) ||
        !Array.isArray(state.regions))throw Error('Invalid version-2 VRP bbox state');
    const ids=new Set();
    for(const r of state.regions){
        if(!keys(r,'height,id,label,negative_prompt,prompt,weight,width,x,y') ||
            typeof r.id!=='string'||!r.id.trim()||ids.has(r.id)||
            typeof r.label!=='string'||!r.label.trim()||typeof r.prompt!=='string'||typeof r.negative_prompt!=='string'||
            !['x','y','width','height','weight'].every(k=>typeof r[k]==='number'&&Number.isFinite(r[k]))||
            r.width<=0||r.height<=0||r.weight<0||r.weight>1)throw Error('Invalid VRP region');
        ids.add(r.id);
        for(const [origin,extent] of [['x','width'],['y','height']]){
            const end=Math.min(1,Math.max(0,r[origin]+r[extent]));
            r[origin]=Math.min(1,Math.max(0,r[origin]));r[extent]=end-r[origin];
            if(r[extent]<=0)throw Error('Region has no visible area');
        }
    }
    return state;
}
export const inside=(r,x,y)=>x>=r.x&&x<=r.x+r.width&&y>=r.y&&y<=r.y+r.height;
export function hitRegion(regions,rect,x,y){
    for(let index=regions.length-1;index>=0;index--){
        const r=regions[index],box={x:rect.x+r.x*rect.width,y:rect.y+r.y*rect.height,width:r.width*rect.width,height:r.height*rect.height};
        if(x<box.x-7||x>box.x+box.width+7||y<box.y-7||y>box.y+box.height+7)continue;
        const edges={left:Math.abs(x-box.x)<=7,right:Math.abs(x-box.x-box.width)<=7,
            top:Math.abs(y-box.y)<=7,bottom:Math.abs(y-box.y-box.height)<=7};
        if(inside(box,x,y)||((edges.left||edges.right)&&(edges.top||edges.bottom)))return {index,edges,
            kind:Object.values(edges).some(Boolean)?'resize':'move'};
    }
    return null;
}
export function transformBox(original,kind,edges,dx,dy){
    const r={...original},minimum=.005;
    if(kind==='move'){
        r.x=Math.max(0,Math.min(1-r.width,original.x+dx));r.y=Math.max(0,Math.min(1-r.height,original.y+dy));
    }else{
        const right=original.x+original.width,bottom=original.y+original.height;
        if(edges.left){r.x=Math.max(0,Math.min(right-minimum,original.x+dx));r.width=right-r.x;}
        if(edges.right)r.width=Math.max(minimum,Math.min(1-original.x,original.width+dx));
        if(edges.top){r.y=Math.max(0,Math.min(bottom-minimum,original.y+dy));r.height=bottom-r.y;}
        if(edges.bottom)r.height=Math.max(minimum,Math.min(1-original.y,original.height+dy));
    }
    return r;
}
export function draftBox(rect,startX,startY,x,y){
    const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
    x=clamp(x,rect.x,rect.x+rect.width);y=clamp(y,rect.y,rect.y+rect.height);
    return {x:(Math.min(startX,x)-rect.x)/rect.width,y:(Math.min(startY,y)-rect.y)/rect.height,
        width:Math.abs(x-startX)/rect.width,height:Math.abs(y-startY)/rect.height};
}
