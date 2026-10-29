// Pending resolution authoring only: never owns or commits a canvas document.

export function aspectRatioLabel(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return '?';
    const gcd = (a,b) => b ? gcd(b,a % b) : a, divisor = gcd(width,height);
    const w = width / divisor, h = height / divisor;
    return w <= 99 && h <= 99 ? `${w}:${h}` : `${Number((width / height).toFixed(2))}:1`;
}

export function resolutionControls(node, layout, visible, presetValues) {
    const widget=name=>node.widgets.find(w=>w.name===name);
    const geometry=()=>{
        // Same workbench at every permitted node width. Preview never becomes
        // a full-width extra row; all dimensions remain proposal values only.
        const width=Math.max(348,node.size[0]-32),previewWidth=100,left=width-previewWidth-14;
        return {width,left,previewWidth,height:174};
    };
    return layout.addRow('Canvas preset', [
        {name:'preset',label:'Preset',minWidth:180,values:presetValues},
        {name:'width',label:'W',minWidth:130,kind:'number',integer:true,horizontal:true,labelWidth:22,ariaLabel:'Width'},
        {name:'height',label:'H',minWidth:130,kind:'number',integer:true,horizontal:true,labelWidth:22,ariaLabel:'Height'},
        {name:'step',label:'Step',minWidth:75,grow:0,horizontal:true,labelWidth:34,values:()=>node.imageDocumentController.stepChoices},
    ], visible, ()=>node.id, {
        cells(fields){const g=geometry();return [
            {...fields[0],x:0,top:0,width:g.width},
            {...fields[1],x:0,top:62,width:g.left},
            {...fields[2],x:0,top:102,width:g.left},
            {...fields[3],x:0,top:142,width:110},
        ];},
        contentHeight:()=>geometry().height,
        decorate(container){
            const swap=document.createElement('button');swap.type='button';swap.textContent='Swap ⇄';
            swap.className='vrp-ui-size-swap';swap.title='Swap width and height';swap.setAttribute('aria-label','Swap width and height');
            const preview=document.createElement('div');preview.className='vrp-ui-size-preview';
            const frame=document.createElement('div');frame.className='vrp-ui-size-frame';
            const shape=document.createElement('div');shape.className='vrp-ui-size-shape';frame.append(shape);
            const caption=document.createElement('div');caption.setAttribute('aria-live','polite');preview.append(frame,caption);
            container.append(swap,preview);
            const clicked=()=>{if(!swap.disabled)node.imageDocumentController.swapSize();};swap.addEventListener('click',clicked);
            return {refresh(){
                const g=geometry(),width=Number(widget('width').value),height=Number(widget('height').value);
                swap.disabled=node.imageDocumentController?.idle===false || ['width','height'].some(name=>
                    node.inputs?.some(input=>input.widget?.name===name && input.link!=null));
                Object.assign(swap.style,{position:'absolute',left:`${6+g.left-78}px`,top:'142px',width:'78px',height:'32px'});
                Object.assign(preview.style,{position:'absolute',left:`${6+g.left+14}px`,top:'62px',width:`${g.previewWidth}px`});
                const ratio=width/height,valid=Number.isFinite(ratio)&&ratio>0;
                shape.style.width=`${valid?Math.min(84,74*ratio):0}px`;
                shape.style.height=`${valid?Math.min(74,84/ratio):0}px`;
                caption.textContent=aspectRatioLabel(width,height);
                preview.title='Pending resolution — applied only on Create / Resize';
            },dispose(){swap.removeEventListener('click',clicked);}};
        },
    });
}
