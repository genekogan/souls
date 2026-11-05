// Finite one-pull bell. Frozen bell@1 retains its original play/stop contract.
import layers from './vocab-w2.json' with {type:'json'};
import type {DefInput} from '../schemas.ts';
const old=structuredClone(layers.find(d=>d.name==='core-bell')!) as unknown as DefInput;
const args=old.make.kind==='gen'?old.make.args as {shapes:Record<string,unknown>[]}:{shapes:[]};
export const HAND_BELL:DefInput={...old,version:2,description:'A bronze bell in a timber frame. Grasp and pull its rope once to ring it; repeat the ring action whenever needed. The arm and rope return to rest.',tags:[...(old.tags??[]),'hand-rung','local-fixture'],
 make:{kind:'gen',gen:'kit/2',args:{...args,shapes:args.shapes.map(s=>s.tint==='rope'?{kind:'cyl',at:[.375,1.475,.075],r:.012,h:.45,segments:5,tint:'rope',role:'rope',pivot:[.375,1.7,.075]}:s).concat([{kind:'sweep',at:[0,0,0],path:[[0,1.42,0],[.375,1.7,.075]],r:.012,segments:5,tint:'rope'},{kind:'sweep',at:[0,0,0],path:[[.6,1.7,0],[.375,1.7,.075]],r:.02,segments:5,tint:'iron'},{kind:'sphere',at:[.375,1.7,.075],r:.027,segments:6,tint:'iron'}])}},
 state:{rings:{type:'int',min:0,max:1000000000,default:0}},
 components:{...old.components,bell:{gripAt:[.375,1.25,.075],pullAngle:.4},sound:{kind:'bell',radius:40,volume:.7,when:'rings',mode:'change'}},
 actions:[{name:'ring',label:'Pull the bell rope once',roles:'anyone',reach:'touch',params:{},when:[{field:'rings',not:1000000000}],then:[{op:'increment',field:'rings',by:1}]}]};
// #494 / #416: bell@2 above is immutable (worlds keep its geometry); @3 is @2 within the 400-triangle budget as drawn.
// @2's two straight sweeps (the rope from the clapper to the pull arm, and the arm) drew as 16-ring tubes, 80 triangles
// each; @3 draws them as the same straight rods, 5-sided cylinders between the same end points. The moving rope (role
// rope), the grip and every other field are @2's.
const rod3=(a:number[],b:number[],r:number,tint:string)=>{const d=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],len=Math.hypot(...d);
 // the kit cylinder's axis is +y, turned by pitch (about x) then yaw (about y): +y goes to (sin p sin y, cos p, sin p cos y)
 return {kind:'cyl',at:[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2],r,h:len,segments:5,tint,pitch:Math.acos(d[1]/len),yaw:Math.atan2(d[0],d[2]),collide:false};};
const bell2=structuredClone(HAND_BELL) as DefInput&{make:{args:{shapes:Record<string,unknown>[]}}};
bell2.make.args.shapes=bell2.make.args.shapes.map(s=>s.kind==='sweep'?rod3((s.path as number[][])[0],(s.path as number[][])[1],s.r as number,s.tint as string):s);
export const HAND_BELL_3:DefInput={...bell2,version:3};
