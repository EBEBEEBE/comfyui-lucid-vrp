// User UI state only. Never include pixels, document history or workflow data.
import {sanitizeBehavior} from './canvas_v1_input.js';
export const PREFERENCES_FILE='vrp/canvas_preferences.json';
const copy=value=>structuredClone(value);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const number=(value,min,max,fallback)=>Number.isFinite(value)&&value>=min&&value<=max?value:fallback;
const color=(value,fallback)=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value.toLowerCase():fallback;
const position=value=>value&&Number.isFinite(value.x)&&Number.isFinite(value.y)?{x:Math.max(0,Math.min(1,value.x)),y:Math.max(0,Math.min(1,value.y))}:null;
const panel=value=>{value=object(value);return{floating:value.floating===true,collapsed:value.collapsed===true,position:position(value.position)};};

export function normalizePreferences(input={}){
    const data=object(input),brush=object(data.brush),mask=object(data.mask),layout=object(data.layout),transform=object(data.transform);
    const recent=Array.isArray(data.recentColors)?[...new Set(data.recentColors.map(c=>color(c,null)).filter(Boolean))].slice(0,10):[];
    return{version:1,setupSeen:data.setupSeen===true,behaviorSetupSeen:data.behaviorSetupSeen===true,behavior:sanitizeBehavior(data.behavior),
        brush:{size:Math.round(number(brush.size,1,250,26)),opacity:number(brush.opacity,0,1,1),hardness:number(brush.hardness,0,1,.85),color:color(brush.color,'#61b7dd')},
        recentColors:recent.length?recent:['#61b7dd'],mask:{color:color(mask.color,'#000000'),opacity:number(mask.opacity,0,1,.45)},transform:{snapToFrame:typeof transform.snapToFrame==='boolean'?transform.snapToFrame:true},
        layout:{orb:position(layout.orb),layers:panel(layout.layers),mask:panel(layout.mask)}};
}

// One serialized writer per host user. A failed/unknown read must never replace
// an existing file with defaults. Explicit Reset is the only repair operation.
export async function loadPreferences(transport,{debounce=400,timeout=1500}={}){
    let value=normalizePreferences(),error=null,writable=true,timer=null,dirty=false,writing=null,resetVersion=0;
    const listeners=new Set();
    function fail(message){error=message;writable=false;for(const listener of listeners)listener(message);}
    async function bounded(operation){
        const controller=new AbortController();let timer;
        try{return await Promise.race([Promise.resolve().then(()=>operation(controller.signal)),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Preference storage timed out.'));},timeout);})]);}
        finally{clearTimeout(timer);}
    }
    try{
        const saved=await bounded(signal=>transport.read(signal));
        if(saved!==null){if(!saved||typeof saved!=='object'||Array.isArray(saved)||saved.version!==1)throw Error('Unsupported preference file version.');value=normalizePreferences(saved);}
    }catch{fail('Editor preferences could not be loaded. Using session settings; Reset editor preferences can repair the saved file.');}
    async function flush(){
        clearTimeout(timer);timer=null;
        if(writing){await writing;return flush();}
        if(!dirty||!writable)return !error;
        dirty=false;const snapshot=copy(value),version=resetVersion;
        writing=(async()=>{try{await bounded(signal=>transport.write(snapshot,signal));}catch{if(version===resetVersion)fail('Editor preferences could not be saved. Your image edits are unaffected; settings remain available for this session.');}})();
        await writing;writing=null;if(dirty&&writable)return flush();return !error;
    }
    function schedule(){dirty=true;clearTimeout(timer);timer=setTimeout(()=>{void flush();},debounce);}
    return{
        get value(){return copy(value);},get error(){return error;},
        subscribeError(listener){listeners.add(listener);if(error)listener(error);return()=>listeners.delete(listener);},
        patch(patch){
            // Merge only the known shallow groups; normalize every field before
            // it can reach controls or disk. Return a copy to prevent mutation.
            const next=normalizePreferences({...value,...patch,brush:{...value.brush,...patch.brush},mask:{...value.mask,...patch.mask},transform:{...value.transform,...patch.transform},layout:{...value.layout,...patch.layout},behavior:{...value.behavior,...patch.behavior,shortcuts:{...value.behavior.shortcuts,...patch.behavior?.shortcuts}}});
            if(JSON.stringify(next)===JSON.stringify(value))return copy(value);value=next;
            schedule();return copy(value);
        },
        reset(){resetVersion++;value=normalizePreferences({setupSeen:true,behaviorSetupSeen:true});error=null;writable=true;schedule();return copy(value);},
        resetBehavior(){value=normalizePreferences({...value,behavior:{},behaviorSetupSeen:true});schedule();return copy(value);},flush,
    };
}
