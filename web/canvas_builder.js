import { app, publish, imageURL, upload, showImage, openEditor, observeValue, installDrop } from './classic_adapter.js';
import { randomUUID } from './uuid.js';
const validSize = (w,h) => [w,h].every(n => Number.isInteger(n) && n >= 8 && n <= 4096 && n % 8 === 0);
app.registerExtension({
    name: 'AnimaVRP.CanvasBuilder',
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== 'AnimaCanvasBuilder') return;
        nodeType.prototype.vrpUserConfig=nodeData.input?.required?.preset?.[1]?.vrp_config;
        const configure = nodeType.prototype.configure;
        nodeType.prototype.configure = function (info, ...args) {
            // Older workflows have `latent` at slot 4 and `empty_latent` at
            // slot 5. The unified source-aware output occupies slot 4; move
            // both sets of links there before LiteGraph restores the node.
            if (Array.isArray(info?.outputs) && info.outputs.length === 6) {
                const outputs = info.outputs.map(output => ({
                    ...output,
                    links: Array.isArray(output.links) ? [...output.links] : output.links,
                }));
                const kept = outputs[4] || {};
                const retired = outputs[5] || {};
                const keptLinks = Array.isArray(kept.links) ? kept.links : [];
                const retiredLinks = Array.isArray(retired.links) ? retired.links : [];
                for (const linkId of retiredLinks) {
                    const link = this.graph?._links?.get?.(linkId) ?? this.graph?._links?.[linkId];
                    if (link && (link.origin_id === this.id || String(link.origin_id) === String(this.id))) {
                        link.origin_slot = 4;
                    }
                }
                outputs[4] = { ...kept, links: [...new Set([...keptLinks, ...retiredLinks])] };
                const migrated = { ...info, outputs: outputs.slice(0, 5) };
                this.vrpCanvasLatentLinksMigrated = true;
                return configure.call(this, migrated, ...args);
            }
            return configure.call(this, info, ...args);
        };
    },
    nodeCreated(node) {
        if (node.comfyClass !== 'AnimaCanvasBuilder') return;
        const presets=node.vrpUserConfig?.canvas_presets || {};
        const widget = name => node.widgets.find(w => w.name === name);
        const get = name => widget(name).value;
        let state, mode, bridge, quiet=false, removed=false, epoch=0;
        let pending=Promise.resolve(), queued=false;
        const status=node.addWidget('text','Canvas status','Preparing preview',()=>{},{serialize:false});
        const report=error=>{status.value=String(error.message || error); node.graph?.setDirtyCanvas(true,true);};
        const mutate=fn=>{quiet=true; try {fn();} finally {quiet=false;}};
        const key=()=>`${state.blank.width}x${state.blank.height}`;
        const activeRef=()=>mode==='image' ? state.image.ref : (state.blank.edits[key()] || '');
        const persist=()=>{widget('source_state').value=JSON.stringify(state);};
        function initialize() {
            if (state) return;
            state=get('source_state') ? JSON.parse(get('source_state')) : {version:1,
                blank:{width:get('width'),height:get('height'),preset:get('preset'),edits:{}},
                image:{ref:get('source')==='image' ? get('image') : ''}};
            if (state.version!==1 || !state.blank?.edits || !state.image) throw Error('Invalid canvas source state');
            mode=get('source'); bridge=get('image');
        }
        async function refresh() {
            if (removed || !node.graph) return;
            const token=++epoch;
            try {
                mutate(()=>{
                    initialize();
                    // Capture core editor writes in the previous source before switching.
                    if (get('image')!==bridge) {
                        if (mode==='image') state.image.ref=get('image');
                        else state.blank.edits[key()]=get('image');
                    }
                    if (mode===get('source') && mode==='blank') {
                        state.blank.preset=get('preset');
                        [state.blank.width,state.blank.height]=presets[get('preset')] || [get('width'),get('height')];
                    }
                    mode=get('source');
                    if (mode==='blank') {
                        widget('width').value=state.blank.width; widget('height').value=state.blank.height;
                        widget('preset').value=state.blank.preset;
                    }
                    for (const name of ['width','height','preset']) widget(name).disabled=mode==='image';
                    bridge=activeRef(); widget('image').value=bridge;
                    widget('revision').value=Number(get('revision'))+1; persist();
                });
                publish(node,{ready:false,revision:get('revision')}); showImage(node,null,null);
                let preview=new Image(), ref=null, width=get('width'), height=get('height');
                if (bridge) {
                    const location=imageURL(bridge); ref=location.ref;
                    preview.src=location.url; await preview.decode();
                    if (removed || token!==epoch) return;
                    width=preview.naturalWidth; height=preview.naturalHeight;
                    if (mode==='blank' && (width!==state.blank.width || height!==state.blank.height)) throw Error('Edited blank dimensions disagree; refusing to crop');
                } else {
                    if (mode==='image') throw Error('Choose an image');
                    if (!validSize(width,height)) throw Error('Dimensions must be multiples of 8, up to 4096');
                    const canvas=document.createElement('canvas'); canvas.width=width; canvas.height=height;
                    const ctx=canvas.getContext('2d'); ctx.fillStyle='white'; ctx.fillRect(0,0,width,height);
                    preview.src=canvas.toDataURL(); await preview.decode();
                }
                if (removed || token!==epoch) return;
                if (!validSize(width,height)) throw Error('Image dimensions must be multiples of 8, up to 4096');
                mutate(()=>{widget('width').value=width; widget('height').value=height;});
                showImage(node,preview,ref);
                publish(node,{version:1,width,height,source:mode,revision:get('revision'),image_ref:bridge || null,ready:true});
                report(`${width} x ${height} — ready`);
            } catch(error) {if (token===epoch && !removed) report(error);}
        }
        const schedule=()=>{
            if (quiet || removed || queued) return;
            epoch++; queued=true;
            pending=Promise.resolve().then(()=>{queued=false; return refresh();});
        };
        for (const name of ['source','width','height','preset','image']) observeValue(widget(name),schedule);
        for (const name of ['source_state','revision']) {
            widget(name).hidden=true;
            widget(name).type='hidden'; widget(name).computeSize=()=>[0,-4];
        }
        async function receive(file) {
            try {
                await pending; initialize();
                const path=await upload(file,`vrp-${randomUUID()}-${file.name}`);
                if (removed) return;
                mutate(()=>{state.image.ref=path; widget('source').value='image'; persist();});
                schedule(); await pending;
            } catch(error) {report(error);}
        }
        installDrop(node,receive);
        node.addWidget('button','Choose image','',()=>{
            const input=document.createElement('input'); input.type='file'; input.accept='image/*';
            input.onchange=()=>{if(input.files[0]) return receive(input.files[0]);}; input.click();
        },{serialize:false});
        node.addWidget('button','Edit canvas in Mask Editor','',async()=>{
            try {
                await pending;
                if (!node.vrpCanvasState?.ready) throw Error('Wait for a valid canvas preview');
                if (!bridge) {
                    const token=epoch;
                    // Never draw node.imgs into a smaller canvas: create active blank pixels.
                    const canvas=document.createElement('canvas'); canvas.width=state.blank.width; canvas.height=state.blank.height;
                    const ctx=canvas.getContext('2d'); ctx.fillStyle='white'; ctx.fillRect(0,0,canvas.width,canvas.height);
                    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
                    const path=await upload(blob,`vrp-blank-${randomUUID()}.png`);
                    if (removed || token!==epoch) return;
                    widget('image').value=path; await pending;
                }
                if (node.vrpCanvasState?.ready) openEditor(node);
            } catch(error) {report(error);}
        },{serialize:false});
        const configured=node.onConfigure;
        node.onConfigure=function(...args) {state=undefined; configured?.apply(this,args); schedule();};
        const previous=node.onRemoved;
        node.onRemoved=function(...args) {removed=true; epoch++; previous?.apply(this,args);};
        // Initial nodeCreated may precede graph attachment; onAdded is the fallback.
        const added=node.onAdded;
        node.onAdded=function(...args) {added?.apply(this,args); schedule();};
        schedule(); node.setSize([360,560]);
    },
});
