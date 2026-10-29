// Same shared action panels, selected fields and sizing used by Anima VRP UI.
// The editor/controller owns state; this layer owns only widget presentation.
export function attachMossPresentation(node,b){
    const widget=name=>node.widgets.find(w=>w.name===name),suppressed=new Set(),panels=[];
    let ordering=[],removed=false;
    const layout=b.installClassicLayout(node,()=>ordering,suppressed);
    // Retired/foreign Anima controls must never acquire a MOSS presentation.
    for(const name of ['vrp_state','Add region','Delete selected region','prompt_mix','Global prompt processing']){
        const w=widget(name);if(!w)continue;suppressed.add(w);w.vrpPresentationHidden=true;b.setWidgetVisible(w,false);
    }
    const selected=()=>node.mossEditor.state.regions.some(r=>r.id===node.vrpSelectedRegion);
    const actions=b.actionPanel(node,'Region actions',[
        {label:'Add region',icon:'add',run:()=>widget('Add region').callback(),unavailable:()=>node.mossEditor.error},
        {label:'Delete region',icon:'delete',danger:true,run:()=>widget('Delete selected region').callback(),
            unavailable:()=>selected()?'':'Select an internal region; incoming regions belong to their Region nodes'},
    ]);panels.push(actions);
    const fields=layout.addRow('Selected region',[
        {name:'region_label',label:'Name',minWidth:150,grow:1},
        {name:'region_enabled',label:'Include region',kind:'toggle',inline:true,minWidth:120,grow:0},
    ],selected,()=>node.vrpSelectedRegion);
    const threshold=layout.addRow('Mask to bbox',[
        {name:'mask_threshold',label:'Mask threshold',kind:'number',minWidth:180},
    ]);
    ordering=[widget('moss_bbox_editor'),widget('vrp_status'),widget('selection'),actions.widget,
        fields,widget('region_prompt'),widget('global_negative'),threshold];
    const negative=widget('global_negative');
    if(negative?.element){
        negative.element.title='Negative prompt fallback; connected negative_prompt input takes precedence';
        negative.element.placeholder='Negative prompt (optional local text)';
    }
    const sizing=b.installContentSizing(node,[420,650],380);
    const refresh=()=>{
        if(removed)return;
        // Native configure/recreation or another extension can reset hidden.
        // Keep canonical storage and replaced buttons presentation-owned, just
        // as the existing VRP UI does, without touching their serialized values.
        for(const w of suppressed)b.setWidgetVisible(w,false);
        if(negative){
            const connected=node.inputs?.some(i=>i.name==='negative_prompt'&&i.link!=null)??false;
            negative.disabled=connected;if(negative.element)negative.element.disabled=connected;
        }
        layout.refresh();panels.forEach(p=>p.refresh());b.fitVisibleWidgets(node);
    };
    const draw=node.onDrawForeground;
    node.onDrawForeground=function(...args){const result=draw?.apply(this,args);refresh();return result;};
    const configure=node.onConfigure;
    node.onConfigure=function(info,...args){const result=configure?.call(this,info,...args);refresh();sizing.restore(info?.size);return result;};
    const previous=node.onRemoved;
    node.onRemoved=function(...args){
        removed=true;panels.forEach(p=>p.dispose());layout.dispose();sizing.dispose();
        for(const w of suppressed)delete w.vrpPresentationHidden;
        return previous?.apply(this,args);
    };
    node.mossPresentation={refresh};refresh();
}
