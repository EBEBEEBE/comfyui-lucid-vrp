import * as model from './canvas_v1_document.js';

// beforeId is a root in visual top-to-bottom order; null means the bottom.
// A child drop explicitly detaches then reorders, producing one history value.
export function moveLayerObject(value,id,beforeId,{backgroundId=null}={}){
    let next=model.parseDocument(value);const item=next.layers.find(layer=>layer.id===id);
    if(!item||id===backgroundId)throw Error('Choose a layer other than the background.');
    if(item.type==='paint'&&item.locked)throw model.lockError(item,'reorder this paint layer');
    if(!item.parent_id&&id===beforeId)return next;
    if(item.parent_id)next=model.detachOverlay(next,id);
    const roots=next.layers.filter(layer=>!layer.parent_id).reverse(),moving=roots.find(layer=>layer.id===id),remaining=roots.filter(layer=>layer.id!==id);
    const at=beforeId===null?remaining.length:remaining.findIndex(layer=>layer.id===beforeId);
    if(at<0)throw Error('Drop at a valid layer insertion line.');
    remaining.splice(at,0,moving);
    if(backgroundId&&remaining.some(layer=>layer.id===backgroundId)&&remaining.at(-1).id!==backgroundId)throw Error('The background must stay at the bottom.');
    return model.parseDocument({...next,layers:remaining.reverse().flatMap(layer=>[layer,...(model.overlayFor(next,layer.id)?[model.overlayFor(next,layer.id)]:[])])});
}
