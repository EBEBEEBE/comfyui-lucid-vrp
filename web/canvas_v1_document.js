// Isolated rich-editor model; NOT the loader's existing document_state schema.
// No DOM, extension registration, image decoding, upload or runtime side effects.
import { IDENTITY, inverse, validateWarp, multiply, translation } from './canvas_v1_geometry.js';

const FORMAT='lucid-vrp-raster';
const DOCUMENT_FIELDS=['format','version','id','width','height','layers','mask'];
const LAYER_FIELDS=['id','type','name','width','height','asset_ref','visible','locked','opacity','transform'];
const EDITABLE_FIELDS=['name','visible','locked','opacity','transform','warp','crop'];
const OPTIONAL_FIELDS=['warp','crop','parent_id'];

function object(value, label) {
    if (!value || typeof value!=='object' || Array.isArray(value)) throw Error(`${label} must be an object`);
}

function fields(value, names, label) {
    object(value,label);
    const keys=Object.keys(value);
    if (keys.length!==names.length || keys.some(key=>!names.includes(key)))
        throw Error(`Invalid ${label} fields`);
}

function text(value, label) {
    if (typeof value!=='string' || !value.trim()) throw Error(`${label} must be nonempty text`);
}

function dimensions(width, height) {
    if (![width,height].every(value=>Number.isSafeInteger(value)&&value>0))
        throw Error('Dimensions must be positive safe integers');
}

function asset(reference, required=false) {
    if (reference!==null || required) text(reference,'Asset reference');
}

function copyLayer(value) {
    fields(value,[...LAYER_FIELDS,...OPTIONAL_FIELDS.filter(key=>Object.hasOwn(value,key))],'layer');
    text(value.id,'Layer ID'); text(value.name,'Layer name');
    if (!['paint','image'].includes(value.type)) throw Error('Unknown layer type');
    dimensions(value.width,value.height);
    asset(value.asset_ref,value.type==='image');
    if (typeof value.visible!=='boolean' || typeof value.locked!=='boolean')
        throw Error('Layer visibility and lock must be boolean');
    if (!Number.isFinite(value.opacity) || value.opacity<0 || value.opacity>1)
        throw Error('Layer opacity must be between zero and one');
    // Painting after transform requires an invertible, representable mapping.
    inverse(value.transform);
    const warp=value.warp==null?null:validateWarp(value.warp);
    const crop=value.crop==null?null:value.crop;
    if(crop!==null){fields(crop,['x','y','width','height'],'crop');if(!Object.values(crop).every(Number.isFinite)||crop.width<1||crop.height<1||!Number.isFinite(crop.x+crop.width+crop.y+crop.height))throw Error('Invalid crop rectangle');if(value.type==='image'&&(crop.x<0||crop.y<0||crop.x+crop.width>value.width||crop.y+crop.height>value.height))throw Error('Image crop exceeds source bounds');}
    if(Object.hasOwn(value,'parent_id')){text(value.parent_id,'Parent image ID');if(value.type!=='paint'||warp||crop||value.transform.slice(0,4).some((v,i)=>v!==IDENTITY[i]))throw Error('Attached paint uses only a local translation');}
    return {id:value.id,type:value.type,name:value.name,width:value.width,height:value.height,
        asset_ref:value.asset_ref,visible:value.visible,locked:value.locked,opacity:value.opacity,
        transform:[...value.transform],...(warp?{warp:{bounds:{...warp.bounds},corners:warp.corners.map(p=>({...p}))}}:{}),...(crop?{crop:{...crop}}:{}),...(Object.hasOwn(value,'parent_id')?{parent_id:value.parent_id}:{})};
}

export function parseDocument(value) {
    if (typeof value==='string') {
        try { value=JSON.parse(value); } catch { throw Error('Invalid canvas document JSON'); }
    }
    fields(value,DOCUMENT_FIELDS,'document');
    if (value.format!==FORMAT || ![1,2].includes(value.version)) throw Error('Unsupported canvas document format/version');
    text(value.id,'Document ID'); dimensions(value.width,value.height);
    if (!Array.isArray(value.layers)) throw Error('Document layers must be an array');
    const layers=value.layers.map(copyLayer), ids=new Set();
    for (const layer of layers) {
        if (ids.has(layer.id)) throw Error('Duplicate layer ID');
        ids.add(layer.id);
    }
    for(const [index,layer]of layers.entries())if(layer.parent_id){const parent=layers[index-1];if(!parent||parent.id!==layer.parent_id||parent.type!=='image')throw Error('One attached paint layer must immediately follow its image');}
    if(value.version===1&&layers.some(layer=>layer.crop||layer.parent_id))throw Error('Crop and attached paint require canvas version 2');
    fields(value.mask,['asset_ref'],'mask'); asset(value.mask.asset_ref);
    return {format:FORMAT,version:value.version,id:value.id,width:value.width,height:value.height,
        layers,mask:{asset_ref:value.mask.asset_ref}};
}

