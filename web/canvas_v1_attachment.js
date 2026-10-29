// One deliberate raster bake. Runs in the render worker, never a pointer handler.
import {createLayerMapping,mappedRasterBounds,rasterAreaPoints,IDENTITY} from './canvas_v1_geometry.js';
import {drawMapped} from './canvas_v1_layer_render.js';
export function bakeAttachment(document,id,parentId,loadAsset,createSurface,budget){
    const item=document.layers.find(l=>l.id===id),parent=document.layers.find(l=>l.id===parentId);
    if(!item||item.type!=='paint'||item.parent_id||item.locked||!parent||parent.type!=='image'||!parent.visible||document.layers.some(l=>l.parent_id===parentId))throw Error('Attachment target is no longer available');
    if(!item.asset_ref)return{surface:null,state:{width:1,height:1,transform:[...IDENTITY]}};
    const area=mappedRasterBounds(item),points=rasterAreaPoints(parent,area),x=Math.floor(Math.min(...points.map(p=>p.x)))-1,y=Math.floor(Math.min(...points.map(p=>p.y)))-1;
    const width=Math.ceil(Math.max(...points.map(p=>p.x)))+1-x,height=Math.ceil(Math.max(...points.map(p=>p.y)))+1-y;
    if(![x,y,width,height].every(Number.isSafeInteger)||width<1||height<1||width*height*4>budget)throw Error('Attaching this paint would exceed the raster budget');
    const output=createSurface(width,height),source=loadAsset(item.asset_ref),from=createLayerMapping(item),to=createLayerMapping(parent);
    drawMapped(output.getContext('2d'),source,p=>from.inverse(to.forward({x:p.x+x,y:p.y+y})),{x:0,y:0,width,height},createSurface,item.crop);
    return{surface:output,state:{width,height,transform:[1,0,0,1,x,y]}};
}
