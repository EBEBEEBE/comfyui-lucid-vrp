// UI-independent Canvas 2D affine geometry. Angles are radians.
// [a,b,c,d,e,f] maps (x,y) to (a*x+c*y+e, b*x+d*y+f).
export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

function finite(value, label) {
    if (!Number.isFinite(value)) throw Error(`${label} must be finite`);
    return value;
}

function point(value) {
    if (!value || typeof value !== 'object') throw Error('Point must contain x and y');
    finite(value.x, 'Point x');
    finite(value.y, 'Point y');
    return value;
}

export function validateTransform(value) {
    if (!Array.isArray(value) || value.length !== 6) throw Error('Transform must have six numbers');
    for (const entry of value) finite(entry, 'Transform entry');
    return value;
}

// Apply right first, then left. This also preserves shear from composed transforms.
export function multiply(left, right) {
    const [a,b,c,d,e,f] = validateTransform(left);
    const [g,h,i,j,k,l] = validateTransform(right);
    return validateTransform([
        a*g+c*h, b*g+d*h, a*i+c*j, b*i+d*j, a*k+c*l+e, b*k+d*l+f,
    ]);
}

export function transformPoint(matrix, value) {
    const [a,b,c,d,e,f] = validateTransform(matrix);
    const {x,y} = point(value);
    return {x:finite(a*x+c*y+e, 'Transformed x'), y:finite(b*x+d*y+f, 'Transformed y')};
}