export function serializeDocument(value) {
    return JSON.stringify(parseDocument(value));
}

export function createDocument({id,width,height}) {
    return parseDocument({format:FORMAT,version:1,id,width,height,layers:[],mask:{asset_ref:null}});
}

export function createLayer({id,type='paint',name='Paint',width,height,asset_ref=null,
    visible=true,locked=false,opacity=1,transform=IDENTITY,warp=null,crop=null,parent_id}) {
    return copyLayer({id,type,name,width,height,asset_ref,visible,locked,opacity,transform,...(warp?{warp}:{}),...(crop?{crop}:{}),...(parent_id?{parent_id}:{})});
}

function finish(next){if(next.layers.some(l=>l.crop||l.parent_id))next.version=2;return parseDocument(next);}
export const overlayFor=(value,id)=>value.layers.find(l=>l.parent_id===id);
export const objectRoot=(value,layer)=>layer?.parent_id?value.layers.find(l=>l.id===layer.parent_id):layer;
export function lockError(layer,action='edit this layer'){const error=Error(`Unlock "${layer.name}" to ${action}.`);error.lockedLayerId=layer.id;return error;}
// Translate a source origin without altering the mapping of retained pixels.
export function shiftedGeometry(layer,x,y){return{transform:multiply(layer.transform,translation(x,y)),...(layer.warp?{warp:{bounds:{...layer.warp.bounds,x:layer.warp.bounds.x-x,y:layer.warp.bounds.y-y},corners:layer.warp.corners.map(p=>({x:p.x-x,y:p.y-y}))}}:{}),...(layer.crop?{crop:{...layer.crop,x:layer.crop.x-x,y:layer.crop.y-y}}:{})};}
// The parent owns geometry, but the child's paint permission is its own flag.
export function effectiveLayer(value,layer){if(!layer?.parent_id)return layer;const parent=objectRoot(value,layer);return{...layer,...shiftedGeometry(parent,layer.transform[4],layer.transform[5]),visible:layer.visible&&parent.visible,locked:layer.locked};}
export function addOverlay(value,parentId,id){const next=parseDocument(value),index=indexOf(next,parentId),parent=next.layers[index];if(parent.type!=='image'||!parent.visible)throw Error('Choose a visible image');if(overlayFor(next,parentId))throw Error('This image already has a paint overlay');next.layers.splice(index+1,0,createLayer({id,name:`${parent.name} paint`,width:parent.width,height:parent.height,parent_id:parentId}));return finish(next);}
export function detachOverlay(value,id){const next=parseDocument(value),index=indexOf(next,id),item=next.layers[index];if(!item.parent_id)throw Error('Select an attached paint layer');const parent=objectRoot(next,item),resolved=effectiveLayer(next,item);if(item.locked)throw lockError(item,'detach this paint layer');delete resolved.parent_id;resolved.opacity=item.opacity*parent.opacity;next.layers[index]=copyLayer(resolved);return finish(next);}
export function attachPaint(value,id,parentId,replacement){const next=parseDocument(value),index=indexOf(next,id),parent=next.layers[indexOf(next,parentId)],item=next.layers[index];if(item.type!=='paint'||item.parent_id)throw Error('Choose a free paint layer');if(item.locked)throw lockError(item,'attach this paint layer');if(parent.type!=='image'||!parent.visible||overlayFor(next,parentId))throw Error('Choose a visible image without an overlay');const attached=copyLayer({...item,...replacement,parent_id:parentId,warp:null,crop:null});next.layers.splice(index,1);next.layers.splice(indexOf(next,parentId)+1,0,attached);return finish(next);}
// A direct attachment changes metadata only. A transformed destination can
// require a bake even when the paint itself has never been transformed.
export function directAttachment(value,id,parentId){const item=value.layers.find(l=>l.id===id),parent=value.layers.find(l=>l.id===parentId);
    if(!item||item.type!=='paint'||item.parent_id||!parent||parent.type!=='image'||!parent.visible||overlayFor(value,parentId))throw Error('Attachment target is no longer available');
    if(item.locked)throw lockError(item,'attach this paint layer');
    if(!item.asset_ref)return{asset_ref:null,width:1,height:1,transform:[...IDENTITY]};
    if(item.warp||item.crop||parent.warp||parent.crop)return null;
    const relative=multiply(inverse(parent.transform),item.transform);if(relative.slice(0,4).some((v,i)=>Math.abs(v-IDENTITY[i])>1e-10))return null;
    return{asset_ref:item.asset_ref,width:item.width,height:item.height,transform:[1,0,0,1,relative[4],relative[5]]};
}

