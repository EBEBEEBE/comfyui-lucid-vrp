// Small editor-local binding table. No graph, DOM or browser-policy dependency.
export const BINDINGS={brush:['Brush','B'],eraser:['Eraser','E'],move:['Transform','V'],fill:['Fill','G'],pick:['Eyedropper','I'],
    mask:['Toggle mask','M'],quick:['Summon quick brush','F'],color:['Color panel','C'],add:['New paint layer','Shift+N'],
    smaller:['Smaller brush','['],larger:['Larger brush',']'],softer:['Softer brush','Shift+['],harder:['Harder brush','Shift+]'],
    above:['Select layer above','PageUp'],below:['Select layer below','PageDown']};
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
export function canonicalBinding(value){
    if(value==='')return '';
    if(typeof value!=='string')return null;
    const match=/^(Shift\+)?([a-z]|\[|\]|PageUp|PageDown|Home|End|Insert|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/i.exec(value.trim());
    if(!match)return null;
    const names=['PageUp','PageDown','Home','End','Insert','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
    return(match[1]?'Shift+':'')+(names.find(n=>n.toLowerCase()===match[2].toLowerCase())??match[2].toUpperCase());
}
export function sanitizeBehavior(value){
    const data=plain(value),result={};
    if(['classic','lucid','menu'].includes(data.rightButton))result.rightButton=data.rightButton;
    if(['alt','q','off'].includes(data.temporaryPicker))result.temporaryPicker=data.temporaryPicker;
    const shortcuts={};for(const [id,binding] of Object.entries(plain(data.shortcuts)))if(Object.hasOwn(BINDINGS,id)&&canonicalBinding(binding)!==null)shortcuts[id]=canonicalBinding(binding);
    if(Object.keys(shortcuts).length)result.shortcuts=shortcuts;return result;
}
export function resolveBehavior(defaults={},overrides={}){
    const base=sanitizeBehavior(defaults),user=sanitizeBehavior(overrides),selected={...base.shortcuts,...user.shortcuts};
    const result={rightButton:user.rightButton??base.rightButton??'lucid',temporaryPicker:user.temporaryPicker??base.temporaryPicker??'alt',shortcuts:Object.fromEntries(Object.entries(BINDINGS).map(([id,[,key]])=>[id,key]))};
    Object.assign(result.shortcuts,selected);
    // Invalid/conflicting overrides fall back without stealing a working default.
    for(let pass=0;pass<=Object.keys(BINDINGS).length;pass++){
        let changed=false;const used=new Map();
        for(const [id,key] of Object.entries(result.shortcuts)){
            if(!key)continue;
            if((result.temporaryPicker==='q'&&['Q','Shift+Q'].includes(key))||used.has(key)){
                const ids=used.has(key)?[used.get(key),id]:[id];for(const conflict of ids)if(Object.hasOwn(selected,conflict)){delete selected[conflict];changed=true;}
            }else used.set(key,id);
        }
        if(!changed)break;
        result.shortcuts=Object.fromEntries(Object.entries(BINDINGS).map(([id,[,key]])=>[id,selected[id]??key]));
    }
    return result;
}
export function bindingIssue(id,value,behavior){
    const key=canonicalBinding(value);if(key===null)return 'Use a letter, bracket or navigation key, optionally with Shift. Space, numbers, Escape and Undo/Redo are reserved.';
    if(!key)return null;
    if(behavior.temporaryPicker==='q'&&['Q','Shift+Q'].includes(key))return 'Q is reserved for the held color picker.';
    const other=Object.keys(BINDINGS).find(action=>action!==id&&behavior.shortcuts[action]===key);
    return other?`Already used by ${BINDINGS[other][0]}. Clear that binding first.`:null;
}
export function eventBinding(event){
    if(event.ctrlKey||event.metaKey||event.altKey||event.isComposing||event.getModifierState?.('AltGraph'))return null;
    const key=/^Key[A-Z]$/.test(event.code)?event.code.slice(3):event.code==='BracketLeft'?'[':event.code==='BracketRight'?']':event.code;
    return canonicalBinding((event.shiftKey?'Shift+':'')+key);
}
