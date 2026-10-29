// Shared classic UI only. Neither colors nor status mutate regional geometry.
const DEFAULT_COLORS = {
    ok:{background:'#294536',text:'#d5eddd'}, info:{background:'#303f50',text:'#dee7ef'},
    warning:{background:'#57452b',text:'#f5e4bf'}, error:{background:'#582f3b',text:'#f8e1e7'},
};
const uiOptions = node => ({list_height:160,row_height:30,status_padding:5,font_size:12,...node.vrpUserConfig?.ui});
const statusColor = (node,level) => (node.vrpUserConfig?.status_colors || DEFAULT_COLORS)[level] || DEFAULT_COLORS.info;

export function installUserConfig(nodeType, nodeData, inputName) {
    nodeType.prototype.vrpUserConfig = nodeData.input?.required?.[inputName]?.[1]?.vrp_config;
}

export function regionColor(id) {
    let hash = 2166136261;
    for (const character of String(id)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    // A full hue range avoids frequent collisions from a six-color palette,
    // while preserving the color when a region is renamed/reordered/bypassed.
    const hue=(hash>>>0)%360, chroma=.68, offset=.22;
    const x=chroma*(1-Math.abs((hue/60)%2-1));
    const rgb=[[chroma,x,0],[x,chroma,0],[0,chroma,x],[0,x,chroma],[x,0,chroma],[chroma,0,x]][Math.floor(hue/60)];
    return '#'+rgb.map(value=>Math.round((value+offset)*255).toString(16).padStart(2,'0')).join('');
}

export function setWidgetVisible(widget, visible) {
    if (!widget) return false;
    // A controller may expose selected fields, but a presentation-owned source
    // value must remain hidden behind its DOM control (never leak at slot y=0).
    visible = visible && !widget.vrpPresentationHidden;
    const changed=widget.hidden!==!visible;
    if (!widget.vrpOriginalLayout) widget.vrpOriginalLayout = {
        computeSize: widget.computeSize, computeLayoutSize: widget.computeLayoutSize,
    };
    widget.hidden = !visible;
    if (widget.element) widget.element.style.display = visible ? '' : 'none';
    widget.computeSize = visible ? widget.vrpOriginalLayout.computeSize : () => [0, -4];
    widget.computeLayoutSize = visible ? widget.vrpOriginalLayout.computeLayoutSize : () => ({minHeight:0,maxHeight:0});
    return changed;
}

// Creation feedback only: a dark outer outline plus bright dashed inner line
// remains readable over white, dark and colored images. Geometry is untouched.
export function drawBBoxDraft(ctx, draft) {
    ctx.save();
    ctx.fillStyle = '#68cce822'; ctx.fillRect(draft.x,draft.y,draft.width,draft.height);
    ctx.setLineDash?.([]); ctx.strokeStyle = '#172630'; ctx.lineWidth = 4;
    ctx.strokeRect(draft.x,draft.y,draft.width,draft.height);
    ctx.strokeStyle = '#a7edff'; ctx.lineWidth = 2; ctx.setLineDash?.([5,4]);
    ctx.strokeRect(draft.x,draft.y,draft.width,draft.height);
    ctx.restore();
}

export function addStatusWidget(node, getMessages, multiple=false) {
    let expanded = false;
    const messages = () => getMessages().filter(Boolean);
    const widget = node.addWidget('custom', 'vrp_status', null, () => {}, {serialize:false});
    widget.serialize=false;
    const sizing=uiOptions(node), rowHeight=sizing.font_size*2+2*sizing.status_padding;
    widget.computeSize = () => {
        const count = Math.max(1, messages().length);
        return [0, multiple ? 24 + Math.min(expanded ? count : 3, count) * (rowHeight+2) + (count > 3 ? 24 : 0) : rowHeight+6];
    };
    widget.draw = ctx => {
        const rows = messages();
        if (!rows.length) rows.push({level:'ok',text:'Status: OK'});
        const width = Math.max(100, node.size[0]-24), y = widget.last_y ?? 0;
        ctx.save(); ctx.font = `${sizing.font_size}px sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        let offset = y + 5;
        if (multiple) {
            const errors = rows.filter(row=>row.level==='error').length;
            const warnings = rows.filter(row=>row.level==='warning').length;
            const level=errors?'error':warnings?'warning':rows.some(row=>row.level==='info')?'info':'ok';
            ctx.fillStyle=statusColor(node,level).background;ctx.fillRect(10,offset-2,width,20);
            ctx.fillStyle = statusColor(node,level).text;
            ctx.fillText(errors || warnings ? `Status: ${errors} error(s), ${warnings} warning(s)` : 'Status: OK', 12, offset);
            offset += 22;
        }
        const shown = multiple ? rows.slice(0, expanded ? rows.length : 3) : rows.slice(0,1);
        for (const row of shown) {
            ctx.fillStyle = statusColor(node,row.level).background; ctx.fillRect(10,offset-2,width,rowHeight);
            ctx.fillStyle = statusColor(node,row.level).text;
            // Two short wrapped lines; no overlay on the image or unbounded height.
            const words = row.text.split(/\s+/), lines = [''];
            for (const word of words) {
                const candidate = `${lines.at(-1)} ${word}`.trim();
                if ((ctx.measureText?.(candidate).width ?? candidate.length*7) > width-12 && lines.at(-1)) lines.push(word);
                else lines[lines.length-1] = candidate;
            }
            lines.slice(0,2).forEach((line,index)=>ctx.fillText(line,10+sizing.status_padding,offset+index*sizing.font_size));
            offset += rowHeight+2;
        }
        if (multiple && rows.length>3) {
            ctx.fillStyle='#404953';ctx.fillRect(10,offset-2,135,20);
            ctx.fillStyle = statusColor(node,'info').text;
            ctx.fillText(expanded ? 'Show less' : `Show more (${rows.length-3})`,15,offset);
        }
        ctx.restore();
    };
    widget.mouse = (event,pos) => {
        if (!['mousedown','pointerdown'].includes(event.type) || event.button>0 || !multiple || messages().length<=3) return false;
        if (pos[1] < (widget.last_y ?? 0)+widget.computeSize()[1]-24) return false;
        expanded=!expanded; node.vrpFitWidgets?.();node.graph?.setDirtyCanvas(true,true); return true;
    };
    // Concrete custom widgets receive onClick, not necessarily legacy mouse.
    widget.onClick=({e,canvas})=>widget.mouse({type:'pointerdown',button:e.button},[
        canvas.graph_mouse[0]-(node.pos?.[0]||0),canvas.graph_mouse[1]-(node.pos?.[1]||0),
    ]);
    return widget;
}

export function addRegionList(node, getRows, select, locate) {
    const sizing=uiOptions(node), container=document.createElement('div');
    container.className='anima-vrp-region-list';container.setAttribute('aria-label','Regions');
    Object.assign(container.style,{overflowY:'auto',overscrollBehavior:'contain',padding:'4px',
        boxSizing:'border-box',position:'relative',background:'#242424',fontSize:`${sizing.font_size}px`,lineHeight:'1.4',userSelect:'none'});
    // Let the browser scroll normally, but do not forward to graph zoom/pan.
    container.addEventListener('wheel',event=>event.stopPropagation(),{passive:true});
    container.addEventListener('pointerdown',event=>event.stopPropagation());
    const rowHeight=Math.max(sizing.row_height,Math.ceil(sizing.font_size*1.4)+10);
    // Allocate the DOM widget's 10px inset on both sides as well as list
    // padding/gaps. A small configured cap must not clip the third full row.
    const rowSpace=count=>count*rowHeight+Math.max(0,count-1)*2+8;
    const height=()=>20+Math.min(Math.max(sizing.list_height,rowSpace(3)),rowSpace(Math.max(1,getRows().length)));
    const widget=node.addDOMWidget('selection','vrp-region-list',container,{serialize:false,
        margin:10,getValue:()=>'',setValue:()=>{},getMinHeight:height,getMaxHeight:height,getHeight:height});
    widget.serialize=false;
    const entries=new Map();let signature='',selection;
    const refresh=()=>{
        const rows=getRows();
        const next=JSON.stringify(rows.map(row=>[row.id,row.label,row.external,row.status,row.level,row.inactive,!!row.node]));
        if(next!==signature){
            signature=next;const scroll=container.scrollTop;container.replaceChildren();entries.clear();
            if(!rows.length){const empty=document.createElement('div');empty.textContent='No regions — Add region or connect a Region chain';container.append(empty);}
            for(const row of rows){
                const line=document.createElement('div'), button=document.createElement('button'),swatch=document.createElement('span'),text=document.createElement('span');
                Object.assign(line.style,{display:'flex',gap:'5px',marginBottom:row===rows.at(-1)?'0':'2px',height:`${rowHeight}px`,minHeight:`${rowHeight}px`,boxSizing:'border-box'});
                Object.assign(button.style,{display:'flex',alignItems:'center',gap:'6px',flex:'1',minWidth:'0',
                    textAlign:'left',border:'1px solid transparent',borderRadius:'4px',padding:'4px 6px',cursor:'pointer',font:'inherit',lineHeight:'inherit',height:'100%',boxSizing:'border-box'});
                button.type='button';button.title=`${row.label} · ${row.external?'External':'Internal'} · ${row.status}`;
                Object.assign(swatch.style,{background:row.inactive?'#888':regionColor(row.id),width:'10px',height:'12px',flexShrink:'0'});
                text.textContent=button.title;Object.assign(text.style,{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'});
                button.append(swatch,text);button.addEventListener('click',()=>{select(row.id);refresh();node.graph?.setDirtyCanvas(true,true);});
                const background=row.inactive?'#333':statusColor(node,row.level).background;
                button.style.background=background;button.style.color=row.inactive?'#bbb':statusColor(node,row.level).text;
                button.addEventListener('mouseenter',()=>{button.style.filter='brightness(1.2)';});
                button.addEventListener('mouseleave',()=>{button.style.filter='';});
                line.append(button);
                if(row.node){
                    const jump=document.createElement('button');jump.type='button';jump.textContent='Locate';jump.title=`Locate ${row.label}`;
                    Object.assign(jump.style,{background:'#3e4b59',color:'#edf2f8',border:'1px solid #64768a',borderRadius:'4px',padding:'4px 8px',cursor:'pointer',font:'inherit',lineHeight:'inherit',height:'100%',boxSizing:'border-box'});
                    jump.addEventListener('mouseenter',()=>{jump.style.filter='brightness(1.2)';});
                    jump.addEventListener('mouseleave',()=>{jump.style.filter='';});
                    jump.addEventListener('click',()=>{select(row.id);locate(row.node);refresh();});line.append(jump);
                }
                entries.set(row.id,{line,button});container.append(line);
            }
            container.scrollTop=scroll;
        }
        for(const [id,{button}] of entries){const selected=id===node.vrpSelectedRegion;
            button.style.borderColor=selected?'#d5e4f3':'transparent';button.setAttribute('aria-pressed',String(selected));}
        if(selection!==node.vrpSelectedRegion){
            selection=node.vrpSelectedRegion;
            const line=entries.get(selection)?.line;
            // Scroll only this list, never the whole ComfyUI page.
            if(line){const top=line.offsetTop,bottom=top+line.offsetHeight;
                if(top<container.scrollTop)container.scrollTop=top;
                else if(bottom>container.scrollTop+container.clientHeight)container.scrollTop=bottom-container.clientHeight;}
        }
    };
    widget.vrpRefresh=refresh;refresh();
    return widget;
}

export function tintedMask(mask, color) {
    if (!mask) return null;
    mask.vrpTints ??= new Map();
    if (!mask.vrpTints.has(color)) {
        const canvas=document.createElement('canvas');canvas.width=mask.width;canvas.height=mask.height;
        const ctx=canvas.getContext('2d');ctx.drawImage(mask,0,0);
        ctx.globalCompositeOperation='source-in';ctx.fillStyle=color;ctx.fillRect(0,0,canvas.width,canvas.height);
        mask.vrpTints.set(color,canvas);
    }
    return mask.vrpTints.get(color);
}

export function prepareRuntimeMask(node, region) {
    if(region.renderedMask || region.loadingMask || typeof Image==='undefined')return;
    region.loadingMask=true;const image=new Image();
    image.onload=()=>{
        region.loadingMask=false;
        try {
            const mask=document.createElement('canvas');mask.width=image.naturalWidth||image.width;mask.height=image.naturalHeight||image.height;
            mask.getContext('2d').drawImage(image,0,0);
            region.renderedMask=tintedMask(mask,regionColor(region.region_id));
        }catch{region.maskPreviewError=true;}
        node.graph?.setDirtyCanvas(true,true);
    };
    image.onerror=()=>{region.loadingMask=false;region.maskPreviewError=true;node.graph?.setDirtyCanvas(true,true);};
    image.src=`data:image/png;base64,${region.mask_png}`;
}
