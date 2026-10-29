// Installed by moss_bbox_entry.js. Existing Anima nodes are
// never selected by this extension. All classic-host APIs arrive through bridge.
import {emptyState,readState,inside,hitRegion,transformBox,draftBox} from './geometry.mjs';
import {migrateMossInterface,MOSS_NODE_ID} from './interface.mjs';

export const NODE_ID=MOSS_NODE_ID;
export function installMossEditor(app,bridge){
    app.registerExtension({name:'LuCiD.MOSS.BBox.Experimental',beforeConfigureGraph:migrateMossInterface,nodeCreated(node){
        if((node.comfyClass??node.type)===NODE_ID)attachMossEditor(node,bridge);
    }});
}

export function attachMossEditor(node,b){
    const widget=name=>node.widgets?.find(w=>w.name===name),source=widget('vrp_state');
    if(!source || node.mossEditor)return;
    let state=emptyState(),error='',quiet=false,removed=false,drag=null,draft=null,executed=null;
    let selected=null,editing=null;
    const dirty=()=>node.graph?.setDirtyCanvas(true,true);
    const selectedRegion=()=>state.regions.find(r=>r.id===selected);
    const set=(name,value)=>{
        const field=widget(name);if(!field)return;
        const old=quiet;quiet=true;try{if(field.value!==value)field.value=value;}finally{quiet=old;}
    };
    const dimensions=()=>b.linkedCanvas(node)?.state??state.canvas;
    const snapshot=()=>{
        const c=b.linkedCanvas(node)?.state;
        return {regions:b.inputSignature(node,'regions'),threshold:widget('mask_threshold')?.value,
            canvas:c?{width:c.width,height:c.height,revision:c.revision,image_ref:c.image_ref??null,
                source_id:c.alignment?.source_id??null}:null};
    };
    const runtime=()=>executed && JSON.stringify(executed.signature)===JSON.stringify(snapshot())?executed.preview:null;
    const rectangle=()=>{
        const c=dimensions(),width=Math.max(100,(node.size?.[0]??420)-12);
        return {x:6,y:editor.last_y??0,width,height:width*c.height/c.width};
    };
    const maskCache=new WeakMap();
    const liveMaskBounds=mask=>{
        const threshold=Number(widget('mask_threshold')?.value??.5);
        const cached=maskCache.get(mask);if(cached?.threshold===threshold)return cached.bounds;
        const pixels=mask.getContext('2d',{willReadFrequently:true}).getImageData(0,0,mask.width,mask.height).data;
        let x0=mask.width,y0=mask.height,x1=-1,y1=-1;
        for(let y=0;y<mask.height;y++)for(let x=0;x<mask.width;x++)if(pixels[(y*mask.width+x)*4+3]/255>threshold){
            x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);
        }
        const bounds=x1<0?null:{x:x0/mask.width,y:y0/mask.height,width:(x1+1-x0)/mask.width,height:(y1+1-y0)/mask.height};
        maskCache.set(mask,{threshold,bounds});return bounds;
    };
    const incoming=()=>{
        const preview=runtime(),authored=b.collectAuthoredRegions(node);
        const known=authored.map(r=>{
            let bounds=null,status=r.issue?.text??'Incoming region',level=r.issue?.level??'info';
            if(!r.inactive&&r.weight>0){
                const compiled=preview?.regions.find(p=>p.source==='chain'&&p.region_id===r.region_id);
                if(compiled){bounds=compiled.bounds;status='Converted bbox';level='ok';}
                else if(r.mode==='BBox'&&r.bbox){bounds=r.bbox;status='Authored bbox; export uses mask grid';}
                else if(r.mode==='Painted Mask'&&r.mask){
                    try{bounds=liveMaskBounds(r.mask);status=bounds?'Mask bounds preview; export uses mask grid':'No mask coverage above threshold';level=bounds?'info':'error';}
                    catch{status='Mask preview unavailable';level='warning';}
                }else if(r.mode==='External MASK'){status='MASK bounds require execution; known boxes remain editable';level='warning';}
            }
            return {id:r.region_id,label:r.label,bounds,node:r.node,external:true,inactive:r.inactive||r.weight===0,status,level};
        });
        if(!authored.length&&preview)known.push(...preview.regions.filter(r=>r.source==='chain').map(r=>({
            id:r.region_id,label:r.label,bounds:r.bounds,external:true,status:'Converted bbox',level:'ok'})));
        return known;
    };
    const rows=()=>[...state.regions.map(r=>({id:r.id,label:r.label,status:r.weight===0?'Disabled':'Object',
        inactive:r.weight===0,external:false,level:'ok'})),...incoming()];
    const refresh=()=>{
        const r=selectedRegion();set('region_label',r?.label??'');
        const prompt=widget('region_prompt');
        if(prompt&&document.activeElement!==prompt.element)set('region_prompt',r?.prompt??'');
        set('region_enabled',r?.weight!==0);
        for(const name of ['region_label','region_prompt','region_enabled','Delete selected region'])b.setWidgetVisible(widget(name),!!r&&!error);
        node.vrpSelectedRegion=selected;node.vrpRefreshList?.();b.fitVisibleWidgets(node);
    };
    const save=()=>{
        if(error||removed)return;
        state=readState(state);const serialized=JSON.stringify(state);
        if(source.value!==serialized){set('vrp_state',serialized);node.graph?.incrementVersion?.();}
        refresh();dirty();
    };
    const commitPrompt=()=>{
        const r=state.regions.find(r=>r.id===editing),p=widget('region_prompt');
        if(r&&p&&p.mossRegion===editing&&document.activeElement===p.element)r.prompt=p.element.value;
    };
    const select=id=>{
        if(error)return;
        commitPrompt();selected=id;editing=id;
        node.properties??={};
        if(node.properties.mossSelectedRegion!==id){node.properties.mossSelectedRegion=id;node.graph?.incrementVersion?.();}
        const p=widget('region_prompt');if(p){p.element.blur();p.mossRegion=id;set('region_prompt',selectedRegion()?.prompt??'');}
        save();
    };
    const syncDimensions=()=>{
        const c=b.linkedCanvas(node)?.state;
        if(!error&&c&&(state.canvas.width!==c.width||state.canvas.height!==c.height)){
            state.canvas={width:c.width,height:c.height};save();
        }
        dirty();
    };
    const adopt=value=>{
        if(quiet||removed)return;
        const oldQuiet=quiet;quiet=true;
        try{widget('region_prompt')?.element.blur();}finally{quiet=oldQuiet;}
        try{state=readState(value);error='';}
        catch(e){error=e.message;state=emptyState();}
        drag=null;draft=null;
        const preferred=node.properties?.mossSelectedRegion??selected;
        selected=state.regions.some(r=>r.id===preferred)?preferred:state.regions[0]?.id??null;editing=selected;
        if(widget('region_prompt'))widget('region_prompt').mossRegion=editing;
        refresh();dirty();
    };
    const messages=()=>{
        const list=[],c=b.linkedCanvas(node)?.state;
        if(error)list.push({level:'error',text:`Saved bbox state preserved: ${error}`});
        if(!c)list.push({level:'warning',text:'Connect a ready VRP Canvas for live bbox authoring'});
        else if(c.width%16||c.height%16)list.push({level:'error',text:'MOSS requires Canvas dimensions divisible by 16'});
        if(node.inputs?.find(i=>i.name==='regions')?.link!=null&&!runtime())list.push({level:'info',text:'Incoming authored previews are live; converted mask boxes refresh on execution'});
        if(runtime()&&executed.report)list.push({level:'info',text:executed.report});
        if(!list.length)list.push({level:'ok',text:'MOSS layout editor ready · draw a box or Add region'});
        return list;
    };
    source.hidden=true;source.computeSize=()=>[0,-4];source.computeLayoutSize=()=>({minHeight:0,maxHeight:0});
    if(source.element)source.element.style.display='none';
    const editor=node.addWidget('custom','moss_bbox_editor',null,()=>{},{serialize:false});editor.serialize=false;
    editor.computeSize=()=>[0,rectangle().height];
    const drawBox=(ctx,rect,r,bounds,external=false)=>{
        if(!bounds)return;
        const box={x:rect.x+bounds.x*rect.width,y:rect.y+bounds.y*rect.height,width:bounds.width*rect.width,height:bounds.height*rect.height};
        const chosen=r.id===selected,color=r.inactive?'#888':b.regionColor(r.id);
        ctx.strokeStyle=chosen?'#fff':color;ctx.fillStyle=color+'33';ctx.lineWidth=chosen?3:2;
        ctx.setLineDash?.(external?[5,3]:[]);ctx.fillRect(box.x,box.y,box.width,box.height);ctx.strokeRect(box.x,box.y,box.width,box.height);
        ctx.setLineDash?.([]);ctx.fillStyle=chosen?'#fff':color;ctx.font='11px sans-serif';ctx.textAlign='left';ctx.textBaseline='top';ctx.fillText(r.label,box.x+4,box.y+3);
        if(chosen&&!external)for(const [x,y] of [[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height]])ctx.fillRect(x-3,y-3,6,6);
    };
    editor.draw=ctx=>{
        const rect=rectangle(),linked=b.linkedCanvas(node);ctx.save();
        ctx.fillStyle='#242424';ctx.fillRect(rect.x,rect.y,rect.width,rect.height);
        if(linked?.image)ctx.drawImage(linked.image,rect.x,rect.y,rect.width,rect.height);
        for(const r of state.regions)drawBox(ctx,rect,{...r,inactive:r.weight===0},drag?.original?.id===r.id&&drag.preview?drag.preview:r);
        for(const r of incoming())if(!r.inactive)drawBox(ctx,rect,r,r.bounds,true);
        if(draft)b.drawBBoxDraft(ctx,{x:rect.x+draft.x*rect.width,y:rect.y+draft.y*rect.height,width:draft.width*rect.width,height:draft.height*rect.height});
        ctx.restore();refresh();
    };
    editor.onClick=()=>{};
    editor.mouse=(event,pos)=>{
        if(removed||error)return false;
        const rect=rectangle(),[x,y]=pos;
        if(['mousedown','pointerdown'].includes(event.type)){
            if(event.button!==0||!inside(rect,x,y)||!b.linkedCanvas(node))return false;
            const hit=hitRegion(state.regions,rect,x,y);
            if(hit){select(state.regions[hit.index].id);drag={...hit,original:{...state.regions[hit.index]},x,y};}
            else drag={kind:'draw',x,y};
            return true;
        }
        if(['mousemove','pointermove'].includes(event.type)&&drag){
            if(drag.kind==='draw')draft=draftBox(rect,drag.x,drag.y,x,y);
            else drag.preview=transformBox(drag.original,drag.kind,drag.edges,(x-drag.x)/rect.width,(y-drag.y)/rect.height);
            dirty();return true;
        }
        if(['mouseup','pointerup'].includes(event.type)&&drag){
            if(drag.kind==='draw'){
                draft=draftBox(rect,drag.x,drag.y,x,y);
                if(draft.width*rect.width>=6&&draft.height*rect.height>=6)add(draft);
            }else{
                // Pointer previews are derived state. Autosave/queue preparation
                // must retain the committed box until the gesture completes.
                const region=state.regions.find(r=>r.id===drag.original.id);
                if(region){
                    const bounds=transformBox(drag.original,drag.kind,drag.edges,(x-drag.x)/rect.width,(y-drag.y)/rect.height);
                    for(const key of ['x','y','width','height'])region[key]=bounds[key];
                    save();
                }
            }
            drag=null;draft=null;dirty();return true;
        }
        if(['pointercancel','mouseleave'].includes(event.type)&&drag){
            drag=null;draft=null;dirty();return true;
        }
        return false;
    };
    b.addStatusWidget(node,messages,true);
    node.vrpRefreshList=b.addRegionList(node,rows,select,owner=>{
        // The native DOM-widget click selects its containing node after the
        // button handler. Locate must run after that host selection completes.
        setTimeout(()=>{if(!removed)b.locateNode(owner);},0);
    }).vrpRefresh;
    const add=bounds=>{
        if(error||removed)return;
        commitPrompt();const used=new Set(rows().map(r=>r.id));let n=1;
        while(used.has(`moss-region-${n}`))n++;
        const id=`moss-region-${n}`;
        state.regions.push({id,label:`Region ${n}`,...bounds,prompt:'',negative_prompt:'',weight:1});select(id);
    };
    node.addWidget('button','Add region','',()=>add({x:.25,y:.25,width:.5,height:.5}),{serialize:false});
    node.addWidget('button','Delete selected region','',()=>{
        if(error)return;const index=state.regions.findIndex(r=>r.id===selected);if(index<0)return;
        commitPrompt();state.regions.splice(index,1);select(state.regions[index]?.id??state.regions[index-1]?.id??null);
    },{serialize:false});
    node.addWidget('text','region_label','',value=>{
        if(quiet||error)return;const r=selectedRegion();if(r){r.label=String(value).trim()||'Region';save();}
    },{serialize:false});
    const prompt=b.addPromptWidget(node,'region_prompt',value=>{
        const r=state.regions.find(r=>r.id===editing);
        if(!quiet&&!error&&r&&prompt.mossRegion===editing&&document.activeElement===prompt.element&&prompt.element.value===String(value)){
            r.prompt=String(value);save();
        }
    },'Selected region description (MOSS item caption)');
    prompt.element.addEventListener('focus',()=>{prompt.mossRegion=editing;});
    node.addWidget('toggle','region_enabled',true,value=>{
        if(quiet||error)return;const r=selectedRegion();if(r){r.weight=value?1:0;save();}
    },{serialize:false});
    // These are selected-region views/actions, never backend input values.
    // Native hosts do not all infer widget.serialize from options.serialize.
    for(const name of ['Add region','Delete selected region','region_label','region_enabled']){
        const field=widget(name);field.serialize=false;field.options??={};field.options.serialize=false;
    }
    const prepare=()=>{if(!error){commitPrompt();syncDimensions();save();}return source.value;};
    node.mossEditor={get state(){return structuredClone(state);},get error(){return error;},messages,rows,select,prepare};
    b.observeValue(source,()=>{adopt(source.value);syncDimensions();});
    const configured=node.onConfigure;
    node.onConfigure=function(info,...args){
        const restored=b.configuredWidgetValue(this,info,'vrp_state');configured?.call(this,info,...args);
        const negative=widget('global_negative');
        if(negative&&(info?.widgets_values_named||Array.isArray(info?.widgets_values))){
            // Old prototype workflows serialized transient selected-view fields
            // after the original two backend widgets. Do not interpret those
            // positions as the newly added global negative text.
            const named=info.widgets_values_named;
            const value=named&&Object.hasOwn(named,'global_negative')?named.global_negative:
                !named&&info.widgets_values?.length===3?info.widgets_values[2]:'';
            set('global_negative',typeof value==='string'?value:'');
        }
        const old=quiet;quiet=true;try{prompt.element.blur();if(restored)set('vrp_state',restored.value);}finally{quiet=old;}
        adopt(restored?restored.value:source.value);executed=null;syncDimensions();
    };
    const serialize=node.onSerialize;
    node.onSerialize=function(info,...args){
        const result=serialize?.call(this,info,...args);b.writeSerializedWidgetValue(this,info,'vrp_state',prepare());
        if(widget('global_negative'))b.writeSerializedWidgetValue(this,info,'global_negative',widget('global_negative').value);
        return result;
    };
    const queued=source.beforeQueued;
    source.beforeQueued=function(...args){queued?.apply(this,args);prepare();};source.serializeValue=prepare;
    b.trackQueuedPreview(node,snapshot);
    const onExecuted=node.onExecuted;
    node.onExecuted=function(message,...args){
        const result=onExecuted?.call(this,message,...args),payload=message?.ui??message;
        const preview=payload?.moss_layout_preview?.[0];
        if(preview)executed={preview,signature:b.queuedPreviewProvenance(message),report:payload.moss_conversion_report?.[0]??''};
        refresh();dirty();return result;
    };
    const changed=node.onConnectionsChange;
    node.onConnectionsChange=function(...args){const result=changed?.apply(this,args);syncDimensions();return result;};
    const onCanvas=()=>{if(!removed)syncDimensions();};b.canvasEvents.addEventListener('canvas-changed',onCanvas);
    const onRemoved=node.onRemoved;
    node.onRemoved=function(...args){removed=true;b.canvasEvents.removeEventListener('canvas-changed',onCanvas);return onRemoved?.apply(this,args);};
    adopt(source.value);syncDimensions();
    node.setSize?.([420,650]);b.fitVisibleWidgets(node);
    b.attachMossPresentation?.(node,b);
}
