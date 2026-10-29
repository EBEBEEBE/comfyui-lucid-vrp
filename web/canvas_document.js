// Small integration adapter; the shared controller knows nothing about regions.
import { app, publish, clearPublishedCanvas, isDocumentCanvasNode } from './classic_adapter.js';
import { installUserConfig } from './region_ui.js';
import { attachImageDocument } from './image_document_controller.js';
export { validCanvasSize, megapixelSize } from './image_document_controller.js';

export function attachDocumentCanvas(node) {
    attachImageDocument(node,{
        publish(node,state,image){node.vrpCanvasImage=image;publish(node,state);},
        clear:clearPublishedCanvas,
    });
    node.vrpDocumentController=node.imageDocumentController;
}
app.registerExtension({
    name:'AnimaVRP.DocumentCanvas',
    beforeRegisterNodeDef(nodeType,nodeData){
        if(isDocumentCanvasNode(nodeData)||nodeData.name==='VRPStandaloneImageLoader')
            installUserConfig(nodeType,nodeData,'preset');
    },
    nodeCreated(node){
        if(isDocumentCanvasNode(node))attachDocumentCanvas(node);
        else if(node.comfyClass==='VRPStandaloneImageLoader')attachImageDocument(node);
    },
});
