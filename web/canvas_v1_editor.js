// Opt-in editor preview. Importing this module does not register a ComfyUI extension.
import * as model from './canvas_v1_document.js';
import * as geometry from './canvas_v1_geometry.js';
import {createDocumentHistory} from './canvas_v1_history.js';
import {createCanvasRenderer} from './canvas_v1_renderer.js';
import {drawLayer,drawDocumentRaster} from './canvas_v1_layer_render.js';
import {raster,emptyMask,createRasterStroke,alphaBounds,morphCoverage,floodCoverage,applyTileCoverage} from './canvas_v1_raster.js';
import {hexHSV,hsvHex} from './canvas_v1_color.js';
import {icon} from './canvas_v1_icons.js';
import {TileRaster,isTiled,residentBytes,drawSource} from './canvas_v1_tiles.js';
import {BINDINGS,resolveBehavior,eventBinding,bindingIssue} from './canvas_v1_input.js';
import {moveLayerObject} from './canvas_v1_layer_order.js';

const TOOLS=[['brush','B','✎','Brush'],['eraser','E','▱','Eraser'],['move','V','↗','Transform'],
    ['fill','G','▨','Fill connected area'],['pick','I','⌖','Sample visible color']];
const MENU_ICONS={quick:'brush',transform:'move','scale-all':'move',duplicate:'duplicate',delete:'delete',
    up:'up',down:'down','flip-x':'flip-x','flip-y':'flip-y','rotate-cw':'rotate-cw','rotate-ccw':'rotate-ccw',
    undo:'undo',redo:'redo',add:'add',import:'import','mask-grow':'add','mask-shrink':'minus','mask-invert':'invert','mask-clear':'delete'};
const SHORTCUTS=[['Brush / Eraser / Transform','B / E / V'],['Fill / Eyedropper','G / I'],['Toggle mask','M'],
    ['Summon quick brush / Color','F / C'],['New paint layer','Shift N'],['Undo / Redo','Ctrl/⌘ Z / Shift Z'],
    ['Brush size','[ / ]'],['Brush hardness','Shift [ / ]'],['Brush opacity','1–9, 0 = 100%'],
    ['Select layer above / below','Page Up / Down'],['Pan canvas','Space + drag / middle drag / Hand'],
    ['Zoom / adjust hovered control','Wheel'],['Context menu','Right click / Shift F10'],['Accept / discard transform','Enter / Escape'],['Cancel current gesture / close popup','Escape']];
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const uid=()=>crypto.randomUUID();
const htmlEscape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const equalPixels=(a,b)=>{const x=a.getContext('2d').getImageData(0,0,a.width,a.height).data,
    y=b.getContext('2d').getImageData(0,0,b.width,b.height).data;return x.every((v,i)=>v===y[i]);};
const verticalControl=(key,label,min,max,value)=>`<label for="${key}-range">${label}</label><input id="${key}-range" data-brush="${key}" type="range" min="${min}" max="${max}" value="${value}" aria-label="Brush ${key}" title="Wheel to adjust ${key}"><input data-brush="${key}" type="number" min="${min}" max="${max}" value="${value}" aria-label="Brush ${key} value">`;
const helpMark=(label,text)=>`<button class="help-mark" type="button" aria-label="${label}: ${text}" title="${text}">?</button>`;
const layerToggle=(item,kind)=>{
    const visibility=kind==='visibility',pressed=visibility?item.visible:item.locked;
    const action=visibility?(pressed?'Hide':'Show'):(pressed?'Unlock':'Lock');
    const symbol=visibility?(pressed?'eye':'eye-off'):(pressed?'lock':'unlock');
    return `<button type="button" class="layer-toggle" data-${kind}="${htmlEscape(item.id)}" aria-label="${visibility?'Visibility':'Lock'}: ${htmlEscape(item.name)}" aria-pressed="${pressed}" title="${action} ${visibility?'':item.type==='image'?'transform: ':'paint: '}${htmlEscape(item.name)}">${icon(symbol)}</button>`;
};