// Caller supplies screen coordinates so the tolerance stays constant at any zoom.
export function pointNearPolygon(value, vertices, margin=0) {
    point(value);if(vertices.length<3||!Number.isFinite(margin)||margin<0)throw Error('Invalid polygon hit area');
    let inside=false;
    for(let i=0,j=vertices.length-1;i<vertices.length;j=i++){
        const a=point(vertices[j]),b=point(vertices[i]),dx=b.x-a.x,dy=b.y-a.y;
        const t=Math.max(0,Math.min(1,((value.x-a.x)*dx+(value.y-a.y)*dy)/(dx*dx+dy*dy||1)));
        if(Math.hypot(value.x-a.x-t*dx,value.y-a.y-t*dy)<=margin)return true;
        if((a.y>value.y)!==(b.y>value.y)&&value.x<(b.x-a.x)*(value.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
    }
    return inside;
}

// Movement-only alignment of an existing transform box to the fixed frame.
// Callers convert the screen-pixel tolerance into document coordinates.
export function snapFrameTranslation(box,delta,frame,tolerance) {
    point(box);point(delta);for(const value of [box.width,box.height,frame.width,frame.height,tolerance])finite(value,'Snap extent');
    if(box.width<0||box.height<0||frame.width<=0||frame.height<=0||tolerance<0)throw Error('Invalid snap extent');
    function axis(start,size,move,end,low,high){
        const a=start+move,b=a+size,candidates=[[0-a,low],[end-b,high],[0-b,low],[end-a,high]];
        let nearest=null;for(const [correction,edge]of candidates)if(Math.abs(correction)<=tolerance&&(!nearest||Math.abs(correction)<Math.abs(nearest.correction)))nearest={correction,edge};
        return{move:move+(nearest?.correction??0),edge:nearest?.edge};
    }
    const x=axis(box.x,box.width,delta.x,frame.width,'left','right'),y=axis(box.y,box.height,delta.y,frame.height,'top','bottom');
    return{delta:{x:x.move,y:y.move},edges:[x.edge,y.edge].filter(Boolean)};
}

export function inverse(matrix) {
    const [a,b,c,d,e,f] = validateTransform(matrix);
    // Normalize the linear part so a representable inverse is not rejected
    // merely because a*d or b*c would overflow at very large uniform scales.
    const size = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
    if (!size) throw Error('Transform is singular');
    const na=a/size, nb=b/size, nc=c/size, nd=d/size;
    const determinant=na*nd-nb*nc;
    if (!determinant) throw Error('Transform is singular or too ill-conditioned to invert');
    const ia=nd/determinant/size, ib=-nb/determinant/size;
    const ic=-nc/determinant/size, id=na/determinant/size;
    return validateTransform([ia,ib,ic,id,-(ia*e+ic*f),-(ib*e+id*f)]);
}

export function translation(x, y) {
    return [1,0,0,1,finite(x, 'Translation x'),finite(y, 'Translation y')];
}

export function scaling(x, y=x) {
    finite(x, 'Scale x'); finite(y, 'Scale y');
    if (!x || !y) throw Error('Scale must be nonzero');
    return [x,0,0,y,0,0];
}

export function rotationRadians(angle) {
    finite(angle, 'Rotation');
    const cosine=Math.cos(angle), sine=Math.sin(angle);
    return [cosine,sine,-sine,cosine,0,0];
}

export function aroundPivot(matrix, pivot) {
    const {x,y}=point(pivot);
    return multiply(translation(x,y), multiply(matrix,translation(-x,-y)));
}

// Geometry only: callers choose which content receives this transform.
// In particular, this helper makes no decision about mask participation.
export function scaleWithinFrame(width, height, x, y=x, pivot={x:width/2,y:height/2}) {
    if (![width,height].every(value=>Number.isSafeInteger(value)&&value>0))
        throw Error('Frame dimensions must be positive safe integers');
    return {width,height,transform:aroundPivot(scaling(x,y),pivot)};
}

// Grow local paint storage in whole pixels without resampling or moving any
// existing artwork. This changes layer storage, never document/output bounds.
export function expandRasterState({width,height,transform,warp},area,blockSize=64) {
    if(![width,height,blockSize].every(value=>Number.isSafeInteger(value)&&value>0))
        throw Error('Raster dimensions and allocation block must be positive integers');
    for(const key of ['x','y','width','height'])finite(area[key],'Paint area');
    if(area.width<0||area.height<0)throw Error('Paint area dimensions must be nonnegative');
    const corners=rasterAreaPoints({transform,warp},area);
    const minX=Math.min(0,Math.floor(Math.min(...corners.map(p=>p.x))/blockSize)*blockSize);
    const minY=Math.min(0,Math.floor(Math.min(...corners.map(p=>p.y))/blockSize)*blockSize);
    const maxX=Math.max(width,Math.ceil(Math.max(...corners.map(p=>p.x))/blockSize)*blockSize);
    const maxY=Math.max(height,Math.ceil(Math.max(...corners.map(p=>p.y))/blockSize)*blockSize);
    const next={width:maxX-minX,height:maxY-minY,transform:multiply(transform,translation(minX,minY))};
    if(warp)next.warp={bounds:{...warp.bounds,x:warp.bounds.x-minX,y:warp.bounds.y-minY},
        corners:warp.corners.map(p=>({x:p.x-minX,y:p.y-minY}))};
    if(![next.width,next.height].every(value=>Number.isSafeInteger(value)&&value>0))
        throw Error('Paint storage dimensions are unrepresentable');
    return {...next,offset:{x:-minX,y:-minY},changed:!!minX||!!minY||maxX!==width||maxY!==height};
}

const cross=(a,b)=>a.x*b.y-a.y*b.x;
const subtract=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
const rectangle=b=>[{x:b.x,y:b.y},{x:b.x+b.width,y:b.y},
    {x:b.x+b.width,y:b.y+b.height},{x:b.x,y:b.y+b.height}];

// A fixed local cage, separate from native raster storage and outer affine
// placement. Strictly convex corners prevent folds and ambiguous picking.
export function validateWarp(warp) {
    if(!warp||Object.keys(warp).sort().join(',')!=='bounds,corners')throw Error('Invalid distort fields');
    const b=warp.bounds;
    if(!b||Object.keys(b).sort().join(',')!=='height,width,x,y')throw Error('Invalid distort bounds');
    for(const value of Object.values(b))finite(value,'Distort bounds');
    finite(b.x+b.width,'Distort bounds right');finite(b.y+b.height,'Distort bounds bottom');
    if(b.width<=0||b.height<=0)throw Error('Distort bounds must be positive');
    if(!Array.isArray(warp.corners)||warp.corners.length!==4)throw Error('Distort needs four corners');
    for(const p of warp.corners){point(p);if(Object.keys(p).sort().join(',')!=='x,y')throw Error('Invalid distort corner');}
    const edges=warp.corners.map((p,i)=>subtract(warp.corners[(i+1)%4],p));
    const scale=Math.max(...edges.map(e=>e.x*e.x+e.y*e.y));
    if(!Number.isFinite(scale)||!scale||edges.some((e,i)=>cross(e,edges[(i+1)%4])<=scale*1e-6))
        throw Error('Distort corners must form a convex, non-collapsed quadrilateral');
    return warp;
}

// Bilinear inside the cage. Outside, continue rays from its center through
// the boundary. For a convex cage this is a continuous, one-to-one extension
// over the entire plane, so later paint is not clipped to the original quad.
export function createWarpMapping(value) {
    const {bounds:b,corners:q}=validateWarp(value),[a,c,d,e]=q;
    const ux=c.x-a.x,uy=c.y-a.y,vx=e.x-a.x,vy=e.y-a.y;
    const wx=a.x-c.x+d.x-e.x,wy=a.y-c.y+d.y-e.y;
    const bilinear=(u,v)=>({x:a.x+ux*u+vx*v+wx*u*v,y:a.y+uy*u+vy*v+wy*u*v});
    const center=bilinear(.5,.5),uv=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
    return {
        center,
        forward(p){
            const u=(p.x-b.x)/b.width,v=(p.y-b.y)/b.height,t=Math.max(Math.abs(u-.5),Math.abs(v-.5))*2;
            if(t<=1)return bilinear(u,v);
            const edge=bilinear(.5+(u-.5)/t,.5+(v-.5)/t);
            return{x:center.x+(edge.x-center.x)*t,y:center.y+(edge.y-center.y)*t};
        },
        inverse(p){
            const ray=subtract(p,center);let boundary=null;
            if(Math.abs(ray.x)+Math.abs(ray.y)>1e-12)for(let i=0;i<4;i++){
                const start=subtract(q[i],center),edge=subtract(q[(i+1)%4],q[i]),den=cross(ray,edge);
                if(Math.abs(den)<1e-16)continue;
                const t=cross(start,edge)/den,s=cross(start,ray)/den;
                if(t>0&&s>=-1e-9&&s<=1+1e-9){boundary={t,u:uv[i].x+(uv[(i+1)%4].x-uv[i].x)*s,v:uv[i].y+(uv[(i+1)%4].y-uv[i].y)*s};break;}
            }
            if(boundary&&boundary.t<1)return{x:b.x+b.width*(.5+(boundary.u-.5)/boundary.t),y:b.y+b.height*(.5+(boundary.v-.5)/boundary.t)};
            let u=.5,v=.5;
            for(let i=0;i<20;i++){
                const at=bilinear(u,v),dx=at.x-p.x,dy=at.y-p.y;
                const ax=ux+wx*v,ay=uy+wy*v,bx=vx+wx*u,by=vy+wy*u,det=ax*by-ay*bx;
                const du=(dx*by-dy*bx)/det,dv=(ax*dy-ay*dx)/det;u-=du;v-=dv;
                if(Math.abs(du)+Math.abs(dv)<1e-12)break;
            }
            return{x:b.x+u*b.width,y:b.y+v*b.height};
        },
    };
}

export function createLayerMapping({transform=IDENTITY,warp}) {
    const inv=inverse(transform),mapping=warp?createWarpMapping(warp):null;
    const apply=(m,p)=>({x:m[0]*p.x+m[2]*p.y+m[4],y:m[1]*p.x+m[3]*p.y+m[5]});
    return {
        forward:p=>apply(transform,mapping?mapping.forward(p):p),
        inverse:p=>{const local=apply(inv,p);return mapping?mapping.inverse(local):local;},
    };
}

// Inverse extents of a document rectangle. Within the cage, coordinate level
// lines are straight; outside, each corner-ray sector is affine. Include
// intersections at both kinds of mapping boundary: cage edges and corner rays.
export function rasterAreaPoints(state,area) {
    const mapping=createLayerMapping(state),corners=rectangle(area),points=[...corners];
    if(state.warp){
        const warp=createWarpMapping(state.warp),center=transformPoint(state.transform,warp.center);
        for(const corner of state.warp.corners){
            const direction=subtract(transformPoint(state.transform,corner),center);
            for(let i=0;i<4;i++){
                const start=corners[i],edge=subtract(corners[(i+1)%4],start),den=cross(direction,edge);
                if(!den)continue;
                const delta=subtract(start,center),t=cross(delta,edge)/den,s=cross(delta,direction)/den;
                if(t>=0&&s>=0&&s<=1)points.push({x:center.x+direction.x*t,y:center.y+direction.y*t});
            }
        }
        const quad=state.warp.corners.map(p=>transformPoint(state.transform,p));
        for(let j=0;j<4;j++)for(let i=0;i<4;i++){
            const start=quad[j],direction=subtract(quad[(j+1)%4],start),edge=subtract(corners[(i+1)%4],corners[i]),den=cross(direction,edge);
            if(!den)continue;
            const delta=subtract(corners[i],start),t=cross(delta,edge)/den,s=cross(delta,direction)/den;
            if(t>=0&&t<=1&&s>=0&&s<=1)points.push({x:start.x+direction.x*t,y:start.y+direction.y*t});
        }
    }
    return points.map(mapping.inverse);
}

// Exact forward extrema: cage segments are bilinear on axis-aligned source
// edges and affine in each outside ray sector. Include every sector crossing.
export function mappedRasterBounds(layer,box={x:0,y:0,width:layer.width,height:layer.height}){
    const edges=rectangle(box),points=[...edges];
    if(layer.warp){const b=layer.warp.bounds,c={x:b.x+b.width/2,y:b.y+b.height/2};
        for(const corner of rectangle(b)){const dir=subtract(corner,c);for(let i=0;i<4;i++){const start=edges[i],edge=subtract(edges[(i+1)%4],start),den=cross(dir,edge);if(!den)continue;const delta=subtract(start,c),t=cross(delta,edge)/den,s=cross(delta,dir)/den;if(t>=0&&s>=0&&s<=1)points.push({x:c.x+dir.x*t,y:c.y+dir.y*t});}}
        for(const x of [b.x,b.x+b.width])if(x>=box.x&&x<=box.x+box.width)points.push({x,y:box.y},{x,y:box.y+box.height});
        for(const y of [b.y,b.y+b.height])if(y>=box.y&&y<=box.y+box.height)points.push({x:box.x,y},{x:box.x+box.width,y});
    }
    const mapping=createLayerMapping(layer),world=points.map(mapping.forward),x=Math.min(...world.map(p=>p.x)),y=Math.min(...world.map(p=>p.y));
    return{x,y,width:Math.max(...world.map(p=>p.x))-x,height:Math.max(...world.map(p=>p.y))-y};
}