function indexOf(document, id) {
    const index=document.layers.findIndex(layer=>layer.id===id);
    if (index<0) throw Error(`Unknown layer ID: ${id}`);
    return index;
}

function position(index, maximum) {
    if (!Number.isInteger(index) || index<0 || index>maximum) throw Error('Layer position is out of range');
}

export function addLayer(value, layer, index) {
    const next=parseDocument(value);
    if (index===undefined) index=next.layers.length;
    position(index,next.layers.length);
    next.layers.splice(index,0,copyLayer(layer));
    return finish(next);
}

export function removeLayer(value, id) {
    const next=parseDocument(value);
    const index=indexOf(next,id),count=overlayFor(next,id)?2:1;next.layers.splice(index,count);
    return finish(next);
}

// Index is the final position; layers are ordered bottom to top.
export function reorderLayer(value, id, index) {
    const next=parseDocument(value);
    position(index,next.layers.length-1);
    const from=indexOf(next,id);if(next.layers[from].parent_id)throw Error('Detach the overlay before reordering it');
    const block=next.layers.splice(from,overlayFor(next,id)?2:1);next.layers.splice(index,0,...block);
    return finish(next);
}

export function duplicateLayer(value, id, newId, name) {
    const next=parseDocument(value), index=indexOf(next,id), source=next.layers[index];
    if(source.parent_id)throw Error('Duplicate the image object or detach its overlay first');
    const child=overlayFor(next,id),copies=[{...source,id:newId,name:name??`${source.name} copy`}];if(child)copies.push({...child,id:`${newId}:paint`,parent_id:newId});
    next.layers.splice(index+(child?2:1),0,...copies);
    return finish(next);
}

export function updateLayer(value, id, patch) {
    object(patch,'Layer update');
    if (Object.keys(patch).some(key=>!EDITABLE_FIELDS.includes(key))) throw Error('Unsupported layer update field');
    const next=parseDocument(value), index=indexOf(next,id), source=next.layers[index];
    if (source.locked && ['transform','warp','crop'].some(key=>Object.hasOwn(patch,key)) && patch.locked!==false)
        throw lockError(source,'transform it');
    next.layers[index]=copyLayer({...source,...patch});
    return finish(next);
}

export function setMaskReference(value, reference) {
    const next=parseDocument(value);
    asset(reference); next.mask={asset_ref:reference};
    return next;
}

// A completed raster edit gets a new immutable reference, never an overwrite
// of content referenced by another layer or an earlier history snapshot.
export function replaceLayerAsset(value, id, reference) {
    const next=parseDocument(value), index=indexOf(next,id), layer=next.layers[index];
    if (layer.locked) throw lockError(layer,'change its pixels');
    asset(reference,layer.type==='image');
    next.layers[index]={...layer,asset_ref:reference};
    return next;
}

// A paint edit can extend native storage beyond its old transformed rectangle.
// Atomically publish the asset, dimensions and compensated affine placement.
export function replacePaintRaster(value,id,replacement) {
    fields(replacement,['asset_ref','width','height','transform',...(Object.hasOwn(replacement,'warp')?['warp']:[])],'paint raster');
    const next=parseDocument(value),index=indexOf(next,id),layer=next.layers[index];
    if(layer.type!=='paint')throw Error('Only paint layers can extend raster storage');
    if(layer.locked)throw lockError(layer,'paint on it');
    asset(replacement.asset_ref,true);
    let crop=layer.crop;if(crop){const origin=multiply(inverse(layer.transform),replacement.transform);crop={...crop,x:crop.x-origin[4],y:crop.y-origin[5]};}
    next.layers[index]=copyLayer({...layer,...replacement,...(crop?{crop}:{})});return finish(next);
}

export function assetReferences(value) {
    const doc=parseDocument(value);
    return [...new Set([...doc.layers.map(layer=>layer.asset_ref),doc.mask.asset_ref]
        .filter(reference=>reference!==null))];
}