export async function mountCanvasEditor(host,{initialDocument,initialAssets=new Map(),backgroundId=null,
    onApply=async()=>{},onCancel=()=>{},memoryBudget=192*1024*1024,preview=true,forceCpu=false,preferences=null,behaviorDefaults={}}={}) {
    if(!Number.isFinite(memoryBudget)||memoryBudget<=0)throw Error('Raster budget must be positive and finite.');
    const root=host.attachShadow({mode:'open'});
    root.innerHTML=`<link rel="stylesheet" href="${new URL('./canvas_v1_editor.css',import.meta.url)}">
    <section class="editor" aria-label="LuCiD canvas editor">
      <header class="header"><span class="brand">LuCiD <span class="badge">CANVAS${preview?' · PREVIEW':''}</span></span>
        <button class="mode" data-action="mask" aria-pressed="false" title="Toggle independent mask (M)">Mask</button>
        <span class="state muted" data-state>Saved</span><span class="spacer"></span>
        <button data-action="undo" title="Undo (Ctrl/⌘ Z)">${icon('undo')}<span>Undo</span></button><button data-action="redo" title="Redo (Ctrl/⌘ Shift Z)">↷</button>
        <button class="reset" data-action="reset-panels">Reset panels</button><button data-action="preferences" title="Editor preferences" aria-label="Editor preferences">${icon('settings')}</button><button data-action="help" title="Shortcuts">?</button>
        <button data-action="cancel">Cancel</button><button class="primary" data-action="apply">Apply</button>
      </header>
      <div class="stage">
        <div class="viewport" tabindex="0" aria-label="Canvas. Brush B, eraser E, transform V; Space and drag to pan."><canvas></canvas></div>
        ${['left','right','top','bottom'].map(edge=>`<div class="frame-snap-guide" data-frame-snap-guide="${edge}" aria-hidden="true" hidden></div>`).join('')}
        <nav class="tools" aria-label="Tools">${TOOLS.map(([id,key,,label])=>`<button data-tool="${id}" title="${label} (${key})" aria-label="${label}" aria-pressed="false">${icon(id)}</button>`).join('')}</nav>
        <button class="brush-orb" data-action="brush-settings" aria-label="Quick brush controls" title="Quick brush · drag anywhere · F to summon at pointer">${icon('brush')}</button>
        <div class="brush-rail">${[['size','SIZE',1,250,26],['opacity','OPACITY',0,100,100]].map(([id,label,min,max,value])=>`<div class="rail-control" data-brush-unit="${id}">${verticalControl(id,label,min,max,value)}${id==='size'?`<div class="hardness-reveal"><button class="hardness-handle" aria-label="Show brush hardness" aria-expanded="false" aria-controls="hardness-flyout">›</button><div class="rail-control hardness-flyout" id="hardness-flyout" data-brush-unit="hardness">${verticalControl('hardness','HARDNESS',0,100,85)}</div></div>`:'<span class="opacity-preview" aria-label="Brush opacity preview"><span class="opacity-ink"></span></span>'}</div>`).join('')}</div>
        <div class="zoom"><button data-action="hand" aria-label="Hand: pan canvas" aria-pressed="false" title="Pan with left drag; toggle off to resume the current tool">${icon('hand')}</button><button data-action="zoom-out" aria-label="Zoom out">−</button><span data-zoom></span><button data-action="zoom-in" aria-label="Zoom in">+</button><button data-action="fit">Fit</button><button class="whole-transform" data-action="scale-all" title="Move, scale or rotate the whole composition, including locked layers, inside the fixed output frame">${icon('move')}<span>Transform Whole Image</span></button></div>
        <div class="color-dock"><button class="color-button" data-action="color" title="Color picker (C)"><span class="swatch"></span><span class="color-caption">COLOR</span></button><div class="mini-history" aria-label="Recent colors"></div></div>
        <div class="panel" data-floating="false"><div class="panel-head"><strong data-panel-title>Layers</strong><button data-action="dock" title="Dock or float panel">Float</button><button data-action="collapse" aria-label="Collapse panel">−</button></div><div class="panel-body"></div></div>
        <div class="transform-bar" hidden role="toolbar" aria-label="Transform" tabindex="-1">
          <div class="transform-row"><select data-transform-target aria-label="Transform target"><option value="layer">Layer</option><option value="all">All content</option></select><label data-include-mask hidden><input data-group-mask type="checkbox">Include mask</label><button data-action="distort" aria-pressed="false" title="Bilinear four-corner distortion · drag corners; geometry stays editable">${icon('distort')}<span>Distort</span></button><button data-action="reset-corners" title="Remove distortion while keeping placement" hidden>Reset corners</button><button data-action="flip-x" title="Flip horizontally" aria-label="Flip horizontally">${icon('flip-x')}</button><button data-action="flip-y" title="Flip vertically" aria-label="Flip vertically">${icon('flip-y')}</button><button data-action="rotate-ccw" title="Rotate 90° counterclockwise" aria-label="Rotate 90° counterclockwise">${icon('rotate-ccw')}<span>90°</span></button><button data-action="rotate-cw" title="Rotate 90° clockwise" aria-label="Rotate 90° clockwise">${icon('rotate-cw')}<span>90°</span></button><button data-action="exact-scale" title="Enter an exact scale percentage">Scale…</button></div>
          <div class="transform-row"><label title="Keep proportions; hold Shift to override"><input type="checkbox" data-aspect checked>Keep Aspect Ratio</label><button data-action="reset-transform" title="Reset position, scale, rotation and distortion. Crop is unchanged.">Reset Geometry</button><button class="discard" data-action="discard-transform" title="Discard this transform round (Escape)">Discard</button><button class="done" data-action="done" title="Accept this transform round (Enter)">Accept</button></div>
          <div class="transform-reminder" role="status"><div>Accept or discard the current transform to continue.</div></div>
        </div>
        <div class="fill-bar" role="toolbar" aria-label="Fill settings" hidden><span class="fill-heading">${icon('fill')}Fill</span><label class="fill-threshold">Threshold <input data-fill-threshold type="range" min="0" max="255" value="30" aria-label="Fill threshold"><input data-fill-threshold type="number" min="0" max="255" value="30" aria-label="Fill threshold value"></label><label class="fill-through"><input data-fill-through type="checkbox">Fill through</label>${helpMark('Fill settings help','Threshold: 0 matches exactly; higher values accept larger color differences. Fill through samples the visible composite. Otherwise sample the active layer, or the mask in Mask mode. Only the active layer or mask is painted.')}</div>
        <aside class="first-use" hidden aria-label="Editor setup"><strong>Choose how you work</strong><p>Choose right-button behavior and keyboard shortcuts, or start with the defaults. Change them anytime with the gear button.</p><div><button data-action="use-defaults">Use defaults</button><button data-action="configure" class="primary">Configure</button></div></aside>
        <div class="layer-drop-line" hidden><span></span></div><div class="layer-drag-label" hidden role="status"></div><div class="popover" hidden></div><div class="context-menu" role="menu" aria-label="Canvas actions" hidden></div><div class="cursor"></div><div class="notice" hidden role="status"></div><div class="busy" hidden role="status"></div>
        <div class="closed" hidden><div class="closed-card"><strong data-closed-title>Changes applied</strong><span class="hint">${preview?'This standalone preview keeps the committed document in memory.':'Changes are saved to this loader.'}</span><button data-action="reopen">Reopen canvas</button></div></div>
        <input data-import type="file" accept="image/png,image/jpeg,image/webp" multiple hidden>
      </div>
      <footer class="footer"><span data-mode-label>IMAGE</span><span data-dimensions></span><span class="message">Drop an image to add a layer. Document dimensions belong to the loader.</span><span data-memory></span></footer>
    </section>`;
    const $=selector=>root.querySelector(selector),$$=selector=>[...root.querySelectorAll(selector)];
    await new Promise((resolve,reject)=>{const link=$('link');link.onload=resolve;link.onerror=()=>reject(Error('Editor stylesheet could not load'));if(link.sheet)resolve();});
    let committed=model.parseDocument(initialDocument),history=createDocumentHistory(committed),selected=committed.layers.at(-1)?.id;
    const assets=new Map(initialAssets),bytes=source=>(source.naturalWidth??source.width)*(source.naturalHeight??source.height)*4;
    for(const item of committed.layers)if(item.type==='paint'&&item.asset_ref&&!isTiled(assets.get(item.asset_ref)))assets.set(item.asset_ref,TileRaster.from(assets.get(item.asset_ref)));
    if(committed.mask.asset_ref)assets.set(committed.mask.asset_ref,TileRaster.from(assets.get(committed.mask.asset_ref),{mask:true}));
    const workingBudget=Math.min(memoryBudget,64*1024*1024);
    const remembered=preferences?.value;
    let behaviorOverrides=remembered?.behavior??{},behavior=resolveBehavior(behaviorDefaults,behaviorOverrides),pickerHeld=false,sampleSerial=0,samplePoint=null,sampleRunning=false,pickerGesture=false;
    let sampledComposite=null,sampledRevision=null,pointerInside=false;
    let tool='brush',maskMode=false,maskView=true,maskAlpha=remembered?.mask.opacity??.45,maskColor=remembered?.mask.color??'#000000',closed=false,busy=false,epoch=0;
    let fillThreshold=30,fillThrough=false;
    let brush={size:26,opacity:1,hardness:.85,tip:'round',color:'#61b7dd',...remembered?.brush},zoom=1,pan={x:0,y:0},space=false;
    let gesture=null,draft=null,popup=null,cache=null,cacheKey='',frame=0,renderVersion=0,drawEpoch=0,noticeTimer,applyController=null;
    let floating=false,panelPosition={x:0,y:0},opacityBefore=null,disposed=false;
    let groupBase=null,groupMatrix=[...geometry.IDENTITY],groupIncludeMask=false,groupMaskSurface=null;
    let distortMode=false,cropMode=false,snapToFrame=remembered?.transform?.snapToFrame??true;
    let transformRound=null,handMode=false;
    const renderer=createCanvasRenderer({forceCpu});let lastWarpDraw=0,renderTimer=null;
    const releasePreview=()=>{cache?.bitmap?.close();cache?.maskBitmap?.close();cache=null;cacheKey='';};
    let orbPosition={x:88,y:76},summonedOrb=null,popupAnchor=null,lastPointer=null,orbDrag=null,suppressOrbClick=false;
    let dismissedPointer=null,suppressDismissClick=false;
    let colorHistory=remembered?.recentColors??['#61b7dd'],pickerHue=hexHSV(brush.color).h,pickerDrag=false;
    let layouts=remembered?.layout??{orb:null,layers:{floating:false,collapsed:false,position:null},mask:{floating:false,collapsed:false,position:null}};
    let wheelMorph=null,morphTimer=null,morphStep=3,morphWheelRemainder=0,lastMorphWheel=0,contextRequest=null,suppressContextUntil=0,menuAnchor=null,menuLayerId=null;
    let rowDrag=null,dropTarget=null,dragScroll=0,dragPointer=null;
    const stage=$('.stage'),viewport=$('.viewport'),view=$('.viewport canvas'),ctx=view.getContext('2d'),panel=$('.panel');
    $('[data-action=distort]').insertAdjacentHTML('afterend',`<button data-action="crop" aria-pressed="false" title="Edit a reversible crop with four corner handles">${icon('crop')}<span>Crop</span></button><button data-action="reset-crop" hidden>Reset crop</button>`);
    $('[data-transform-target]').insertAdjacentHTML('afterend',`<button data-action="detach-child" hidden title="Detach the paint overlay and select it for independent transformation">Detach Child</button>`);
    $('[data-aspect]').closest('label').insertAdjacentHTML('afterend','<label title="Snap moving transform bounds to the four frame edges within 6 screen pixels. Corner scaling, rotation, Crop and Distort handles stay free."><input data-snap-frame type="checkbox">Snap to frame</label>');
    const doc=()=>draft||history.current;
    const layer=(value=doc())=>value.layers.find(item=>item.id===selected);
    const target=(value=doc())=>model.objectRoot(value,layer(value));
    const displayLayers=value=>value.layers.filter(l=>!l.parent_id).reverse().flatMap(item=>[item,...(model.overlayFor(value,item.id)?[model.overlayFor(value,item.id)]:[])]);
    const source=ref=>{if(!assets.has(ref))throw Error(`Missing canvas asset: ${ref}`);return assets.get(ref);};
    function notify(message,error=false){if(disposed)return;$('.notice').textContent=message;$('.notice').classList.toggle('error',error);$('.notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('.notice').hidden=true,4200);}
    function reportError(error){
        if(error.lockedLayerId){const button=$(`[data-lock="${CSS.escape(error.lockedLayerId)}"]`),row=button?.closest('.layer'),list=row?.closest('.layers');
            if(button&&list){panel.classList.remove('collapsed');clampPanel();const a=row.getBoundingClientRect(),b=list.getBoundingClientRect();if(a.top<b.top)list.scrollTop-=b.top-a.top;else if(a.bottom>b.bottom)list.scrollTop+=a.bottom-b.bottom;
                for(const animation of button.getAnimations())if(animation.id==='lock-blocked')animation.cancel();const motion=matchMedia('(prefers-reduced-motion: reduce)').matches?0:6;
                const animation=button.animate([{transform:'translateX(0)',filter:'brightness(1)',boxShadow:'0 0 0 0 #ffc26b00'},{transform:`translateX(${-motion}px)`,filter:'brightness(2)',boxShadow:'0 0 0 3px #ffc26b'},{transform:`translateX(${motion}px)`,filter:'brightness(.7)',boxShadow:'0 0 0 0 #ffc26b00'},{transform:`translateX(${-motion}px)`,filter:'brightness(2)',boxShadow:'0 0 0 3px #ffc26b'},{transform:'translateX(0)',filter:'brightness(1)',boxShadow:'0 0 0 0 #ffc26b00'}],{duration:650,iterations:2});animation.id='lock-blocked';
            }
        }notify(error.message,true);
    }
    function attempt(fn){try{const result=fn();if(result?.catch)result.catch(reportError);}catch(error){reportError(error);}}
    const blocked=()=>closed||busy||disposed;
    function rememberBrush(){preferences?.patch({brush:{size:brush.size,opacity:brush.opacity,hardness:brush.hardness,color:brush.color},recentColors:colorHistory});}
    function rememberMask(){preferences?.patch({mask:{color:maskColor,opacity:maskAlpha}});}
    const panelKey=()=>maskMode?'mask':'layers';
    const relative=(point,width,height)=>({x:clamp((point.x-8)/Math.max(1,width-16),0,1),y:clamp((point.y-8)/Math.max(1,height-16),0,1)});
    const absolute=(point,width,height)=>({x:8+point.x*Math.max(1,width-16),y:8+point.y*Math.max(1,height-16)});
    function rememberOrb(){layouts.orb=relative(orbPosition,stage.clientWidth-44,stage.clientHeight-44);preferences?.patch({layout:{orb:layouts.orb}});}
    function rememberPanel(){const state={floating,collapsed:panel.classList.contains('collapsed'),position:floating?relative(panelPosition,stage.clientWidth-panel.offsetWidth,stage.clientHeight-panel.offsetHeight):layouts[panelKey()].position};layouts[panelKey()]=state;preferences?.patch({layout:{[panelKey()]:state}});}
    function restoreLayout({orb=false}={}){
        const state=layouts[panelKey()];floating=state.floating;panel.dataset.floating=String(floating);panel.classList.toggle('collapsed',state.collapsed);$('[data-action=dock]').textContent=floating?'Dock':'Float';
        panel.style.left='';panel.style.top='';panel.style.right='';panel.style.bottom='';fitPanelHeight();
        if(floating){panelPosition=state.position?absolute(state.position,stage.clientWidth-panel.offsetWidth,stage.clientHeight-panel.offsetHeight):{x:Math.max(8,stage.clientWidth-panel.offsetWidth-15),y:15};}
        if(orb&&!summonedOrb)orbPosition=layouts.orb?absolute(layouts.orb,stage.clientWidth-44,stage.clientHeight-44):{x:88,y:76};clampPanel();
    }
    function finishSetup(){preferences?.patch({setupSeen:true,behaviorSetupSeen:true});$('.first-use').hidden=true;}
    function updateBehavior(patch){
        behaviorOverrides={...behaviorOverrides,...patch,shortcuts:{...behaviorOverrides.shortcuts,...patch.shortcuts}};behavior=resolveBehavior(behaviorDefaults,behaviorOverrides);
        clearTemporaryPicker();preferences?.patch({behavior:behaviorOverrides});syncShortcutLabels();
    }
    function syncShortcutLabels(){
        for(const [id,,,label] of TOOLS)$(`[data-tool=${id}]`).title=`${label}${behavior.shortcuts[id]?' ('+behavior.shortcuts[id]+')':''}`;
        $('[data-action=mask]').title=`Toggle independent mask (${behavior.shortcuts.mask||'unbound'})`;
        $('[data-action=color]').title=`Color picker (${behavior.shortcuts.color||'unbound'})`;
        $('.brush-orb').title=`Quick brush · drag anywhere · ${behavior.shortcuts.quick||'Unbound'} to summon`;
        viewport.setAttribute('aria-label',`Canvas. Brush ${behavior.shortcuts.brush||'unbound'}, eraser ${behavior.shortcuts.eraser||'unbound'}, transform ${behavior.shortcuts.move||'unbound'}; Space and drag to pan.`);
    }
    function behaviorMarkup(){return `<div class="preferences-settings"><fieldset><legend>Mouse</legend><label>Right mouse button<select data-right-button aria-label="Right mouse button behavior">${[['lucid','LuCiD · menu / drag to erase'],['classic','Classic · erase only'],['menu','Menu only · no erasing']].map(([id,name])=>`<option value="${id}" ${behavior.rightButton===id?'selected':''}>${name}</option>`).join('')}</select></label><p class="hint" data-right-help>${rightButtonHelp()}</p></fieldset><fieldset><legend>Keyboard</legend><label>Hold to pick color<select data-held-picker aria-label="Temporary color picker key">${[['alt','Alt'],['q','Q'],['off','Off']].map(([id,name])=>`<option value="${id}" ${behavior.temporaryPicker===id?'selected':''}>${name}</option>`).join('')}</select></label><p class="hint">RGB paint tools only. If your browser intercepts Alt, choose Q. Click a binding and press a key; Backspace clears it. Shift is supported. Space, number opacity keys, Escape and Undo/Redo keep their usual actions.</p><details class="shortcut-config"><summary>Customize shortcuts</summary><div class="binding-list">${Object.entries(BINDINGS).map(([id,[label]])=>`<label>${label}<button data-binding="${id}" title="Click then press a key. Backspace clears." aria-label="Shortcut: ${label}">${htmlEscape(behavior.shortcuts[id]||'Unbound')}</button></label>`).join('')}</div></details><p class="binding-status hint" role="status" data-binding-status></p></fieldset>${preferences?.error?`<p class="hint preference-error">${htmlEscape(preferences.error)}</p>`:''}<div class="preferences-actions"><button data-action="reset-behavior">Reset behavior / shortcuts</button><details><summary>Reset utilities</summary><button data-action="reset-panels">Reset panels</button><button data-action="reset-preferences">Reset remembered state</button></details></div></div>`;}
    function rightButtonHelp(){return behavior.rightButton==='lucid'?'In the canvas: right-click for actions; drag 3 pixels to erase. Applies to Image and Mask. Panel menus stay unchanged.':behavior.rightButton==='classic'?'In the canvas: hold the right button to erase. Canvas actions remain available with Shift F10. Panel menus stay unchanged.':'In the canvas: right-click for actions. The right button never erases. Panel menus stay unchanged.';}
    function resetPreferences(){
        const keptBehavior=behaviorOverrides,defaults=preferences?.reset();preferences?.patch({behavior:keptBehavior});brush={...brush,...(defaults?.brush??{size:26,opacity:1,hardness:.85,color:'#61b7dd'})};colorHistory=defaults?.recentColors??['#61b7dd'];maskColor='#000000';maskAlpha=.45;pickerHue=hexHSV(brush.color).h;
        snapToFrame=defaults?.transform?.snapToFrame??true;layouts=defaults?.layout??{orb:null,layers:{floating:false,collapsed:false,position:null},mask:{floating:false,collapsed:false,position:null}};finishSetup();refresh();restoreLayout({orb:true});syncColorUI({historyChanged:true});closePopup();notify('Editor preferences reset. Image and mask pixels are unchanged.');
    }
    function beginTransform(){
        if(!transformRound)transformRound={checkpoint:history.checkpoint(),selected,previousTool:tool==='move'?'brush':tool};
        handMode=false;tool='move';
    }
    function transformChanged(){return !!transformRound?.checkpoint.changed();}
    function remindTransform(){
        const bar=$('.transform-bar');bar.classList.add('needs-decision');
        for(const button of [$("[data-action=done]"),$("[data-action=discard-transform]")]){
            if(button.getAnimations().some(animation=>animation.id==='transform-decision'&&animation.playState==='running'))continue;
            const motion=matchMedia('(prefers-reduced-motion: reduce)').matches?0:4;
            const animation=button.animate([{translate:'0',filter:'brightness(1)'},{translate:`${-motion}px`,filter:'brightness(1.8)'},{translate:`${motion}px`,filter:'brightness(1.8)'},{translate:'0',filter:'brightness(1)'}],{duration:260});
            animation.id='transform-decision';
        }
    }
    function finishTransform(discard=false,{preservePanel=false}={}){
        if(!transformRound)return;
        const round=transformRound;cancelGesture();closePopup();closeContext();
        if(discard){round.checkpoint.restore();selected=round.selected;}
        transformRound=null;exitGroup();cropMode=false;distortMode=false;handMode=false;tool=round.previousTool;
        $('.transform-bar').classList.remove('needs-decision');collect();refresh({preservePanel});viewport.focus({preventScroll:true});
    }
    function leaveTransform(){
        if(!transformRound)return true;
        if(transformChanged()){remindTransform();return false;}
        // A clean exit can happen during a slider press or native layer drag.
        // Keep that live DOM target until its initiating action has completed.
        finishTransform(false,{preservePanel:true});return true;
    }
    function setTool(next){
        if(maskMode&&['move','pick'].includes(next))return;
        if(next===tool){handMode=false;refresh();return;}
        if(!leaveTransform())return;
        clearTemporaryPicker();closePopup();exitGroup();handMode=false;
        if(next==='move')beginTransform();else tool=next;
        refresh();
    }
    function selectLayer(id){
        if(id===selected)return true;
        if(!leaveTransform())return false;
        exitGroup();selected=id;refresh();return true;
    }
    // UI-only controls and history navigation do not resolve a pending round.
    function allowAction(action,button){
        if(!transformRound||button?.closest('.transform-bar'))return true;
        const safe=['done','discard-transform','cancel','undo','redo','hand','fit','zoom-in','zoom-out','collapse','dock','reset-panels',
            'preferences','configure','use-defaults','reset-preferences','reset-behavior','help','brush-settings','quick','color','close-popup'];
        if(safe.includes(action)||action==='scale-confirm'&&popup==='scale')return true;
        return leaveTransform();
    }
    function essentialRefs(value){return new Set([...model.assetReferences(committed),...model.assetReferences(value),...(groupBase?model.assetReferences(groupBase):[]),...(transformRound?.checkpoint.assetReferences??[])]);}
    const totalBytes=refs=>residentBytes([...refs].map(source));
    function collect(){
        const keep=new Set([...essentialRefs(history.current),...history.retainedAssetReferences]);
        while(totalBytes(keep)>memoryBudget&&history.discardOldest()){
            keep.clear();for(const ref of [...essentialRefs(history.current),...history.retainedAssetReferences])keep.add(ref);
        }
        for(const [ref] of assets)if(!keep.has(ref))assets.delete(ref);
        $('[data-memory]').textContent=`${(totalBytes(keep)/1048576).toFixed(1)} MiB retained`;
        $('[data-memory]').title=`Document ${(totalBytes(model.assetReferences(history.current))/1048576).toFixed(1)} MiB · source/history limit ${memoryBudget/1048576} MiB · stroke working limit ${workingBudget/1048576} MiB`;
    }
    function commit(value,{groupEdit=false}={}){
        const required=totalBytes(essentialRefs(value));if(required>memoryBudget)throw Error(`Document source budget: ${(required/1048576).toFixed(1)} MiB required; ${(memoryBudget/1048576).toFixed(1)} MiB available.`);
        const changed=history.commit(value);draft=null;if(changed){if(groupBase&&!groupEdit){groupBase=history.current;groupMatrix=[...geometry.IDENTITY];}collect();refresh();}return changed;
    }
    function commitRaster(surface,{mask=maskMode,id=selected,paintState=null,base=history.current}={}){
        const previous=mask?base.mask.asset_ref:base.layers.find(l=>l.id===id)?.asset_ref,prior=previous?source(previous):null;
        const snapshot=isTiled(surface)?surface.fork():TileRaster.from(surface,{mask,base:isTiled(prior)?prior:null});
        if(!snapshot.tiles.size){const changed=commit(mask?model.setMaskReference(base,null):model.replaceLayerAsset(base,id,null));if(changed&&!mask){selected=id;refresh();}return changed;}
        const ref=`memory:${uid()}`;assets.set(ref,snapshot);
        try{const changed=commit(mask?model.setMaskReference(base,ref):paintState?model.replacePaintRaster(base,id,{asset_ref:ref,...paintState}):model.replaceLayerAsset(base,id,ref));if(!mask&&changed){selected=id;refresh();}return changed;}
        catch(error){assets.delete(ref);throw error;}
    }
    function syncSnapGuides(){
        const edges=gesture?.kind==='move'&&snapToFrame?gesture.snapEdges??[]:[],a=toView({x:0,y:0}),b=toView({x:committed.width,y:committed.height});
        $$('[data-frame-snap-guide]').forEach(guide=>{const edge=guide.dataset.frameSnapGuide;guide.hidden=!edges.includes(edge);if(guide.hidden)return;const vertical=edge==='left'||edge==='right';guide.style.left=`${(edge==='right'?b.x:a.x)-(vertical?1:0)}px`;guide.style.top=`${(edge==='bottom'?b.y:a.y)-(vertical?0:1)}px`;guide.style.width=`${vertical?2:b.x-a.x}px`;guide.style.height=`${vertical?b.y-a.y:2}px`;});
    }
    function invalidate(){syncSnapGuides();cacheKey='';renderVersion++;schedule();}
    function refresh({preservePanel=false}={}){
        if(!history.current.layers.some(item=>item.id===selected))selected=history.current.layers.at(-1)?.id;
        $('[data-action=undo]').disabled=!history.canUndo||blocked();$('[data-action=redo]').disabled=!history.canRedo||blocked();
        $('[data-action=apply]').disabled=!history.dirty||blocked();$('[data-state]').textContent=history.dirty?'Unsaved edits':'Saved';
        $('[data-state]').classList.toggle('dirty',history.dirty);$('[data-action=mask]').setAttribute('aria-pressed',maskMode);
        $('[data-mode-label]').textContent=maskMode?'MASK':'IMAGE';$('[data-mode-label]').classList.toggle('mask',maskMode);
        $('[data-dimensions]').textContent=`${committed.width} × ${committed.height} · fixed frame`;
        $$('.tools button').forEach(button=>{button.setAttribute('aria-pressed',button.dataset.tool===tool);button.hidden=maskMode&&['move','pick'].includes(button.dataset.tool);});
        $('.color-dock').hidden=maskMode;
        $('.transform-bar').hidden=tool!=='move'||maskMode||(!layer()&&!groupBase);
        if(!transformChanged())$('.transform-bar').classList.remove('needs-decision');
        $('[data-action=hand]').setAttribute('aria-pressed',handMode);viewport.classList.toggle('panning',handMode||space||gesture?.kind==='pan');
        $('.fill-bar').hidden=tool!=='fill';$('[data-fill-through]').checked=fillThrough;
        $('.transform-bar').dataset.all=String(!!groupBase);$('[data-transform-target]').value=groupBase?'all':'layer';$('[data-include-mask]').hidden=!groupBase;$('[data-group-mask]').checked=groupIncludeMask;
        $('[data-action=distort]').hidden=!!groupBase;$('[data-action=distort]').disabled=!target()||target().locked;
        $('[data-action=distort]').setAttribute('aria-pressed',!groupBase&&distortMode);
        $('[data-action=crop]').hidden=!!groupBase;$('[data-action=crop]').disabled=!target()||target().locked;$('[data-action=crop]').setAttribute('aria-pressed',!groupBase&&cropMode);
        $('[data-action=reset-crop]').hidden=!!groupBase||!target()?.crop;$('[data-action=reset-crop]').disabled=!!target()?.locked;
        $('[data-aspect]').closest('label').hidden=!groupBase&&(distortMode||cropMode);
        $('[data-action=reset-corners]').hidden=!!groupBase||!target()?.warp;
        $('[data-action=reset-corners]').disabled=!!target()?.locked;
        const child=model.overlayFor(doc(),target()?.id),paired=!!child;
        $('[data-transform-target] option[value=layer]').textContent=paired?'Image + overlay':'Layer';
        $('[data-snap-frame]').checked=snapToFrame;
        $('[data-transform-target]').title=paired?'Image and paint overlay share geometry. Dashed bounds in Crop/Distort show retained content; their handles edit the shared crop or distortion. Detach paint to transform it independently.':'Transform the selected layer, or all content inside the fixed frame.';
        $('[data-action=reset-transform]').title=groupBase?'Reset the collective move, scale and rotation. Individual layer geometry and Crop are unchanged.':'Reset position, scale, rotation and distortion. Crop is unchanged.';
        const detach=$('[data-action=detach-child]'),locked=[];
        if(child?.locked)locked.push(`paint "${child.name}"`);
        detach.hidden=!!groupBase||!child;detach.disabled=!!locked.length;
        detach.title=locked.length?`Unlock ${locked.join(' and ')} before detaching.`:'Detach the paint overlay and select it for independent transformation';
        $('.swatch').style.background=maskMode?maskColor:brush.color;$('.color-caption').textContent=maskMode?'OVERLAY':'COLOR';
        syncBrush();
        if(!preservePanel)renderPanel();layoutRail();invalidate();
    }
    function renderPanel(){
        const active=root.activeElement;
        const list=$('.layers'),scroll=list?{top:list.scrollTop,left:list.scrollLeft,selected:list.querySelector('.selected')?.dataset.layer}:null;
        const focusAttribute=active&&panel.contains(active)?['data-layer-opacity','data-visibility','data-lock','data-layer','data-action'].find(name=>active.hasAttribute(name)):null;
        const restoreFocus=()=>{if(focusAttribute)panel.querySelector(`[${focusAttribute}="${CSS.escape(active.getAttribute(focusAttribute))}"]`)?.focus({preventScroll:true});};
        panel.dataset.mask=maskMode;$('[data-panel-title]').textContent=maskMode?'Independent mask':'Layers';
        if(maskMode){$('.panel-body').innerHTML=`<div class="mask-controls"><div class="mask-heading"><strong>Coverage</strong>${helpMark('Mask painting help','White selects; black clears. Brush adds coverage; eraser or right-drag removes it. RGB layers stay separate.')}</div>
            <label><input data-mask-view type="checkbox" ${maskView?'checked':''}>Show overlay</label><label class="mask-color">Preview color <input data-mask-color type="color" value="${maskColor}" aria-label="Mask preview color"></label><label>Overlay opacity ${helpMark('Overlay help','Overlay opacity and tint affect the preview only, not exported mask coverage.')}<input data-mask-alpha type="range" min="0" max="100" value="${maskAlpha*100}"></label>
            <div class="row"><button data-action="mask-clear">Clear</button><button data-action="mask-invert">Invert</button></div>
            <div class="mask-wheel" data-morph-wheel tabindex="0" aria-label="Wheel up to grow mask, down to shrink"><div class="mask-heading"><strong>Grow / shrink</strong>${helpMark('Grow and shrink help','Scroll up in this box to grow, down to shrink. The number sets pixels per step. A scroll burst is one Undo operation.')}</div><div class="row"><input data-morph type="number" min="1" max="16" value="${morphStep}" aria-label="Mask expansion radius"><span>px</span><button data-action="mask-grow" aria-label="Grow mask" title="Grow mask">+</button><button data-action="mask-shrink" aria-label="Shrink mask" title="Shrink mask">−</button></div></div></div>`;return;}
        const current=history.current;
        const rows=displayLayers(current);
        $('.panel-body').innerHTML=`<div class="layers">${rows.map(item=>`<div class="layer ${item.id===selected?'selected':''} ${item.parent_id?'attached':''}" data-layer="${item.id}" draggable="${item.id!==backgroundId&&!(item.type==='paint'&&item.locked)}" tabindex="0" role="button" aria-label="Select ${htmlEscape(item.name)}">${layerToggle(item,'visibility')}${layerToggle(item,'lock')}<canvas width="64" height="50"></canvas><span class="layer-name" title="Double-click to rename">${htmlEscape(item.name)}<small>${item.parent_id?'↳ Paint overlay':item.id===backgroundId?'Background':item.type==='image'?'Image':'Paint'} · ${item.width} × ${item.height}${item.crop?' · Cropped':''}</small></span>${item.type==='image'?`<button class="attachment ${model.overlayFor(current,item.id)?'active':''}" data-attachment="${item.id}" aria-label="Paint overlay for ${htmlEscape(item.name)}" title="${model.overlayFor(current,item.id)?'Select attached paint':'Paint overlay · click for actions, or drop a paint layer here'}">${icon('attach')}</button>`:''}<span class="drag-grip" aria-hidden="true" title="${item.parent_id?'Drag to a root insertion line to detach and move':'Drag to reorder'}">⠿</span></div>`).join('')}</div>
            <label class="opacity">Layer opacity <input data-layer-opacity type="range" min="0" max="100" value="${Math.round((layer()?.opacity??1)*100)}" ${!layer()||layer().type==='paint'&&layer().locked?'disabled':''}><span>${Math.round((layer()?.opacity??1)*100)}%</span></label>
            <div class="layer-actions"><button data-action="add" title="New paint layer (Shift N)" aria-label="New paint layer">+</button><button data-action="import" title="Import image at original resolution">Import</button><button data-action="duplicate" title="Duplicate layer" aria-label="Duplicate layer">${icon('duplicate')}</button><button data-action="up" title="Move layer up" aria-label="Move layer up">${icon('up')}</button><button data-action="down" title="Move layer down" aria-label="Move layer down">${icon('down')}</button><button data-action="delete" title="Delete layer" aria-label="Delete layer">${icon('delete')}</button></div>`;
        $$('.layer').forEach(row=>{const item=current.layers.find(l=>l.id===row.dataset.layer),thumb=row.querySelector('canvas'),c=thumb.getContext('2d');if(item.asset_ref){const s=source(item.asset_ref),scale=Math.min(64/s.width,50/s.height);drawSource(c,s,(64-s.width*scale)/2,(50-s.height*scale)/2,s.width*scale,s.height*scale);}});
        if(scroll){$('.layers').scrollTop=scroll.top;$('.layers').scrollLeft=scroll.left;}
        restoreFocus();
        // Explicitly changing selection (for example adding a layer) still
        // reveals that row, without scrolling the surrounding ComfyUI page.
        if(scroll&&scroll.selected!==selected){const row=$('.layer.selected');if(row){const box=$('.layers').getBoundingClientRect(),item=row.getBoundingClientRect();if(item.top<box.top)$('.layers').scrollTop+=item.top-box.top;else if(item.bottom>box.bottom)$('.layers').scrollTop+=item.bottom-box.bottom;}}
    }
    function layoutRail(){
        const h=stage.clientHeight;if(!h)return;
        const count=$$('.tools button').filter(button=>!button.hidden).length;
        stage.classList.toggle('compact-controls',h<28+count*35+(count-1)*5+10+64+140+116);
        const rail=$('.brush-rail'),size=$('#size-range'),opacity=$('#opacity-range'),box=stage.getBoundingClientRect(),tools=$('.tools').getBoundingClientRect(),zoomBox=$('.zoom').getBoundingClientRect();
        const bottom=h-(zoomBox.top-box.top)+16,overhead=rail.getBoundingClientRect().height-size.getBoundingClientRect().height-opacity.getBoundingClientRect().height;
        const available=h-(tools.bottom-box.top)-18-bottom-overhead;
        rail.style.bottom=`${bottom}px`;stage.style.setProperty('--rail-range-height',`${clamp(Math.floor(available/2),32,160)}px`);
        fitPanelHeight();
    }
    function fit(){zoom=Math.max(.04,Math.min((stage.clientWidth-170)/committed.width,(stage.clientHeight-90)/committed.height,1));pan={x:(stage.clientWidth-committed.width*zoom)/2,y:(stage.clientHeight-committed.height*zoom)/2};schedule();}
    function toDoc(event){const box=view.getBoundingClientRect();return{x:(event.clientX-box.left-pan.x)/zoom,y:(event.clientY-box.top-pan.y)/zoom};}
    const toView=p=>({x:p.x*zoom+pan.x,y:p.y*zoom+pan.y});
    function zoomAt(factor,point={x:stage.clientWidth/2,y:stage.clientHeight/2}){const before={x:(point.x-pan.x)/zoom,y:(point.y-pan.y)/zoom};zoom=clamp(zoom*factor,.04,16);pan={x:point.x-before.x*zoom,y:point.y-before.y*zoom};schedule();}
    function schedule(){if(!frame&&!disposed)frame=requestAnimationFrame(()=>{
        frame=0;
        // Bound drag work; the worker also keeps only the newest pending frame.
        const delay=gesture?.kind==='distort'?33-(performance.now()-lastWarpDraw):0;
        if(delay>0){clearTimeout(renderTimer);renderTimer=setTimeout(schedule,delay);return;}
        clearTimeout(renderTimer);lastWarpDraw=performance.now();attempt(draw);
    });}
    async function composite(value=doc()){
        return renderer.exact(value,previewSource);
    }
    const previewSource=ref=>ref==='@gesture'?gesture.stroke.raster:ref==='@group-mask'?groupMaskSurface:ref==='@morph'?wheelMorph.work:source(ref);
    async function draw(){
        if(disposed||closed)return;
        syncSnapGuides();
        const version=renderVersion,drawId=++drawEpoch,value=doc();
        const ratio=window.devicePixelRatio||1,w=stage.clientWidth,h=stage.clientHeight;
        const area={x:Math.max(0,-pan.x/zoom),y:Math.max(0,-pan.y/zoom)};
        area.width=Math.max(0,Math.min(value.width,(w-pan.x)/zoom)-area.x);area.height=Math.max(0,Math.min(value.height,(h-pan.y)/zoom)-area.y);
        const key=model.serializeDocument(value)+JSON.stringify([area,zoom,ratio,w,h,!!gesture,maskMode,maskView,maskAlpha,maskColor,gesture?.samples,renderVersion]);
        if(key!==cacheKey&&area.width&&area.height){
            const stroke=gesture?.kind==='stroke'?gesture.stroke:null,revision=stroke?.revision;
            const result=await renderer.preview(value,previewSource,{area,scale:zoom*ratio,dragging:['distort','move','scale','rotate','crop'].includes(gesture?.kind),cropEditing:tool==='move'&&cropMode&&!maskMode&&!groupBase?target()?.id:null,overlay:maskMode&&maskView?{color:maskColor,alpha:maskAlpha}:null,revision:String(version),
                patches:stroke?{'@gesture':{revision,dirtySince:after=>stroke.dirtySince(after,revision)}}:{}});
            if(!result)return;
            if(drawId!==drawEpoch||version!==renderVersion||disposed||closed){result.bitmap.close();result.maskBitmap?.close();return;}
            releasePreview();cache=result;cache.area=area;cacheKey=key;
        }
        if(view.width!==Math.round(w*ratio)||view.height!==Math.round(h*ratio)){view.width=Math.round(w*ratio);view.height=Math.round(h*ratio);}
        ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);ctx.save();ctx.translate(pan.x,pan.y);ctx.scale(zoom,zoom);
        ctx.shadowColor='#0007';ctx.shadowBlur=18/zoom;ctx.fillStyle='#fff';ctx.fillRect(0,0,value.width,value.height);ctx.shadowBlur=0;
        if(cache&&area.width&&area.height){
            const a=cache.area;ctx.drawImage(cache.bitmap,a.x,a.y,a.width,a.height);
            if(maskMode&&maskView&&cache.maskBitmap)ctx.drawImage(cache.maskBitmap,a.x,a.y,a.width,a.height);
        }
        ctx.strokeStyle='#d3e8ff99';ctx.lineWidth=1/zoom;ctx.strokeRect(0,0,value.width,value.height);ctx.restore();
        if(tool==='move'&&!maskMode&&selection())drawHandles();
        $('[data-zoom]').textContent=`${Math.round(zoom*100)}%`;
    }
    function selection(){return groupBase?{id:'@all',type:'group',width:committed.width,height:committed.height,transform:groupMatrix,locked:false}:target();}
    function objectBounds(item){
        if(groupBase||item?.type!=='image')return null;
        const child=model.overlayFor(doc(),item.id);if(!child?.asset_ref||!child.visible||!child.opacity)return null;
        // Retained source extents include paint outside the image or current crop.
        // No raster scans, resampling or geometry rebasing when selecting a tool.
        const x=Math.min(0,child.transform[4]),y=Math.min(0,child.transform[5]);
        const box={x,y,width:Math.max(item.width,child.transform[4]+child.width)-x,height:Math.max(item.height,child.transform[5]+child.height)-y};
        return item.warp?geometry.mappedRasterBounds({...item,transform:geometry.IDENTITY},box):box;
    }
    function bounds(item=selection()){
        if(!item)return null;
        if(cropMode&&!groupBase)return item.crop??{x:0,y:0,width:item.width,height:item.height};
        const object=objectBounds(item);if(object&&!(distortMode&&item.warp))return object;
        if(item.warp)return item.warp.bounds;
        if(item.crop&&!distortMode)return item.crop;
        if(item.type==='paint'&&item.asset_ref)return alphaBounds(source(item.asset_ref),item.width,item.height);
        return{x:0,y:0,width:item.width,height:item.height};
    }
    function handles(item=selection()){
        const b=bounds(item);if(!b)return[];
        if(cropMode&&!groupBase){const mapping=geometry.createLayerMapping(item);return[{x:b.x,y:b.y},{x:b.x+b.width,y:b.y},{x:b.x+b.width,y:b.y+b.height},{x:b.x,y:b.y+b.height}].map(p=>toView(mapping.forward(p)));}
        return ((distortMode||!objectBounds(item)?item.warp?.corners:null)??[{x:b.x,y:b.y},{x:b.x+b.width,y:b.y},{x:b.x+b.width,y:b.y+b.height},{x:b.x,y:b.y+b.height}]).map(p=>toView(geometry.transformPoint(item.transform,p)));
    }
    function pivotFor(item,b=bounds(item)){return item.warp&&(distortMode||!objectBounds(item))?item.warp.corners.reduce((p,q)=>({x:p.x+q.x/4,y:p.y+q.y/4}),{x:0,y:0}):{x:b.x+b.width/2,y:b.y+b.height/2};}
    function drawHandles(){const item=selection(),points=handles(item);ctx.save();
        const object=(cropMode||distortMode)&&objectBounds(item);
        if(object){const b=object,guide=[{x:b.x,y:b.y},{x:b.x+b.width,y:b.y},{x:b.x+b.width,y:b.y+b.height},{x:b.x,y:b.y+b.height}].map(p=>toView(geometry.transformPoint(item.transform,p)));ctx.strokeStyle='#d3e8ff99';ctx.lineWidth=1;ctx.setLineDash([5,5]);ctx.beginPath();guide.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.stroke();ctx.setLineDash([]);}
        ctx.strokeStyle=item.locked?'#b1b1b1':groupBase?'#c1e5aa':cropMode?'#f2d391':distortMode?'#cdb5ff':'#9fd8ff';ctx.fillStyle='#243c51';ctx.lineWidth=1.5;ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.stroke();for(const p of points){ctx.fillRect(p.x-4,p.y-4,8,8);ctx.strokeRect(p.x-4,p.y-4,8,8);}
        if(!cropMode||groupBase){const top={x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2-26};ctx.beginPath();ctx.moveTo((points[0].x+points[1].x)/2,(points[0].y+points[1].y)/2);ctx.lineTo(top.x,top.y);ctx.stroke();ctx.beginPath();ctx.arc(top.x,top.y,5,0,Math.PI*2);ctx.fill();ctx.stroke();}ctx.restore();}
    function maskSource(){return history.current.mask.asset_ref?source(history.current.mask.asset_ref):new TileRaster(committed.width,committed.height,{mask:true});}
    function paintTarget({erase=false}={}){let base=history.current,item=layer(base);if(!item)throw Error('Add a paint layer first.');const parent=model.objectRoot(base,item);if(!item.visible||!parent.visible)throw Error(`Show "${!parent.visible?parent.name:item.name}" before painting.`);
        if(item.type==='image'){let child=model.overlayFor(base,item.id);if(!child){if(item.id===backgroundId)throw Error('Background image pixels are read-only. Select a paint layer, or explicitly add or attach a paint overlay.');if(erase)return null;base=model.addOverlay(base,item.id,uid());child=model.overlayFor(base,item.id);}item=child;}
        if(item.locked)throw model.lockError(item,'paint on this layer');if(!item.visible)throw Error(`Show "${item.name}" before painting.`);return{base,item,effective:model.effectiveLayer(base,item)};
    }
    function localPaintState(base,id,state){const item=base.layers.find(l=>l.id===id);if(!item.parent_id)return state;const effective=model.effectiveLayer(base,item),origin=geometry.multiply(geometry.inverse(effective.transform),state.transform);return{width:state.width,height:state.height,transform:geometry.multiply(item.transform,geometry.translation(origin[4],origin[5]))};}
    function cancelGesture(){if(wheelMorph){clearTimeout(morphTimer);wheelMorph=null;morphWheelRemainder=0;draft=null;invalidate();refresh();return;}if(!gesture&&!opacityBefore)return;if(gesture?.kind==='pick'){sampleSerial++;samplePoint=null;if(!pickerHeld)viewport.classList.remove('picking');}clearInterval(gesture?.sprayTimer);if(gesture?.group)groupMatrix=gesture.item.transform;draft=null;gesture=null;opacityBefore=null;contextRequest=null;invalidate();refresh();}
    function validatePaintSize(width,height){if(![width,height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=1048576))throw Error('Paint coordinates exceed the supported raster extent.');}
    function validatePaintAllocation({workBytes,scratchBytes}){const retained=totalBytes(essentialRefs(history.current));if(retained+workBytes>memoryBudget)throw Error(`Paint source budget: ${((retained+workBytes)/1048576).toFixed(1)} MiB required; ${(memoryBudget/1048576).toFixed(1)} MiB available.`);if(workBytes+scratchBytes>workingBudget)throw Error(`Stroke working budget: ${((workBytes+scratchBytes)/1048576).toFixed(1)} MiB required; ${(workingBudget/1048576).toFixed(1)} MiB available.`);}
    function strokeDraft(g){return g.mask?model.setMaskReference(history.current,'@gesture'):model.replacePaintRaster(g.base,g.id,{asset_ref:'@gesture',...localPaintState(g.base,g.id,g.stroke.state)});}
    function startSpray(g){if(brush.tip!=='spray')return;g.sprayTimer=setInterval(()=>{
        if(gesture!==g||blocked()){clearInterval(g.sprayTimer);return;}
        try{g.stroke.pulse();g.samples++;draft=strokeDraft(g);invalidate();}catch(error){cancelGesture();notify(error.message,true);}
    },40);}
    function exitGroup(){groupBase=null;groupMaskSurface=null;groupMatrix=[...geometry.IDENTITY];}
    function enterGroup(){flushMorph();if(maskMode){maskMode=false;restoreLayout();}beginTransform();cropMode=false;groupBase=history.current;groupMatrix=[...geometry.IDENTITY];closePopup();closeContext();refresh();notify('All layers: drag to move, corners to scale, top handle to rotate. Output size stays fixed.');}
    function groupDocument(matrix){
        const next=model.parseDocument(groupBase);next.layers=next.layers.map(item=>item.parent_id?item:{...item,transform:geometry.multiply(matrix,item.transform)});
        if(groupIncludeMask&&groupBase.mask.asset_ref&&!matrix.every((v,i)=>v===geometry.IDENTITY[i])){
            groupMaskSurface=emptyMask(next.width,next.height);const c=groupMaskSurface.getContext('2d');c.setTransform(...matrix);drawSource(c,source(groupBase.mask.asset_ref),0,0);next.mask.asset_ref='@group-mask';
        }
        return next;
    }
    function commitGroup(matrix,value=groupDocument(matrix)){
        let ref=null;if(value.mask.asset_ref==='@group-mask'){ref=`memory:${uid()}`;assets.set(ref,groupMaskSurface);value.mask.asset_ref=ref;}
        const previous=groupMatrix;groupMatrix=matrix;
        try{return commit(value,{groupEdit:true});}catch(error){groupMatrix=previous;if(ref)assets.delete(ref);throw error;}
    }
    function clearTemporaryPicker({cancelSamples=true}={}){pickerHeld=false;viewport.classList.remove('picking');$('.cursor').style.display=pointerInside&&!blocked()&&['brush','eraser'].includes(tool)?'block':'none';if(cancelSamples){sampleSerial++;samplePoint=null;sampledComposite=null;sampledRevision=null;if(gesture?.kind==='pick')cancelGesture();}}
    function heldPickerAllowed(event){return !maskMode&&['brush','eraser','fill'].includes(tool)&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.getModifierState?.('AltGraph');}
    function pickAt(point,{final=false}={}){
        samplePoint={point,final};if(sampleRunning)return;
        sampleRunning=true;const serial=sampleSerial,token=epoch;
        attempt(async()=>{try{
            while(samplePoint&&serial===sampleSerial&&!blocked()){
                const request=samplePoint;samplePoint=null;const revision=renderVersion;
                if(sampledRevision!==revision){const rendered=await composite(history.current);if(serial!==sampleSerial||token!==epoch||revision!==renderVersion||blocked())return;sampledComposite=rendered.image;sampledRevision=revision;}
                const {x,y}=request.point;if(x<0||y<0||x>=committed.width||y>=committed.height)continue;
                const pixel=sampledComposite.getContext('2d').getImageData(Math.floor(x),Math.floor(y),1,1).data;
                setColor('#'+[...pixel.slice(0,3)].map(v=>v.toString(16).padStart(2,'0')).join(''),{remember:request.final});
            }
        }finally{sampleRunning=false;if(samplePoint&&!blocked())pickAt(samplePoint.point,{final:samplePoint.final});else if(!pickerHeld&&gesture?.kind!=='pick'){sampledComposite=null;sampledRevision=null;}}});
    }
    function beginStroke(p,{erase=tool==='eraser',rightErase=false}={}){
        if(brush.opacity===0)return false;
        const paint=maskMode?null:paintTarget({erase});if(!maskMode&&!paint)return false;const item=paint?.effective;
        const stroke=createRasterStroke({source:maskMode?maskSource():item.asset_ref?source(item.asset_ref):null,width:item?.width??committed.width,height:item?.height??committed.height,transform:item?.transform??geometry.IDENTITY,warp:item?.warp,brush,mask:maskMode,erase,expand:!maskMode,validateSize:validatePaintSize,validateAllocation:validatePaintAllocation,seed:crypto.getRandomValues(new Uint32Array(1))[0]});
        gesture={kind:'stroke',stroke,id:item?.id,base:paint?.base,mask:maskMode,rightErase,samples:0};stroke.move(p);draft=strokeDraft(gesture);startSpray(gesture);invalidate();return true;
    }
    function pointerDown(event){
        if(blocked()||gesture||![0,1,2].includes(event.button))return;
        // Navigation takes priority over selection, popup dismissal and handles.
        if(event.button===1||event.button===0&&(space||handMode)){
            viewport.focus({preventScroll:true});closeContext();closePopup();
            gesture={kind:'pan',start:{x:event.clientX,y:event.clientY},pan:{...pan}};
            viewport.classList.add('panning');viewport.setPointerCapture(event.pointerId);event.preventDefault();return;
        }
        if(event.button===0&&!maskMode&&(event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&!event.getModifierState?.('AltGraph')){
            event.preventDefault();event.stopPropagation();flushMorph();clearTemporaryPicker();closeContext();closePopup();viewport.focus({preventScroll:true});
            const item=hitLayer(toDoc(event),{editable:true});if(item&&selectLayer(item.id)){$(`[data-layer="${CSS.escape(selected)}"]`)?.animate([{boxShadow:'inset 0 0 0 2px #d4f0ff'},{boxShadow:'inset 0 0 0 0px transparent'}],{duration:550,easing:'ease-out'});}return;
        }
        if(!$('.context-menu').hidden){closeContext();event.preventDefault();return;}
        flushMorph();closeContext();
        if(event.button===2&&(behavior.rightButton==='menu'||transformRound||handMode))return;
        viewport.focus({preventScroll:true});closePopup();const p=toDoc(event);
        if(event.button===2){
            if(behavior.rightButton==='lucid')gesture={kind:'right-context',start:p,client:{x:event.clientX,y:event.clientY}};
            else{if(!beginStroke(p,{erase:true,rightErase:true}))return;suppressContextUntil=performance.now()+300;}
        }
        else if(((pickerHeld||(behavior.temporaryPicker==='alt'&&event.altKey))&&heldPickerAllowed(event))||tool==='pick'){
            gesture={kind:'pick'};viewport.classList.add('picking');pickAt(p);
        }
        else if(tool==='move'&&!maskMode){const item=selection();if(!item)return;const points=handles(item),b=bounds(item),pivot=pivotFor(item,b),center=geometry.transformPoint(item.transform,pivot);
            const screen=toView(p),top={x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2-26};
            if(!geometry.pointNearPolygon(screen,points,12)&&((cropMode&&!groupBase)||Math.hypot(screen.x-top.x,screen.y-top.y)>25)){
                gesture={kind:'outside-transform',start:{x:event.clientX,y:event.clientY},moved:false};
                viewport.setPointerCapture(event.pointerId);event.preventDefault();return;
            }
            const corner=points.findIndex(q=>Math.hypot(q.x-screen.x,q.y-screen.y)<12);
            if(item.locked)throw model.lockError(item,'transform this object and its attached paint');
            if(cropMode&&!groupBase&&corner<0)return;
            gesture={kind:cropMode&&!groupBase?'crop':corner>=0?distortMode&&!groupBase?'distort':'scale':Math.hypot(top.x-(p.x*zoom+pan.x),top.y-(p.y*zoom+pan.y))<13?'rotate':'move',before:history.current,item,start:p,pivot,center,group:!!groupBase,corner,bounds:b};
            const x=Math.min(...points.map(q=>q.x)),y=Math.min(...points.map(q=>q.y));gesture.snapBounds={x:(x-pan.x)/zoom,y:(y-pan.y)/zoom,width:(Math.max(...points.map(q=>q.x))-x)/zoom,height:(Math.max(...points.map(q=>q.y))-y)/zoom};
        }
        else if(tool==='fill'){attempt(()=>fillAt(p));return;}
        else if(['brush','eraser'].includes(tool)){
            try{if(!beginStroke(p))return;}catch(error){cancelGesture();reportError(error);return;}
        }else return;
        viewport.setPointerCapture(event.pointerId);event.preventDefault();
    }
    function pointerMove(event){
        pointerInside=true;
        const stageBox=stage.getBoundingClientRect();lastPointer={x:event.clientX-stageBox.left,y:event.clientY-stageBox.top};
        const p=toDoc(event),cursor=$('.cursor');cursor.style.display=!blocked()&&['brush','eraser'].includes(tool)&&!space&&!handMode&&!pickerHeld&&gesture?.kind!=='pick'?'block':'none';cursor.style.left=`${p.x*zoom+pan.x}px`;cursor.style.top=`${p.y*zoom+pan.y}px`;syncBrushCursor();
        if(!gesture)return;
        if(gesture.kind==='outside-transform'){if(Math.hypot(event.clientX-gesture.start.x,event.clientY-gesture.start.y)>5)gesture.moved=true;return;}
        if(gesture.kind==='pick'){pickAt(p);return;}
        if(gesture.kind==='right-context'){
            if(Math.hypot(event.clientX-gesture.client.x,event.clientY-gesture.client.y)<3)return;
            const pending=gesture;pending.moved=true;contextRequest=null;suppressContextUntil=performance.now()+300;
            if(!beginStroke(pending.start,{erase:true,rightErase:true}))return;
        }
        if(gesture.kind==='pan'){pan={x:gesture.pan.x+event.clientX-gesture.start.x,y:gesture.pan.y+event.clientY-gesture.start.y};schedule();return;}
        if(gesture.kind==='stroke'){const samples=event.getCoalescedEvents?.();for(const sample of samples?.length?samples:[event])gesture.stroke.move(toDoc(sample));gesture.samples++;draft=strokeDraft(gesture);invalidate();return;}
        const g=gesture;let matrix;
        if(g.kind==='crop'){const b=g.bounds,at=geometry.createLayerMapping(g.item).inverse(p),left=g.corner===0||g.corner===3,top=g.corner<2;
            const x=left?clamp(Math.round(at.x),0,b.x+b.width-1):b.x,y=top?clamp(Math.round(at.y),0,b.y+b.height-1):b.y;
            const right=left?b.x+b.width:clamp(Math.round(at.x),b.x+1,g.item.width),bottom=top?b.y+b.height:clamp(Math.round(at.y),b.y+1,g.item.height);
            const crop=x===0&&y===0&&right===g.item.width&&bottom===g.item.height?null:{x,y,width:right-x,height:bottom-y};draft=model.updateLayer(g.before,g.item.id,{crop});invalidate();return;}
        if(g.kind==='distort'){
            const b=g.bounds,warp=g.item.warp?structuredClone(g.item.warp):{bounds:{...b},corners:[{x:b.x,y:b.y},{x:b.x+b.width,y:b.y},{x:b.x+b.width,y:b.y+b.height},{x:b.x,y:b.y+b.height}]};
            const inv=geometry.inverse(g.item.transform),start=geometry.transformPoint(inv,g.start),at=geometry.transformPoint(inv,p);
            warp.corners[g.corner].x+=at.x-start.x;warp.corners[g.corner].y+=at.y-start.y;
            try{geometry.validateWarp(warp);}catch{if(!g.warned){notify('Keep all four corners convex. Crossed or collapsed shapes are ignored.');g.warned=true;}return;}
            if(Math.hypot(p.x-g.start.x,p.y-g.start.y)<1e-8){draft=null;invalidate();return;}
            draft=model.updateLayer(g.before,g.item.id,{warp});invalidate();return;
        }
        if(g.kind==='move'){let delta={x:p.x-g.start.x,y:p.y-g.start.y};if(snapToFrame){const snapped=geometry.snapFrameTranslation(g.snapBounds,delta,committed,6/zoom);delta=snapped.delta;g.snapEdges=snapped.edges;}matrix=geometry.multiply(geometry.translation(delta.x,delta.y),g.item.transform);}
        if(g.kind==='rotate'){const angle=Math.atan2(p.y-g.center.y,p.x-g.center.x)-Math.atan2(g.start.y-g.center.y,g.start.x-g.center.x);matrix=geometry.multiply(geometry.aroundPivot(geometry.rotationRadians(event.shiftKey?Math.round(angle/(Math.PI/12))*Math.PI/12:angle),g.center),g.item.transform);}
        if(g.kind==='scale'){const inv=geometry.inverse(g.item.transform),a=geometry.transformPoint(inv,g.start),b=geometry.transformPoint(inv,p),limit=v=>Math.abs(v)<.02?(v<0?-.02:.02):v;
            let sx=limit((b.x-g.pivot.x)/(a.x-g.pivot.x||1)),sy=limit((b.y-g.pivot.y)/(a.y-g.pivot.y||1));
            if($('[data-aspect]').checked&&!event.shiftKey){const factor=(Math.abs(sx)+Math.abs(sy))/2;sx=Math.sign(sx)*factor;sy=Math.sign(sy)*factor;}
            matrix=geometry.multiply(g.item.transform,geometry.aroundPivot(geometry.scaling(sx,sy),g.pivot));}
        if(g.group){groupMatrix=matrix;draft=groupDocument(matrix);}else draft=model.updateLayer(g.before,g.item.id,{transform:matrix});invalidate();
    }
    function pointerUp(event){
        if(!gesture)return;const g=gesture,value=draft;draft=null;gesture=null;
        clearInterval(g.sprayTimer);
        if(viewport.hasPointerCapture(event.pointerId))viewport.releasePointerCapture(event.pointerId);
        if(g.kind==='outside-transform'){if(!g.moved&&Math.hypot(event.clientX-g.start.x,event.clientY-g.start.y)<=5)leaveTransform();return;}
        if(g.kind==='pan'){viewport.classList.toggle('panning',handMode||space);return;}
        if(g.kind==='pick'){pickAt(toDoc(event),{final:true});if(!pickerHeld)viewport.classList.remove('picking');return;}
        if(g.kind==='right-context'){if(g.moved){suppressContextUntil=performance.now()+300;contextRequest=null;}else if(contextRequest){const at=contextRequest;contextRequest=null;canvasContext(at,toDoc(event));}return;}
        if(g.rightErase){suppressContextUntil=performance.now()+300;contextRequest=null;}
        attempt(()=>{try{if(g.kind==='stroke'){g.stroke.finish({materialize:false});if(g.stroke.changed())commitRaster(g.stroke.raster,{mask:g.mask,id:g.id,base:g.base,paintState:g.mask?null:localPaintState(g.base,g.id,g.stroke.state)});else invalidate();}else if(value){if(g.group)commitGroup(groupMatrix,value);else commit(value);}}catch(error){if(g.group)groupMatrix=g.item.transform;throw error;}});refresh();
    }
    async function fillAt(p){
        if(blocked()||brush.opacity===0)return;const paint=maskMode?null:paintTarget(),item=paint?.effective,isMask=maskMode,token=epoch,threshold=fillThreshold,through=fillThrough;setBusy('Finding connected area…');
        try{let reference;
            if(through)reference=(await composite()).image;
            else if(isMask)reference=maskSource();
            else{reference=raster(committed.width,committed.height);if(item.asset_ref)drawLayer(reference.getContext('2d'),item,source(item.asset_ref),{opacity:1});}
            if(token!==epoch||closed)return;const mapping=item?.crop?geometry.createLayerMapping(item):null,allowed=mapping?(x,y)=>{const at=mapping.inverse({x,y}),c=item.crop;return at.x>=c.x&&at.y>=c.y&&at.x<c.x+c.width&&at.y<c.y+c.height;}:null;
            const selection=floodCoverage(reference,p.x,p.y,threshold,{alphaAware:!through,allowed});if(!selection)return;
            const state=isMask?{width:committed.width,height:committed.height,transform:geometry.IDENTITY,offset:{x:0,y:0}}:geometry.expandRasterState(item,alphaBounds(selection,selection.width,selection.height));
            validatePaintSize(state.width,state.height);
            const original=isMask?maskSource():item.asset_ref?source(item.asset_ref):null,result=applyTileCoverage(original,state,selection,alphaBounds(selection,selection.width,selection.height),{mask:isMask,color:isMask?'#ffffff':brush.color,opacity:brush.opacity,validateAllocation:validatePaintAllocation});
            if(result.changed)commitRaster(result.raster,{mask:isMask,id:item?.id,base:paint?.base,paintState:isMask?null:localPaintState(paint.base,item.id,{width:state.width,height:state.height,transform:state.transform,...(state.warp?{warp:state.warp}:{})})});
        }finally{if(token===epoch)setBusy(null);}
    }
    function setBusy(message){busy=!!message;$('.busy').hidden=!message;$('.busy').textContent=message||'';refresh();}
    function newLayer(){const current=history.current,item=model.createLayer({id:uid(),name:`Paint ${current.layers.filter(l=>l.type==='paint').length+1}`,width:current.width,height:current.height});selected=item.id;commit(model.addLayer(current,item));}
    async function importFiles(files,at=null){
        if(blocked()||!leaveTransform())return;flushMorph();const token=epoch;setBusy('Importing original pixels…');
        try{for(const file of files){
            if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Import PNG, JPEG or WebP images.');
            const bitmap=await createImageBitmap(file);if(token!==epoch||closed){bitmap.close();return;}
            const ref=`memory:${uid()}`,current=history.current,scale=Math.min(current.width*.76/bitmap.width,current.height*.76/bitmap.height,1),center=at??{x:current.width/2,y:current.height/2};
            // Copy once at native size: no downsampling, clipping or mutable shared bitmap.
            const required=bytes(bitmap)+totalBytes(essentialRefs(current));if(required>memoryBudget){bitmap.close();throw Error(`Image source budget: ${(required/1048576).toFixed(1)} MiB required; ${(memoryBudget/1048576).toFixed(1)} MiB available.`);}
            assets.set(ref,raster(bitmap.width,bitmap.height,bitmap));bitmap.close();
            const item=model.createLayer({id:uid(),type:'image',name:file.name,width:source(ref).width,height:source(ref).height,asset_ref:ref,transform:[scale,0,0,scale,center.x-source(ref).width*scale/2,center.y-source(ref).height*scale/2]});
            try{selected=item.id;commit(model.addLayer(current,item));}catch(error){assets.delete(ref);throw error;}
        }}finally{if(token===epoch)setBusy(null);}
    }
    function closePopup(){if(popup==='brush'||popup==='color'){if(!maskMode)setColor(brush.color,{updateHue:false});}const returnFocus=$('.popover').contains(root.activeElement);popup=null;popupAnchor=null;pickerDrag=false;$('.popover').hidden=true;if(summonedOrb){orbPosition=summonedOrb;summonedOrb=null;placeOrb();}if(returnFocus)viewport.focus({preventScroll:true});}
    function positionPopup(){const pop=$('.popover');if(pop.hidden)return;const anchor=popup==='brush'?{x:orbPosition.x+52,y:orbPosition.y}:popupAnchor;
        pop.style.left=`${clamp(anchor?.x??(popup==='color'?stage.clientWidth-365:90),10,Math.max(10,stage.clientWidth-pop.offsetWidth-10))}px`;
        pop.style.top=`${clamp(anchor?.y??(popup==='help'?45:65),10,Math.max(10,stage.clientHeight-pop.offsetHeight-10))}px`;
    }
    function placeOrb(){orbPosition.x=clamp(orbPosition.x,5,Math.max(5,stage.clientWidth-49));orbPosition.y=clamp(orbPosition.y,5,Math.max(5,stage.clientHeight-49));Object.assign($('.brush-orb').style,{left:`${orbPosition.x}px`,top:`${orbPosition.y}px`});if(popup==='brush')positionPopup();}
    function summonQuick(at=lastPointer){if(blocked()||gesture)return;if(popup&&popup!=='brush')closePopup();if(at){summonedOrb??={...orbPosition};orbPosition={x:at.x-22,y:at.y-22};placeOrb();}popup=null;openPopup('brush');}
    function pickerMarkup(){return `<div class="picker-section"><strong>Paint color</strong><canvas class="color-field" data-color-field width="256" height="135" tabindex="0" role="slider" aria-label="Color saturation and brightness"></canvas><input class="hue" data-hue type="range" min="0" max="359" value="${Math.round(pickerHue)}" aria-label="Color hue"><label class="hex"><span class="picker-current"></span>HEX <input data-hex value="${brush.color}" maxlength="7" spellcheck="false" aria-label="Hex color"></label><div class="presets">${['#ffffff','#000000','#df6f83','#e7b96b','#9bc278','#61b7dd','#b495f4','#e1d5ba'].map(color=>`<button data-color="${color}" style="background:${color}" aria-label="${color}"></button>`).join('')}</div><span class="recent-label">Recent colors</span><div class="recent-colors" aria-label="Color history"></div></div>`;}
    function brushValue(key){return key==='size'?brush.size:Math.round(brush[key]*100);}
    function syncBrushCursor(){const cursor=$('.cursor');cursor.className=`cursor ${brush.tip}`;cursor.style.width=`${brush.size*zoom*(brush.tip==='ink'?.38:1)}px`;cursor.style.height=`${brush.size*zoom}px`;}
    function syncBrush(){
        $$('[data-brush]').forEach(input=>{if(input!==root.activeElement||input.type!=='number')input.value=brushValue(input.dataset.brush);});
        $$('[data-brush-value]').forEach(output=>{const key=output.dataset.brushValue;output.textContent=`${brushValue(key)}${key==='size'?' px':'%'}`;});
        $$('[data-tip]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.tip===brush.tip));
        $('.opacity-ink').style.background=maskMode?maskColor:brush.color;$('.opacity-ink').style.opacity=brush.opacity;
        $('.opacity-preview').title=`Brush opacity: ${Math.round(brush.opacity*100)}%`;
        $('.swatch').style.background=brush.color;
        $('.brush-orb').style.borderColor=maskMode?maskColor:brush.color;
        syncBrushCursor();
    }
    function setBrush(key,value){if(!Number.isFinite(value))return;brush[key]=key==='size'?clamp(Math.round(value),1,250):clamp(value,0,100)/100;syncBrush();rememberBrush();}
    function colorButtons(colors){return colors.map(color=>`<button data-color="${color}" style="background:${color}" aria-label="Use ${color}" title="${color.toUpperCase()}"></button>`).join('');}
    function syncColorUI({historyChanged=false}={}){
        if($('[data-hex]'))$('[data-hex]').value=brush.color;
        if($('.picker-current'))$('.picker-current').style.background=brush.color;
        if($('[data-hue]'))$('[data-hue]').value=Math.round(pickerHue);
        if(historyChanged||!$('.mini-history').childElementCount){
            const wasRecent=root.activeElement?.closest('.recent-colors,.mini-history');$('.mini-history').innerHTML=colorButtons(colorHistory.slice(0,4));
            if($('.recent-colors'))$('.recent-colors').innerHTML=colorButtons(colorHistory);
            if(wasRecent)$('.popover').hidden?viewport.focus():$('.popover').focus();
        }else if($('.recent-colors')&&!$('.recent-colors').childElementCount)$('.recent-colors').innerHTML=colorButtons(colorHistory);
        const canvas=$('[data-color-field]');if(canvas){const c=canvas.getContext('2d'),{width:w,height:h}=canvas,hsv=hexHSV(brush.color);
            c.fillStyle=hsvHex(pickerHue,1,1);c.fillRect(0,0,w,h);let gradient=c.createLinearGradient(0,0,w,0);gradient.addColorStop(0,'#fff');gradient.addColorStop(1,'#fff0');c.fillStyle=gradient;c.fillRect(0,0,w,h);gradient=c.createLinearGradient(0,0,0,h);gradient.addColorStop(0,'#0000');gradient.addColorStop(1,'#000');c.fillStyle=gradient;c.fillRect(0,0,w,h);
            c.beginPath();c.arc(hsv.s*w,(1-hsv.v)*h,5,0,Math.PI*2);c.lineWidth=3;c.strokeStyle='#122333';c.stroke();c.lineWidth=1.5;c.strokeStyle='#fff';c.stroke();canvas.setAttribute('aria-valuetext',brush.color);
        }
        syncBrush();
    }
    function openPopup(kind,anchor=null){
        if(blocked()||gesture||(kind==='color'&&maskMode))return;if(popup===kind){closePopup();return;}if(popup)closePopup();closeContext();popup=kind;popupAnchor=anchor;const pop=$('.popover');pop.hidden=false;pop.dataset.kind=kind;
        const title={brush:'Quick brush',color:'Paint color',help:'Keyboard shortcuts',scale:'Exact scale',preferences:'Editor preferences'}[kind];
        let body='';
        if(kind==='brush')body=`<div class="quick-sliders">${[['size',1,250],['opacity',0,100],['hardness',0,100]].map(([key,min,max])=>`<label>${key[0].toUpperCase()+key.slice(1)}<output data-brush-value="${key}"></output><input data-brush="${key}" type="range" min="${min}" max="${max}" value="${brushValue(key)}" aria-label="Quick brush ${key}"></label>`).join('')}</div><div class="tips">${['round','square','ink','spray'].map(t=>`<button data-tip="${t}" aria-label="${t} brush" title="${t==='spray'?'Spray: hold to build coverage':t+' brush'}" aria-pressed="${t===brush.tip}">${icon(t)}<span>${t[0].toUpperCase()+t.slice(1)}</span></button>`).join('')}</div>${maskMode?'':pickerMarkup()}`;
        if(kind==='color')body=pickerMarkup();
        if(kind==='help')body=`<div class="shortcut-list">${[...Object.entries(BINDINGS).map(([id,[name]])=>[name,behavior.shortcuts[id]||'Unbound']),['Temporary picker',behavior.temporaryPicker==='off'?'Off':'Hold '+behavior.temporaryPicker.toUpperCase()],['Select editable layer','Ctrl/⌘ + click'],...SHORTCUTS.slice(5).filter(([name])=>!['Brush size','Brush hardness','Select layer above / below'].includes(name))].map(([name,key])=>`<span>${name}</span><kbd>${htmlEscape(key)}</kbd>`).join('')}</div><p class="hint">${rightButtonHelp()}</p><p class="hint">Ctrl/⌘ + click selects an editable layer in Image mode. Imported images prefer their attached paint overlay; empty images gain an overlay only when painted.</p><p class="hint">Shortcuts work only while focus is inside the editor. Text fields keep their normal editing keys.</p>`;
        if(kind==='scale')body=`<div class="all-scale"><div class="hint">${groupBase?'All layers, including locked layers':'Selected layer'}. Output stays ${committed.width} × ${committed.height}. You can also drag the transform handles.</div><label>Scale <input data-scale type="number" min="1" max="1000" value="100"> %</label><button data-action="scale-confirm">Scale content</button></div>`;
        if(kind==='preferences')body=`<div class="preferences-scroll">${behaviorMarkup()}</div><div class="preferences-footer"><button class="primary" data-action="close-popup">Done</button></div>`;
        pop.innerHTML=`<div class="pop-head"><strong>${title}</strong><button data-action="close-popup" aria-label="Close popup">×</button></div>${body}`;pop.scrollTop=0;pop.tabIndex=-1;pop.focus({preventScroll:true});syncBrush();syncColorUI();positionPopup();
    }
    function transformSelected(matrix,id=null){if(groupBase&&!id){commitGroup(geometry.multiply(groupMatrix,geometry.aroundPivot(matrix,{x:committed.width/2,y:committed.height/2})));return;}const item=id?model.objectRoot(history.current,history.current.layers.find(item=>item.id===id)):target();if(!item)throw Error('Select a layer.');if(item.locked)throw model.lockError(item,'transform this object and its attached paint');const b=bounds(item);commit(model.updateLayer(history.current,item.id,{transform:geometry.multiply(item.transform,geometry.aroundPivot(matrix,pivotFor(item,b)))}));}
    function addOverlay(parentId=target()?.id){const current=history.current,existing=model.overlayFor(current,parentId);if(existing){selected=existing.id;refresh();return;}const id=uid();commit(model.addOverlay(current,parentId,id));selected=id;refresh();}
    function detachPaint(id=selected){const current=history.current,item=current.layers.find(layer=>layer.id===id),opacity=model.objectRoot(current,item)?.opacity;
        commit(model.detachOverlay(current,id));if(opacity!==1)notify('Detached with inherited opacity. Overlapping pixels can look different outside the image object.');}
    function detachTransformChild(){
        if(groupBase||maskMode||tool!=='move')return;const current=history.current,child=model.overlayFor(current,target(current)?.id);if(!child)return;
        // Commit through the same model/history path as the existing row action.
        // Select only after a successful detach; neither source pixels nor the parent change.
        detachPaint(child.id);selected=child.id;cropMode=false;distortMode=false;tool='move';refresh();viewport.focus({preventScroll:true});
    }
    function attachDirect(paintId,parentId){const current=history.current,replacement=model.directAttachment(current,paintId,parentId);if(!replacement)return false;
        commit(model.attachPaint(current,paintId,parentId,replacement));selected=paintId;closePopup();closeContext();refresh();return true;
    }
    function updateAttachmentPrompt(){const paintId=$('[data-attach-paint]')?.value,parentId=$('[data-attach-image]')?.value;if(!paintId||!parentId)return;
        const direct=model.directAttachment(history.current,paintId,parentId);$('[data-action=attach-confirm]').textContent=direct?'Attach':'Bake and attach';
        $('.attach-settings .hint').textContent=direct?'Attach this paint without raster baking. It will follow the image. Undo restores the separate layer.':'This attachment bakes paint and destination geometry (including transforms, distortion or crop) into pixels. Detail may soften; the image crop and opacity also apply. The paint receives a new local transform baseline. Undo restores the original.';
    }
    function attachmentPopup(paintId=null,parentId=null){
        const current=history.current,paints=current.layers.filter(l=>l.type==='paint'&&!l.parent_id&&!l.locked),images=current.layers.filter(l=>l.type==='image'&&l.visible&&!model.overlayFor(current,l.id));
        const chosen=paintId&&current.layers.find(l=>l.id===paintId);if(chosen?.locked)throw model.lockError(chosen,'attach this paint layer');
        if(parentId&&!images.some(l=>l.id===parentId))throw Error('That image is hidden or already has an overlay.');
        if(paintId&&!paints.some(l=>l.id===paintId))throw Error('Choose an unattached paint layer.');
        if(!paints.length||!images.length)throw Error('Choose an unlocked paint layer and an image without an overlay.');
        const directPaint=paintId??(paints.length===1?paints[0].id:null),directImage=parentId??(images.length===1?images[0].id:null);
        if(directPaint&&directImage&&attachDirect(directPaint,directImage))return;
        closePopup();closeContext();popup='attach';popupAnchor=lastPointer;const pop=$('.popover');pop.dataset.kind='attach';pop.hidden=false;
        const options=(items,id)=>items.map(l=>`<option value="${htmlEscape(l.id)}" ${l.id===id?'selected':''}>${htmlEscape(l.name)}</option>`).join('');
        pop.innerHTML=`<div class="pop-head"><strong>Attach paint overlay</strong><button data-action="close-popup" aria-label="Close popup">×</button></div><div class="attach-settings"><label>Paint layer<select data-attach-paint aria-label="Paint layer to attach">${options(paints,paintId)}</select></label><label>Image<select data-attach-image aria-label="Destination image">${options(images,parentId)}</select></label><p class="hint">This bakes placement, distortion and any crop into new paint pixels. Detail may soften. The overlay then follows the image and its opacity. Previous geometry becomes a fresh baseline; Undo restores the original.</p><button data-action="attach-confirm">Bake and attach</button><button data-action="close-popup">Cancel</button></div>`;
        updateAttachmentPrompt();pop.tabIndex=-1;pop.focus();positionPopup();
    }
    async function confirmAttachment(){const paintId=$('[data-attach-paint]')?.value,parentId=$('[data-attach-image]')?.value;if(!paintId||!parentId)return;if(attachDirect(paintId,parentId))return;const before=history.current,token=epoch;closePopup();setBusy('Attaching paint overlay…');
        try{const allowance=memoryBudget-totalBytes(essentialRefs(before));const baked=await renderer.attach(before,source,paintId,parentId,allowance);if(token!==epoch||closed)return;
            let ref=null;if(baked.surface){ref=`memory:${uid()}`;assets.set(ref,TileRaster.from(baked.surface));}try{commit(model.attachPaint(before,paintId,parentId,{...baked.state,asset_ref:ref}));selected=paintId;}catch(error){if(ref)assets.delete(ref);throw error;}
        }finally{if(token===epoch)setBusy(null);}
    }
    async function apply(){
        if(blocked()||gesture||!leaveTransform())return;clearTemporaryPicker();closePopup();void preferences?.flush();flushMorph();if(!history.dirty)return;exitGroup();const token=epoch,value=history.current;applyController=new AbortController();setBusy('Applying document…');
        let output;
        try{output=await renderer.export(value,source);if(token!==epoch||closed)return;
            await onApply({document:model.parseDocument(value),assets:new Map(model.assetReferences(value).map(ref=>[ref,source(ref)])),signal:applyController.signal,
                imageBlob:output.imageBlob,maskBlob:output.maskBlob,nativeMaskBlob:output.nativeMaskBlob,assetBlobs:output.assetBlobs,image:output.image,mask:output.mask});
            if(token!==epoch||closed)return;committed=value;history=createDocumentHistory(committed);closed=true;$('.closed').hidden=false;$('[data-closed-title]').textContent='Changes applied';closePopup();collect();
        }finally{output?.dispose();if(token===epoch){applyController=null;setBusy(null);}}
    }
    function cancel(){if(closed)return;clearTemporaryPicker();endRowDrag();applyController?.abort();epoch++;renderer.cancel();releasePreview();cancelGesture();if(transformRound)tool=transformRound.previousTool;transformRound=null;handMode=false;cropMode=false;distortMode=false;exitGroup();closeContext();closed=true;busy=false;$('.busy').hidden=true;history=createDocumentHistory(committed);collect();closePopup();void preferences?.flush();$('.closed').hidden=false;$('[data-closed-title]').textContent='Draft discarded';onCancel();if(!disposed)refresh();}
    function navigateHistory(redo=false){
        flushMorph();const all=!!groupBase;
        if(redo)history.redo();else history.undo();
        if(all){groupBase=history.current;groupMatrix=[...geometry.IDENTITY];groupMaskSurface=null;}
        collect();refresh();
    }
    const actions={
        mask:()=>{clearTemporaryPicker();exitGroup();closePopup();maskMode=!maskMode;if(maskMode&&['move','pick'].includes(tool))tool='brush';closeContext();refresh();restoreLayout();},
        undo:()=>navigateHistory(),redo:()=>navigateHistory(true),
        'reset-panels':()=>{layouts={orb:null,layers:{floating:false,collapsed:false,position:null},mask:{floating:false,collapsed:false,position:null}};preferences?.patch({layout:layouts});restoreLayout({orb:true});closePopup();closeContext();},
        preferences:()=>{finishSetup();openPopup('preferences');},configure:()=>{finishSetup();openPopup('preferences');},'use-defaults':()=>{finishSetup();viewport.focus({preventScroll:true});},'reset-preferences':resetPreferences,
        'reset-behavior':()=>{behaviorOverrides={};preferences?.resetBehavior();behavior=resolveBehavior(behaviorDefaults);clearTemporaryPicker();syncShortcutLabels();popup=null;openPopup('preferences');},
        help:()=>openPopup('help'),'brush-settings':()=>openPopup('brush'),color:()=>openPopup('color'),'close-popup':closePopup,
        fit,'zoom-in':()=>zoomAt(1.2),'zoom-out':()=>zoomAt(1/1.2),hand:()=>{handMode=!handMode;clearTemporaryPicker();closePopup();closeContext();refresh();viewport.focus({preventScroll:true});},'scale-all':enterGroup,'exact-scale':()=>openPopup('scale'),
        add:newLayer,import:()=>$('[data-import]').click(),
        duplicate:()=>{if(!target())return;const id=uid(),next=model.duplicateLayer(history.current,target().id,id);selected=id;commit(next);},
        delete:()=>deleteLayer(),
        up:()=>reorder(1),down:()=>reorder(-1),
        'flip-x':()=>transformSelected(geometry.scaling(-1,1)),'flip-y':()=>transformSelected(geometry.scaling(1,-1)),
        'rotate-cw':()=>transformSelected([0,1,-1,0,0,0]),'rotate-ccw':()=>transformSelected([0,-1,1,0,0,0]),
        distort:()=>{cropMode=false;distortMode=!distortMode;refresh();},
        crop:()=>{distortMode=false;cropMode=!cropMode;refresh();},
        'reset-crop':()=>commit(model.updateLayer(history.current,target().id,{crop:null})),
        'reset-corners':()=>commit(model.updateLayer(history.current,target().id,{warp:null})),
        'reset-transform':()=>groupBase?commitGroup([...geometry.IDENTITY]):commit(model.updateLayer(history.current,target().id,{transform:geometry.IDENTITY,warp:null})),done:()=>finishTransform(),'discard-transform':()=>finishTransform(true),
        'add-overlay':()=>addOverlay(),'detach-overlay':()=>detachPaint(),'detach-child':detachTransformChild,
        'attach-overlay':()=>attachmentPopup(layer()?.type==='paint'?selected:null,target()?.type==='image'?target().id:null),'attach-confirm':confirmAttachment,
        collapse:()=>{panel.classList.toggle('collapsed');clampPanel();rememberPanel();},
        dock:()=>{const box=panel.getBoundingClientRect(),stageBox=stage.getBoundingClientRect();floating=!floating;panel.dataset.floating=String(floating);$('[data-action=dock]').textContent=floating?'Dock':'Float';if(floating){panelPosition=layouts[panelKey()].position?absolute(layouts[panelKey()].position,stage.clientWidth-panel.offsetWidth,stage.clientHeight-panel.offsetHeight):{x:box.left-stageBox.left,y:box.top-stageBox.top};}else{panel.style.left='';panel.style.top='';panel.style.right='';panel.style.bottom='';}clampPanel();rememberPanel();},
        'mask-clear':()=>editMask(()=>emptyMask(committed.width,committed.height)),
        'mask-invert':()=>editMask(before=>{const result=raster(before.width,before.height,before),c=result.getContext('2d'),data=c.getImageData(0,0,result.width,result.height);for(let i=0;i<data.data.length;i+=4)data.data[i]=data.data[i+1]=data.data[i+2]=255-data.data[i];c.putImageData(data,0,0);return result;}),
        'mask-grow':()=>morph(true),'mask-shrink':()=>morph(false),
        'scale-confirm':()=>{const percent=Number($('[data-scale]').value);if(!Number.isFinite(percent)||percent<1||percent>1000)throw Error('Scale must be from 1% to 1000%.');transformSelected(geometry.scaling(percent/100));closePopup();},
        cancel,apply,reopen:()=>{closed=false;epoch++;$('.closed').hidden=true;refresh();viewport.focus();},
    };
    function reorder(delta,id=selected){const current=history.current,item=model.objectRoot(current,current.layers.find(item=>item.id===id)),roots=current.layers.filter(l=>!l.parent_id),index=roots.findIndex(l=>l.id===item?.id),other=roots[index+delta];if(item?.type==='paint'&&item.locked)throw model.lockError(item,'reorder this paint layer');if(!item||item.id===backgroundId||!other||other.id===backgroundId)return;
        const block=current.layers.filter(l=>l.id===item.id||l.parent_id===item.id),remaining=current.layers.filter(l=>!block.includes(l)),at=remaining.findIndex(l=>l.id===other.id)+(delta>0?(model.overlayFor(current,other.id)?2:1):0);remaining.splice(at,0,...block);commit({...current,layers:remaining});}
    function deleteBlocker(current,item){const paint=item?.type==='image'?model.overlayFor(current,item.id):item;return paint?.locked?paint:null;}
    function deleteLayer(id=selected){const current=history.current,item=current.layers.find(l=>l.id===id);if(!item)return;if(id===backgroundId)throw Error('The Background image is protected and cannot be deleted.');const blocker=deleteBlocker(current,item);if(blocker)throw model.lockError(blocker,'delete this layer');commit(model.removeLayer(current,id));}
    function editMask(fn){const before=maskSource(),after=fn(before);if(!equalPixels(before,after))commitRaster(after,{mask:true});}
    async function morph(expand){const token=epoch,radius=morphStep;setBusy('Updating mask…');await new Promise(resolve=>requestAnimationFrame(resolve));try{if(token===epoch&&!closed)editMask(before=>morphCoverage(before,committed.width,committed.height,radius,expand));}finally{if(token===epoch)setBusy(null);}}
    function wheelMask(delta){
        const now=performance.now();if(now-lastMorphWheel>250)morphWheelRemainder=0;lastMorphWheel=now;
        morphWheelRemainder-=delta;const steps=Math.trunc(morphWheelRemainder/100);if(!steps)return;morphWheelRemainder-=steps*100;
        if(!wheelMorph)wheelMorph={source:maskSource(),amount:0,work:null,epoch};
        const g=wheelMorph;g.amount=clamp(g.amount+steps*morphStep,-Math.max(committed.width,committed.height),Math.max(committed.width,committed.height));
        g.work=g.amount?morphCoverage(g.source,committed.width,committed.height,Math.abs(g.amount),g.amount>0):g.source;
        draft=model.setMaskReference(history.current,'@morph');invalidate();clearTimeout(morphTimer);morphTimer=setTimeout(()=>attempt(flushMorph),220);
    }
    function flushMorph(){morphWheelRemainder=0;if(!wheelMorph)return;clearTimeout(morphTimer);const g=wheelMorph;wheelMorph=null;draft=null;if(g.epoch===epoch&&g.amount&&!equalPixels(g.source,g.work))commitRaster(g.work,{mask:true});else invalidate();}
    function fitPanelHeight(){const top=floating||maskMode?15:$('.color-dock').offsetTop+$('.color-dock').offsetHeight+12;panel.style.maxHeight=`${Math.max(120,stage.clientHeight-top-15)}px`;}
    function clampPanel(){fitPanelHeight();if(floating){panelPosition.x=clamp(panelPosition.x,8,Math.max(8,stage.clientWidth-panel.offsetWidth-8));panelPosition.y=clamp(panelPosition.y,8,Math.max(8,stage.clientHeight-panel.offsetHeight-8));Object.assign(panel.style,{left:`${panelPosition.x}px`,top:`${panelPosition.y}px`,right:'auto',bottom:'auto'});}placeOrb();positionPopup();positionContext();}
    function closeContext(){const menu=$('.context-menu'),focused=menu.contains(root.activeElement);menu.hidden=true;menuLayerId=null;if(focused)viewport.focus({preventScroll:true});}
    function positionContext(){const menu=$('.context-menu');if(menu.hidden||!menuAnchor)return;menu.style.left=`${clamp(menuAnchor.x,8,Math.max(8,stage.clientWidth-menu.offsetWidth-8))}px`;menu.style.top=`${clamp(menuAnchor.y,8,Math.max(8,stage.clientHeight-menu.offsetHeight-8))}px`;}
    function hitLayer(p,{editable=false}={}){
        if(p.x<0||p.y<0||p.x>=committed.width||p.y>=committed.height)return null;
        const current=history.current;
        for(const raw of [...current.layers].reverse()){const item=model.effectiveLayer(current,raw),candidate=editable&&raw.type==='image'?model.overlayFor(current,raw.id)??raw:raw;
            if(editable){const resolved=model.effectiveLayer(current,candidate);if(candidate.type==='paint'&&candidate.locked||candidate.type==='image'&&candidate.id===backgroundId||!resolved.visible||!resolved.opacity)continue;}
            if(!item.visible||!item.opacity||!model.objectRoot(current,raw).opacity||!item.asset_ref)continue;const local=geometry.createLayerMapping(item).inverse(p),x=Math.floor(local.x),y=Math.floor(local.y);
            if(item.crop&&(local.x<item.crop.x||local.y<item.crop.y||local.x>=item.crop.x+item.crop.width||local.y>=item.crop.y+item.crop.height))continue;
            if(x<0||y<0||x>=item.width||y>=item.height)continue;
            const image=source(item.asset_ref),surface=image.getContext?image:raster(item.width,item.height,image);
            if(surface.getContext('2d').getImageData(x,y,1,1).data[3])return editable?candidate:item;
        }return null;
    }
    function openContext(at,kind='canvas',id=null){
        if(blocked()||gesture)return;flushMorph();closePopup();menuAnchor=at;
        menuLayerId=kind==='layer'?id:null;const current=history.current,item=current.layers.find(item=>item.id===menuLayerId),protectedLayer=item?.id===backgroundId,object=model.objectRoot(current,item),locked=!!object?.locked,paintLocked=item?.type==='paint'&&item.locked,deleteLocked=deleteBlocker(current,item);
        const common=[['Quick brush here','quick'],['Undo','undo',!history.canUndo],['Redo','redo',!history.canRedo]];
        const entries=kind==='layer'&&item?[
            ['Transform layer','transform',locked],...(item.type==='image'?[['Add paint overlay','add-overlay',!!model.overlayFor(current,item.id)],['Attach paint layer…','attach-overlay',!!model.overlayFor(current,item.id)]]:item.parent_id?[['Detach paint overlay','detach-overlay',paintLocked]]:[['Attach to image…','attach-overlay',paintLocked]]),['Rename layer','rename'],[item.visible?'Hide layer':'Show layer','visibility'],[`${item.locked?'Unlock':'Lock'} ${item.type==='image'?'transform':'paint'}`,'lock'],
            ['Raise layer','up',paintLocked||protectedLayer],['Lower layer','down',paintLocked||protectedLayer],['Duplicate layer','duplicate'],
            ['Flip horizontally','flip-x',locked],['Flip vertically','flip-y',locked],['Rotate 90° clockwise','rotate-cw',locked],['Rotate 90° counterclockwise','rotate-ccw',locked],['Reset transform','reset-transform',locked],['Delete layer','delete',!!deleteLocked||protectedLayer],null,...common
        ]:kind==='mask'?[
            ['Quick brush here','quick'],['Grow mask','mask-grow'],['Shrink mask','mask-shrink'],['Invert mask','mask-invert'],['Clear mask','mask-clear'],null,['Undo','undo',!history.canUndo],['Redo','redo',!history.canRedo]
        ]:[['Quick brush here','quick'],['New paint layer','add'],['Import image…','import'],['Transform all content','scale-all'],['Fit canvas','fit'],null,...common.slice(1)];
        const menuSymbol=action=>action==='lock'?(item.locked?'unlock':'lock'):action==='visibility'?(item.visible?'eye-off':'eye'):MENU_ICONS[action];
        const blockerFor=action=>['transform','flip-x','flip-y','rotate-cw','rotate-ccw','reset-transform'].includes(action)?object?.locked?object:null:action==='delete'?deleteLocked:paintLocked?item:null;
        const menu=$('.context-menu');menu.innerHTML=`<strong>${kind==='layer'?htmlEscape(item.name):kind==='mask'?'Mask actions':'Canvas actions'}</strong>${entries.map(entry=>{if(!entry)return'<hr>';const blocker=entry[2]&&blockerFor(entry[1]);return`<button role="menuitem" data-menu-action="${entry[1]}" ${entry[2]?'disabled':''} ${blocker?`data-lock-blocker="${htmlEscape(blocker.id)}"`:''}><span class="menu-symbol" aria-hidden="true">${menuSymbol(entry[1])?icon(menuSymbol(entry[1])):''}</span><span>${entry[0]}</span></button>`;}).join('')}`;menu.hidden=false;positionContext();menu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
    }
    function runMenu(action,id){
        if(!allowAction(action))return;
        if(action==='quick'){summonQuick(menuAnchor);return;}
        if(id){
            const current=history.current,item=current.layers.find(item=>item.id===id);if(!item)return;
            const object=model.objectRoot(current,item);
            if(action==='transform'){selected=id;exitGroup();beginTransform();refresh();return;}
            if(action==='rename'){const name=$(`[data-layer="${CSS.escape(id)}"] .layer-name`);name?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return;}
            if(action==='visibility'){commit(model.updateLayer(current,id,{visible:!item.visible}));return;}
            if(action==='lock'){commit(model.updateLayer(current,id,{locked:!item.locked}));return;}
            if(action==='up'||action==='down'){reorder(action==='up'?1:-1,id);return;}
            if(action==='add-overlay'){addOverlay(object.id);return;}
            if(action==='attach-overlay'){attachmentPopup(item.type==='paint'?id:null,object.type==='image'?object.id:null);return;}
            if(action==='detach-overlay'){detachPaint(id);return;}
            if(action==='duplicate'){const copyId=uid();selected=copyId;commit(model.duplicateLayer(current,object.id,copyId));return;}
            if(action==='delete'){deleteLayer(id);return;}
            if(['flip-x','flip-y','rotate-cw','rotate-ccw','reset-transform'].includes(action)){
                exitGroup();if(action==='reset-transform')commit(model.updateLayer(current,object.id,{transform:geometry.IDENTITY,warp:null}));
                else transformSelected(action==='flip-x'?geometry.scaling(-1,1):action==='flip-y'?geometry.scaling(1,-1):action==='rotate-cw'?[0,1,-1,0,0,0]:[0,-1,1,0,0,0],id);return;
            }
        }
        return actions[action]?.();
    }
    root.addEventListener('click',event=>{
        const button=event.target.closest('button');if(!button)return;const action=button.dataset.action;
        if(action==='cancel'){cancel();return;}if(action==='reopen'){actions.reopen();return;}if(blocked()||gesture||opacityBefore)return;
        if(button.classList.contains('brush-orb')&&suppressOrbClick){suppressOrbClick=false;return;}
        if(action&&!allowAction(action,button))return;
        if((button.dataset.visibility||button.dataset.lock)&&!leaveTransform())return;
        attempt(()=>{flushMorph();if(button.dataset.menuAction){const menuAction=button.dataset.menuAction,id=menuLayerId;closeContext();return runMenu(menuAction,id);}if(action)return actions[action]?.();if(button.dataset.tool){setTool(button.dataset.tool);return;}
            if(button.dataset.attachment){const parentId=button.dataset.attachment,child=model.overlayFor(history.current,parentId);if(child){selectLayer(child.id);}else if(selectLayer(parentId)){openContext(lastPointer??{x:stage.clientWidth-280,y:stage.clientHeight-300},'layer',parentId);}}
            if(button.dataset.visibility)commit(model.updateLayer(history.current,button.dataset.visibility,{visible:!history.current.layers.find(l=>l.id===button.dataset.visibility).visible}));
            if(button.dataset.lock)commit(model.updateLayer(history.current,button.dataset.lock,{locked:!history.current.layers.find(l=>l.id===button.dataset.lock).locked}));
            if(button.dataset.tip){brush.tip=button.dataset.tip;syncBrush();}
            if(button.dataset.color){const color=button.dataset.color;setColor(brush.color);setColor(color);$('.popover').hidden?viewport.focus():$('.popover').focus();}
        });
    });
    root.addEventListener('click',event=>{if(blocked()||gesture||opacityBefore||event.target.closest('button,input'))return;const row=event.target.closest('[data-layer]');if(row)selectLayer(row.dataset.layer);});
    root.addEventListener('dblclick',event=>{if(blocked()||gesture)return;const id=event.target.closest('[data-layer]')?.dataset.layer;if(!id||!event.target.closest('.layer-name')||!leaveTransform())return;const item=history.current.layers.find(l=>l.id===id),name=$(`[data-layer="${CSS.escape(id)}"] .layer-name`),input=document.createElement('input');input.className='rename';input.value=item.name;input.setAttribute('aria-label','Layer name');name.replaceChildren(input);input.focus();input.select();let ended=false;const finish=accept=>{if(ended)return;ended=true;if(accept&&input.value.trim())attempt(()=>commit(model.updateLayer(history.current,item.id,{name:input.value.trim()})));renderPanel();};input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.stopPropagation();finish(true);}if(e.key==='Escape'){e.stopPropagation();finish(false);}});input.addEventListener('blur',()=>finish(true));});
    function setColor(color,{remember=true,updateHue=true}={}){if(maskMode||!/^#[0-9a-f]{6}$/i.test(color))return;brush.color=color.toLowerCase();const hsv=hexHSV(brush.color);if(updateHue&&hsv.s&&hsv.v)pickerHue=hsv.h;const historyChanged=remember&&colorHistory[0]!==brush.color;if(historyChanged)colorHistory=[brush.color,...colorHistory.filter(old=>old!==brush.color)].slice(0,10);syncColorUI({historyChanged});if(remember)rememberBrush();}
    root.addEventListener('input',event=>{
        if(blocked()||gesture)return;const input=event.target;
        if(input.dataset.brush&&input.value!=='')setBrush(input.dataset.brush,Number(input.value));
        if(input.hasAttribute('data-fill-threshold')&&input.value!==''){const number=Number(input.value);if(Number.isFinite(number)){fillThreshold=clamp(Math.round(number),0,255);$$('[data-fill-threshold]').filter(other=>other!==input).forEach(other=>other.value=fillThreshold);}}
        if(input.hasAttribute('data-hex'))setColor(input.value,{remember:false});
        if(input.hasAttribute('data-hue')){pickerHue=Number(input.value);const hsv=hexHSV(brush.color);setColor(hsvHex(pickerHue,hsv.s,hsv.v),{remember:false,updateHue:false});}
        if(input.hasAttribute('data-morph'))morphStep=clamp(Math.round(Number(input.value)||1),1,16);
        if(input.hasAttribute('data-mask-alpha')){maskAlpha=clamp(Number(input.value)/100,0,1);$$('[data-mask-alpha]').forEach(other=>other.value=Math.round(maskAlpha*100));rememberMask();invalidate();}
        if(input.hasAttribute('data-mask-color')&&/^#[0-9a-f]{6}$/i.test(input.value)){maskColor=input.value;$$('[data-mask-color]').forEach(other=>other.value=maskColor);rememberMask();syncBrush();invalidate();}
        if(input.hasAttribute('data-mask-view')){maskView=input.checked;invalidate();}
        if(input.hasAttribute('data-layer-opacity')){if(!leaveTransform()){input.value=layer().opacity*100;return;}const next=model.updateLayer(opacityBefore||history.current,selected,{opacity:Number(input.value)/100});if(opacityBefore){draft=next;input.nextElementSibling.textContent=`${input.value}%`;invalidate();}else commit(next);}
    });
    root.addEventListener('change',event=>{if(event.target.dataset.brush)event.target.value=brushValue(event.target.dataset.brush);if(event.target.hasAttribute('data-hex')||event.target.hasAttribute('data-hue'))setColor(brush.color,{updateHue:false});if(event.target.hasAttribute('data-import')){attempt(()=>importFiles([...event.target.files]));event.target.value='';}
        if(event.target.matches('[data-attach-paint],[data-attach-image]'))attempt(updateAttachmentPrompt);
        if(event.target.hasAttribute('data-right-button')){updateBehavior({rightButton:event.target.value});$('[data-right-help]').textContent=rightButtonHelp();}
        if(event.target.hasAttribute('data-held-picker')){
            const value=event.target.value,conflict=value==='q'&&Object.values(behavior.shortcuts).some(key=>['Q','Shift+Q'].includes(key));
            if(conflict){event.target.value=behavior.temporaryPicker;$('[data-binding-status]').textContent='Clear the Q shortcut before using Q as the held picker.';}else updateBehavior({temporaryPicker:value});
        }
        if(event.target.hasAttribute('data-fill-threshold'))event.target.value=fillThreshold;
        if(event.target.hasAttribute('data-fill-through')){if(!blocked()&&!gesture)fillThrough=event.target.checked;else event.target.checked=fillThrough;}
        if(event.target.hasAttribute('data-snap-frame')){if(blocked()||gesture)event.target.checked=snapToFrame;else{snapToFrame=event.target.checked;preferences?.patch({transform:{snapToFrame}});syncSnapGuides();}}
        if(event.target.hasAttribute('data-transform-target')){if(event.target.value==='all')enterGroup();else{exitGroup();collect();refresh();}}
        if(event.target.hasAttribute('data-group-mask')){groupIncludeMask=event.target.checked;groupBase=history.current;groupMatrix=[...geometry.IDENTITY];collect();refresh();}
    });
    root.addEventListener('pointerdown',event=>{if(!blocked()&&!gesture&&event.target.hasAttribute('data-layer-opacity')){if(!leaveTransform()){event.preventDefault();return;}opacityBefore=history.current;}});
    root.addEventListener('pointerdown',event=>{
        if(!event.target.closest('.context-menu'))closeContext();
        if(blocked()||gesture)return;
        // Keep an edited HEX field from rebuilding the recent swatches between
        // a swatch's pointerdown and click. The click records both final colors.
        if(event.target.closest('[data-color]'))event.preventDefault();
        if(event.target.hasAttribute('data-color-field')&&event.button===0){pickerDrag=true;event.target.setPointerCapture(event.pointerId);applySV(event);event.preventDefault();}
    });
    function applySV(event){const canvas=$('[data-color-field]');if(!canvas)return;const box=canvas.getBoundingClientRect(),s=clamp((event.clientX-box.left)/box.width,0,1),v=1-clamp((event.clientY-box.top)/box.height,0,1);setColor(hsvHex(pickerHue,s,v),{remember:false,updateHue:false});}
    root.addEventListener('pointermove',event=>{if(pickerDrag&&event.target.hasAttribute('data-color-field'))applySV(event);});
    root.addEventListener('pointerup',event=>{if(pickerDrag){applySV(event);pickerDrag=false;setColor(brush.color,{updateHue:false});}});
    root.addEventListener('pointercancel',()=>{pickerDrag=false;});
    // Consume the dismissal press, its drag/release and the resulting click.
    // This runs before viewport handlers, so no raster gesture can begin.
    root.addEventListener('pointerdown',event=>{
        suppressDismissClick=false;
        if(blocked()||gesture||event.button!==0||space||handMode||popup!=='brush'||event.target.closest('.popover,.brush-orb'))return;
        closePopup();dismissedPointer=event.pointerId;suppressDismissClick=true;
        $('.editor').setPointerCapture(event.pointerId);event.preventDefault();event.stopImmediatePropagation();
    },true);
    for(const name of ['pointermove','pointerup','pointercancel'])root.addEventListener(name,event=>{
        if(event.pointerId!==dismissedPointer)return;
        if(name!=='pointermove'){dismissedPointer=null;if($('.editor').hasPointerCapture(event.pointerId))$('.editor').releasePointerCapture(event.pointerId);}
        event.preventDefault();event.stopImmediatePropagation();
    },true);
    root.addEventListener('click',event=>{if(suppressDismissClick){suppressDismissClick=false;event.preventDefault();event.stopImmediatePropagation();}},true);
    const orb=$('.brush-orb');
    orb.addEventListener('pointerdown',event=>{if(blocked()||gesture||event.button!==0)return;orbDrag={start:{x:event.clientX,y:event.clientY},before:{...orbPosition},moved:false};suppressOrbClick=false;orb.setPointerCapture(event.pointerId);event.preventDefault();});
    orb.addEventListener('pointermove',event=>{if(!orbDrag)return;const dx=event.clientX-orbDrag.start.x,dy=event.clientY-orbDrag.start.y;if(Math.hypot(dx,dy)>4)orbDrag.moved=true;if(orbDrag.moved){orbPosition={x:orbDrag.before.x+dx,y:orbDrag.before.y+dy};placeOrb();}});
    orb.addEventListener('pointerup',()=>{if(orbDrag?.moved){suppressOrbClick=true;summonedOrb=null;rememberOrb();}orbDrag=null;});
    orb.addEventListener('pointercancel',()=>{if(orbDrag){orbPosition=orbDrag.before;placeOrb();}orbDrag=null;suppressOrbClick=true;});
    const reveal=$('.hardness-reveal'),hardnessButton=$('.hardness-handle');
    const showHardness=visible=>{reveal.classList.toggle('open',visible);hardnessButton.setAttribute('aria-expanded',visible);};
    reveal.addEventListener('pointerenter',()=>showHardness(true));reveal.addEventListener('pointerleave',()=>{if(!reveal.contains(root.activeElement))showHardness(false);});
    hardnessButton.addEventListener('click',()=>showHardness(!reveal.classList.contains('open')));
    reveal.addEventListener('focusin',()=>showHardness(true));reveal.addEventListener('focusout',event=>{if(!reveal.contains(event.relatedTarget))showHardness(false);});
    root.addEventListener('pointerup',event=>{if(opacityBefore){const next=draft;opacityBefore=null;draft=null;if(next)attempt(()=>commit(next));}const header=event.target.closest('.panel-head');if(header)clampPanel();});
    root.addEventListener('pointercancel',()=>{if(opacityBefore){opacityBefore=null;draft=null;refresh();}});
    let panelDrag=null;
    $('.panel-head').addEventListener('pointerdown',event=>{if(!floating||event.target.closest('button')||blocked())return;panelDrag={x:event.clientX,y:event.clientY,before:{...panelPosition}};event.currentTarget.setPointerCapture(event.pointerId);});
    $('.panel-head').addEventListener('pointermove',event=>{if(panelDrag){panelPosition={x:panelDrag.before.x+event.clientX-panelDrag.x,y:panelDrag.before.y+event.clientY-panelDrag.y};clampPanel();}});
    $('.panel-head').addEventListener('pointerup',()=>{if(panelDrag){clampPanel();rememberPanel();}panelDrag=null;});
    $('.panel-head').addEventListener('pointercancel',()=>{if(panelDrag){panelPosition=panelDrag.before;clampPanel();}panelDrag=null;});
    root.addEventListener('pointerdown',event=>{
        if(blocked()||gesture)return;const button=event.target.closest('button,input'),current=history.current;if(!button?.disabled)return;let blocker;
        if(button.dataset.lockBlocker)blocker=current.layers.find(l=>l.id===button.dataset.lockBlocker);
        else if(['distort','crop','reset-crop','reset-corners'].includes(button.dataset.action))blocker=target();
        else if(button.dataset.action==='detach-child')blocker=model.overlayFor(current,target()?.id);
        else if(button.hasAttribute('data-layer-opacity'))blocker=layer();
        if(blocker?.locked){const action=button.hasAttribute('data-layer-opacity')?'change this paint layer’s opacity':({crop:'crop this object',distort:'distort this object','reset-crop':'reset this object’s crop','reset-corners':'reset this object’s distortion','detach-child':'detach this paint layer'})[button.dataset.action]??'perform this action';reportError(model.lockError(blocker,action));}
    },true);
    viewport.addEventListener('pointerdown',event=>attempt(()=>pointerDown(event)));viewport.addEventListener('pointermove',event=>{try{pointerMove(event);}catch(error){cancelGesture();reportError(error);}});viewport.addEventListener('pointerup',pointerUp);
    viewport.addEventListener('pointercancel',()=>{clearTemporaryPicker();cancelGesture();});viewport.addEventListener('lostpointercapture',()=>{if(gesture)cancelGesture();});viewport.addEventListener('pointerleave',()=>{pointerInside=false;$('.cursor').style.display='none';});
    function canvasContext(at,p){if(maskMode){openContext(at,'mask');return;}const item=hitLayer(p);openContext(at,item?'layer':'canvas',item?.id);}
    root.addEventListener('contextmenu',event=>{
        if(event.target.closest('input,textarea,[contenteditable=true]'))return;
        const row=event.target.closest('[data-layer]'),onCanvas=event.target.closest('.viewport');if(!row&&!onCanvas)return;
        event.preventDefault();event.stopPropagation();if(blocked()||opacityBefore)return;const box=stage.getBoundingClientRect(),at={x:event.clientX-box.left,y:event.clientY-box.top};
        if(onCanvas){
            if(behavior.rightButton==='classic')return;
            if(gesture?.kind==='right-context'){if(!gesture.moved)contextRequest=at;return;}
            if(gesture||performance.now()<suppressContextUntil)return;canvasContext(at,toDoc(event));return;
        }
        if(gesture)return;const item=row?history.current.layers.find(l=>l.id===row.dataset.layer):hitLayer(toDoc(event));openContext(at,item?'layer':'canvas',item?.id);
    });
    viewport.addEventListener('wheel',event=>{event.preventDefault();event.stopPropagation();if(blocked()||gesture)return;flushMorph();const b=viewport.getBoundingClientRect();zoomAt(Math.exp(-event.deltaY*.0015),{x:event.clientX-b.left,y:event.clientY-b.top});},{passive:false});
    root.addEventListener('wheel',event=>{
        const target=event.target,unit=target.closest('[data-brush-unit]'),brushInput=target.closest('[data-brush]'),isLayer=target.hasAttribute('data-layer-opacity'),isOverlay=target.hasAttribute('data-mask-alpha'),isThreshold=target.hasAttribute('data-fill-threshold'),morphZone=target.closest('[data-morph-wheel]');
        if(target.closest('.context-menu')){event.stopPropagation();return;}
        if(!unit&&!brushInput&&!isLayer&&!isOverlay&&!isThreshold&&!morphZone)return;
        event.preventDefault();event.stopPropagation();if(blocked()||gesture||opacityBefore||!event.deltaY)return;const sign=event.deltaY<0?1:-1;
        attempt(()=>{
            if(isThreshold){fillThreshold=clamp(fillThreshold+sign*(event.shiftKey?10:1),0,255);$$('[data-fill-threshold]').forEach(input=>input.value=fillThreshold);return;}
            if(morphZone){if(target.hasAttribute('data-morph')){morphStep=clamp(morphStep+sign,1,16);target.value=morphStep;}
                else if(!target.closest('button'))wheelMask(event.deltaY*(event.deltaMode===1?40:event.deltaMode===2?stage.clientHeight:1));return;}
            const key=brushInput?.dataset.brush??unit?.dataset.brushUnit;
            if(key){setBrush(key,brushValue(key)+sign*(key==='size'?2:5));if(brushInput)brushInput.value=brushValue(key);return;}
            flushMorph();if(isLayer){if(!leaveTransform())return;if(target.disabled){if(layer()?.locked)throw model.lockError(layer(),'change layer opacity');return;}commit(model.updateLayer(history.current,selected,{opacity:clamp(Math.round(layer().opacity*100)+sign*5,0,100)/100}));}
            if(isOverlay){maskAlpha=clamp(Math.round(maskAlpha*100)+sign*5,0,100)/100;$$('[data-mask-alpha]').forEach(input=>input.value=Math.round(maskAlpha*100));rememberMask();invalidate();}
        });
    },{passive:false});
    viewport.addEventListener('dragover',event=>{event.preventDefault();if(!blocked())viewport.classList.add('drop');});viewport.addEventListener('dragleave',()=>viewport.classList.remove('drop'));
    viewport.addEventListener('drop',event=>{event.preventDefault();viewport.classList.remove('drop');attempt(()=>importFiles([...event.dataTransfer.files],toDoc(event)));});
    function clearDropFeedback(){dropTarget=null;$('.layer-drop-line').hidden=true;$('.layer-drag-label').hidden=true;$$('.attachment.dragover').forEach(element=>element.classList.remove('dragover'));}
    function endRowDrag(){cancelAnimationFrame(dragScroll);dragScroll=0;rowDrag=null;dragPointer=null;clearDropFeedback();$$('.layer.dragging').forEach(row=>row.classList.remove('dragging'));}
    function showDropLabel(message,x,y){const box=stage.getBoundingClientRect(),label=$('.layer-drag-label');label.textContent=message;label.hidden=false;label.style.left=`${clamp(x-box.left-180,8,Math.max(8,stage.clientWidth-230))}px`;label.style.top=`${clamp(y-box.top-30,8,stage.clientHeight-40)}px`;}
    function updateLayerDrop(x,y,element){
        clearDropFeedback();if(!rowDrag)return false;
        const list=$('.layers');if(!list||!list.contains(element))return false;
        const current=history.current,item=current.layers.find(layer=>layer.id===rowDrag.id),row=element.closest('[data-layer]'),roots=current.layers.filter(layer=>!layer.parent_id).reverse();
        let beforeId=null,lineY=list.getBoundingClientRect().bottom;
        if(row){const hovered=current.layers.find(layer=>layer.id===row.dataset.layer),parent=model.objectRoot(current,hovered),parentRow=$(`[data-layer="${CSS.escape(parent.id)}"]`),child=model.overlayFor(current,parent.id),lastRow=child?$(`[data-layer="${CSS.escape(child.id)}"]`):parentRow;
            const first=parentRow.getBoundingClientRect(),last=lastRow.getBoundingClientRect(),after=y>(first.top+last.bottom)/2,index=roots.findIndex(layer=>layer.id===parent.id);beforeId=after?roots[index+1]?.id??null:parent.id;lineY=after?last.bottom+2:first.top-2;
        }else if(y<list.getBoundingClientRect().top+12){beforeId=roots[0]?.id??null;lineY=list.getBoundingClientRect().top+2;}
        try{moveLayerObject(current,rowDrag.id,beforeId,{backgroundId});}catch(error){showDropLabel(error.message,x,y);return false;}
        const box=stage.getBoundingClientRect(),listBox=list.getBoundingClientRect(),line=$('.layer-drop-line');line.hidden=false;line.style.left=`${listBox.left-box.left+6}px`;line.style.top=`${clamp(lineY,listBox.top+2,listBox.bottom-2)-box.top}px`;line.style.width=`${Math.max(20,listBox.width-12)}px`;
        const message=item.parent_id?'Detach & move':model.overlayFor(current,item.id)?'Move image + overlay':'Move layer';line.querySelector('span').textContent=message;showDropLabel(message,x,y);dropTarget={beforeId};return true;
    }
    function scrollLayerDrag(){
        dragScroll=0;if(!rowDrag||!dragPointer)return;const list=$('.layers'),box=list?.getBoundingClientRect();
        if(box&&dragPointer.x>=box.left&&dragPointer.x<=box.right&&dragPointer.y>=box.top&&dragPointer.y<=box.bottom){const speed=dragPointer.y<box.top+32?-8:dragPointer.y>box.bottom-32?8:0;if(speed){list.scrollTop+=speed;updateLayerDrop(dragPointer.x,dragPointer.y,root.elementFromPoint(dragPointer.x,dragPointer.y));}}
        dragScroll=requestAnimationFrame(scrollLayerDrag);
    }
    root.addEventListener('dragstart',event=>{
        let row=event.target.closest('[data-layer]');const item=row&&history.current.layers.find(l=>l.id===row.dataset.layer);
        if(blocked()||gesture||!item||item.id===backgroundId||item.type==='paint'&&item.locked||event.target.closest('button,input')){event.preventDefault();if(item?.type==='paint'&&item.locked)reportError(model.lockError(item,'drag this paint layer'));return;}
        if(!leaveTransform()){event.preventDefault();return;}row=$(`[data-layer="${CSS.escape(item.id)}"]`);
        endRowDrag();rowDrag={id:item.id};row.classList.add('dragging');event.dataTransfer.setData('application/x-lucid-layer',item.id);
        if(item.type==='paint'&&!item.parent_id)event.dataTransfer.setData('application/x-lucid-paint',item.id);event.dataTransfer.effectAllowed='move';
        showDropLabel(item.parent_id?'Detach & move':model.overlayFor(history.current,item.id)?'Move image + overlay':'Move layer',event.clientX,event.clientY);dragScroll=requestAnimationFrame(scrollLayerDrag);
    });
    root.addEventListener('dragover',event=>{
        if(blocked()||gesture)return;const attachment=event.target.closest('[data-attachment]');
        if(attachment&&event.dataTransfer.types.includes('application/x-lucid-paint')){event.preventDefault();clearDropFeedback();attachment.classList.add('dragover');event.dataTransfer.dropEffect='move';if(rowDrag){let direct=false;try{direct=!!model.directAttachment(history.current,rowDrag.id,attachment.dataset.attachment);}catch{}showDropLabel(direct?'Attach paint':'Attach paint · confirm baking',event.clientX,event.clientY);}dragPointer=null;return;}
        if(!rowDrag)return;dragPointer={x:event.clientX,y:event.clientY};if(updateLayerDrop(event.clientX,event.clientY,event.target)){event.preventDefault();event.dataTransfer.dropEffect='move';}else event.dataTransfer.dropEffect='none';
    });
    root.addEventListener('dragleave',event=>{event.target.closest('[data-attachment]')?.classList.remove('dragover');if(event.target.classList.contains('layers')&&!event.target.contains(event.relatedTarget)){dragPointer=null;clearDropFeedback();}});
    root.addEventListener('dragend',endRowDrag);
    root.addEventListener('drop',event=>{
        if(transformRound&&!leaveTransform()){event.preventDefault();endRowDrag();return;}
        const attachment=event.target.closest('[data-attachment]');if(attachment&&event.dataTransfer.types.includes('application/x-lucid-paint')){event.preventDefault();const id=event.dataTransfer.getData('application/x-lucid-paint');endRowDrag();if(id&&!blocked()&&!gesture)attempt(()=>attachmentPopup(id,attachment.dataset.attachment));return;}
        if(!rowDrag)return;event.preventDefault();const id=rowDrag.id,valid=updateLayerDrop(event.clientX,event.clientY,event.target),destination=dropTarget;endRowDrag();
        if(valid&&destination&&!blocked()&&!gesture)attempt(()=>{const current=history.current,item=current.layers.find(layer=>layer.id===id),parent=item.parent_id&&model.objectRoot(current,item),next=moveLayerObject(current,id,destination.beforeId,{backgroundId});selected=id;commit(next);if(parent&&parent.opacity!==1)notify('Detached with inherited opacity. Overlapping pixels can look different outside the image object.');});
    });
    root.addEventListener('keydown',event=>{
        if(blocked()||event.isComposing||event.keyCode===229)return;
        if(rowDrag){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();endRowDrag();}return;}
        const menu=$('.context-menu');
        if(!menu.hidden&&event.target.closest('.context-menu')&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
            event.preventDefault();event.stopPropagation();const items=[...menu.querySelectorAll('button:not(:disabled)')],at=items.indexOf(root.activeElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:(at+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();return;
        }
        const target=event.target,text=target.matches('input:not([type=range]):not([type=checkbox]),textarea,select,[contenteditable=true]');
        if(target.dataset.binding){
            if(event.key==='Tab')return;event.preventDefault();event.stopPropagation();
            if(event.key==='Escape'){viewport.focus();return;}if(['Shift','Control','Meta','Alt'].includes(event.key))return;
            const key=event.key==='Backspace'?'':eventBinding(event),issue=bindingIssue(target.dataset.binding,key,behavior);
            $('[data-binding-status]').textContent=issue??'Shortcut updated.';
            if(!issue){updateBehavior({shortcuts:{[target.dataset.binding]:key}});target.textContent=key||'Unbound';}return;
        }
        if(target.hasAttribute('data-layer')&&['Enter',' '].includes(event.key)&&!(event.key==='Enter'&&transformRound&&target.dataset.layer===selected)){event.preventDefault();event.stopPropagation();if(!gesture)selectLayer(target.dataset.layer);return;}
        if(popup&&event.key==='Escape'){event.preventDefault();event.stopPropagation();closePopup();return;}
        if(popup==='scale'&&target.hasAttribute('data-scale')&&event.key==='Enter'){event.preventDefault();event.stopPropagation();attempt(actions['scale-confirm']);return;}
        if(event.key==='Escape'&&(opacityBefore||wheelMorph)){event.preventDefault();event.stopPropagation();cancelGesture();return;}
        if(text)return;let handler=null;const key=event.key.toLowerCase(),mod=event.ctrlKey||event.metaKey;
        if(!gesture&&heldPickerAllowed(event)&&((behavior.temporaryPicker==='alt'&&event.key==='Alt')||(behavior.temporaryPicker==='q'&&event.code==='KeyQ'))){event.preventDefault();event.stopPropagation();pickerHeld=true;viewport.classList.add('picking');$('.cursor').style.display='none';return;}
        if(key==='escape')handler=()=>{if(!menu.hidden)closeContext();else if(transformRound)finishTransform(true);else if(gesture||opacityBefore||wheelMorph)cancelGesture();else closePopup();clearTemporaryPicker();showHardness(false);};
        else if(gesture)return;
        else if(key==='enter'&&transformRound&&!popup&&menu.hidden&&!mod&&!event.altKey&&!target.closest('button'))handler=()=>finishTransform();
        else if(event.key==='Delete'&&!mod&&!event.altKey&&!event.shiftKey&&!maskMode&&panel.contains(target)&&menu.hidden&&$('.popover').hidden)handler=()=>{if(allowAction('delete'))actions.delete();};
        else if(event.code==='ContextMenu'||(event.shiftKey&&event.code==='F10'))handler=()=>{const at=lastPointer??{x:stage.clientWidth/2,y:stage.clientHeight/2},row=target.closest('[data-layer]');openContext(at,maskMode?'mask':row?'layer':'canvas',row?.dataset.layer);};
        else if(target.hasAttribute('data-color-field')&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))handler=()=>{const hsv=hexHSV(brush.color),step=event.shiftKey?.1:.01;if(key==='arrowleft')hsv.s-=step;if(key==='arrowright')hsv.s+=step;if(key==='arrowup')hsv.v+=step;if(key==='arrowdown')hsv.v-=step;setColor(hsvHex(pickerHue,clamp(hsv.s,0,1),clamp(hsv.v,0,1)),{updateHue:false});};
        else if(mod&&!event.altKey&&key==='z')handler=event.shiftKey?actions.redo:actions.undo;
        else if(event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey&&key==='y')handler=actions.redo;
        else if(!mod&&!event.altKey){
            if(event.code==='Space'&&!target.closest('button,input'))handler=()=>{space=true;viewport.classList.add('panning');$('.cursor').style.display='none';};
            else{const binding=eventBinding(event),action=Object.keys(BINDINGS).find(id=>binding&&behavior.shortcuts[id]===binding);
                if(TOOLS.some(([id])=>id===action))handler=()=>setTool(action);
                else if(action==='mask')handler=()=>{if(allowAction('mask'))actions.mask();};else if(action==='quick')handler=()=>summonQuick();else if(action==='color')handler=()=>openPopup('color',lastPointer);else if(action==='add')handler=()=>{if(allowAction('add'))newLayer();};
                else if(['smaller','larger','softer','harder'].includes(action))handler=()=>{const delta=['larger','harder'].includes(action)?1:-1;if(['softer','harder'].includes(action))brush.hardness=clamp(brush.hardness+delta*.05,0,1);else brush.size=clamp(brush.size+delta*(brush.size>50?5:1),1,250);rememberBrush();refresh();};
                else if(['above','below'].includes(action))handler=()=>{const rows=displayLayers(history.current),index=rows.findIndex(l=>l.id===selected),next=clamp(index+(action==='above'?-1:1),0,rows.length-1);selectLayer(rows[next]?.id);};
                else if(!event.shiftKey&&/^[0-9]$/.test(key))handler=()=>{brush.opacity=key==='0'?1:Number(key)/10;rememberBrush();refresh();};
            }
        }
        if(handler){event.preventDefault();event.stopPropagation();if(!event.repeat||event.code==='Space'||['smaller','larger','softer','harder'].some(id=>behavior.shortcuts[id]===eventBinding(event)))attempt(()=>{if(key!=='escape')flushMorph();return handler();});}
    });
    root.addEventListener('keyup',event=>{if(event.code==='Space'){if(space){event.preventDefault();event.stopPropagation();}space=false;viewport.classList.toggle('panning',handMode||gesture?.kind==='pan');}if((event.key==='Alt'||event.code==='KeyQ')&&pickerHeld){event.preventDefault();event.stopPropagation();clearTemporaryPicker({cancelSamples:false});}});
    root.addEventListener('focusout',event=>{if(!root.contains(event.relatedTarget)){space=false;viewport.classList.toggle('panning',handMode||gesture?.kind==='pan');}if(event.relatedTarget!==viewport)clearTemporaryPicker();});
    const clearSpace=()=>{space=false;clearTemporaryPicker();endRowDrag();if(gesture)cancelGesture();dismissedPointer=null;suppressDismissClick=false;viewport.classList.toggle('panning',handMode);};window.addEventListener('blur',clearSpace);
    const hidden=()=>{if(document.hidden)clearSpace();};document.addEventListener('visibilitychange',hidden);
    const observer=new ResizeObserver(()=>{layoutRail();if(!panelDrag&&!orbDrag)restoreLayout({orb:true});else clampPanel();schedule();});observer.observe(stage);
    const popupObserver=new ResizeObserver(()=>{if(popup==='preferences')positionPopup();});popupObserver.observe($('.popover'));
    collect();refresh();syncColorUI();fit();restoreLayout({orb:true});
    syncShortcutLabels();$('.first-use').hidden=!preferences||remembered.behaviorSetupSeen;
    let preferenceWarningShown=false;
    const unsubscribePreferences=preferences?.subscribeError(message=>{if(!preferenceWarningShown){preferenceWarningShown=true;notify(message,true);}});
    const flushPreferences=()=>{void preferences?.flush();};window.addEventListener('pagehide',flushPreferences);
    return {
        get document(){return history.current;},get committedDocument(){return model.parseDocument(committed);},get dirty(){return history.dirty;},
        get assetCount(){return assets.size;},get isClosed(){return closed;},get isBusy(){return busy;},
        get memory(){const documentBytes=totalBytes(model.assetReferences(history.current)),retainedBytes=totalBytes(new Set([...essentialRefs(history.current),...history.retainedAssetReferences]));return{documentBytes,retainedBytes,historyBytes:retainedBytes-documentBytes,working:gesture?.stroke?.allocation??null,sourceBudget:memoryBudget,workingBudget};},
        get rendering(){return renderer.status;},
        render:()=>composite(history.current),importFiles,
        destroy(){if(disposed)return;clearTemporaryPicker();endRowDrag();closePopup();flushPreferences();unsubscribePreferences?.();window.removeEventListener('pagehide',flushPreferences);applyController?.abort();epoch++;disposed=true;clearTimeout(renderTimer);renderer.dispose();releasePreview();clearInterval(gesture?.sprayTimer);clearTimeout(morphTimer);observer.disconnect();popupObserver.disconnect();window.removeEventListener('blur',clearSpace);document.removeEventListener('visibilitychange',hidden);clearTimeout(noticeTimer);cancelAnimationFrame(frame);root.replaceChildren();},
    };
}
