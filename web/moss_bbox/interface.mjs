// Pure MOSS socket migrations. Saved links follow their named sockets.
export const MOSS_NODE_ID='MOSSVisualRegionalPromptExperimental';
export const MOSS_INPUTS=[
    ['canvas','VRP_CANVAS'],['regions','VRP_REGIONS'],
    ['global_positive','STRING'],['negative_prompt','STRING'],['clip','CLIP'],
];
export const MOSS_OUTPUTS=[
    ['moss_prompt_json','STRING'],['combined_prompt','STRING'],
    ['positive','CONDITIONING'],['negative','CONDITIONING'],
];

export function migrateMossInputs(graph){
    if(!graph||!Array.isArray(graph.nodes)||!Array.isArray(graph.links))return;
    const maps=new Map(),names=new Set(MOSS_INPUTS.map(([name])=>name));
    for(const node of graph.nodes){
        if(node.type!==MOSS_NODE_ID||!Array.isArray(node.inputs))continue;
        const old=node.inputs;
        node.inputs=[...MOSS_INPUTS.map(([name,type])=>old.find(input=>input.name===name)??{name,type,link:null}),
            ...old.filter(input=>!names.has(input.name))];
        maps.set(String(node.id),new Map(old.map((input,index)=>[index,node.inputs.indexOf(input)])));
    }
    for(const link of graph.links){
        const array=Array.isArray(link),mapping=maps.get(String(array?link[3]:link.target_id));
        const slot=mapping?.get(array?link[4]:link.target_slot);
        if(slot===undefined)continue;
        if(array)link[4]=slot;else link.target_slot=slot;
    }
}

export function migrateMossInterface(graph){
    migrateMossInputs(graph);
    migrateMossOutputs(graph);
}

export function migrateMossOutputs(graph){
    if(!graph||!Array.isArray(graph.nodes)||!Array.isArray(graph.links))return;
    const maps=new Map(),removed=new Set();
    for(const node of graph.nodes){
        if(node.type!==MOSS_NODE_ID||!node.outputs?.some(o=>o.name==='conversion_report'))continue;
        const old=node.outputs;
        maps.set(String(node.id),new Map(old.map((o,index)=>[index,MOSS_OUTPUTS.findIndex(([name])=>name===o.name)])));
        node.outputs=MOSS_OUTPUTS.map(([name,type],slot)=>({
            ...(old.find(o=>o.name===name)??{}),name,type,slot_index:slot,
            links:old.find(o=>o.name===name)?.links??null,
        }));
    }
    if(!maps.size)return;
    graph.links=graph.links.filter(link=>{
        const array=Array.isArray(link),id=array?link[0]:link.id;
        const mapping=maps.get(String(array?link[1]:link.origin_id));
        if(!mapping)return true;
        const slot=mapping.get(array?link[2]:link.origin_slot);
        if(slot===undefined||slot<0){removed.add(id);return false;}
        if(array)link[2]=slot;else link.origin_slot=slot;
        return true;
    });
    for(const node of graph.nodes){
        let disconnected=false;
        for(const input of node.inputs??[]){
            if(removed.has(input.link)){input.link=null;disconnected=true;}
        }
        // Keep obsolete report previews visible for inspection, but do not let
        // a now-unconnected required source prevent queueing the old example.
        if(disconnected&&node.type==='PreviewAny'&&!(node.inputs??[]).some(i=>i.link!=null))node.mode=2;
    }
}
