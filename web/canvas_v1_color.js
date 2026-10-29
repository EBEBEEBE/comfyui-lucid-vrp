// Small color conversions shared by the embedded picker; no browser dependency.
export function hexHSV(hex){
    const [r,g,b]=hex.slice(1).match(/../g).map(value=>parseInt(value,16)/255);
    const high=Math.max(r,g,b),low=Math.min(r,g,b),delta=high-low;
    let h=0;
    if(delta){if(high===r)h=60*((g-b)/delta%6);else if(high===g)h=60*((b-r)/delta+2);else h=60*((r-g)/delta+4);}
    return{h:(h+360)%360,s:high?delta/high:0,v:high};
}

export function hsvHex(h,s,v){
    const c=v*s,x=c*(1-Math.abs((h/60%2)-1)),m=v-c;
    const rgb=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
    return '#'+rgb.map(value=>Math.round((value+m)*255).toString(16).padStart(2,'0')).join('');
}
