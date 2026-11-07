// Frozen v1 bytes stay intact. Prove one shared hand-operation on a door and a gate.
import vocab from './vocab.json' with {type:'json'};
import civic from './civic.json' with {type:'json'};
import vocabW3 from './vocab-w3.json' with {type:'json'};
import type {DefInput} from '../schemas.ts';
const door=vocab.find(d=>d.name==='core-door')! as unknown as DefInput;
export const HAND_OPENINGS:DefInput[]=[door,civic.find(d=>d.name==='core-gate')! as unknown as DefInput].map(input=>{
  const d=structuredClone(input),gate=d.name==='core-gate',hinge=gate?-.56:-.5;
  const make=d.make as {kind:'gen';gen:string;args:{shapes:{role?:string;pivot?:number[]}[]}};
  for(const shape of make.args.shapes)if(shape.role==='door')shape.pivot=[hinge,0,0];
  return {...d,version:2,tags:[...(d.tags??[]),'hand-operated'],description:`${d.description} A Soul approaches and operates it by hand.`,
    actions:door.actions!.filter(a=>['open','close'].includes(a.name)).map(a=>({...structuredClone(a),label:a.label.replace('door',gate?'gate':'door')}))};
});

/** A reachable casement reuses the same opening contact; the sill is above the standing floor. */
const windowInput=structuredClone(vocab.find(d=>d.name==='core-window')!) as unknown as DefInput;
const windowMake=windowInput.make as {kind:'gen';gen:string;args:{shapes:Record<string,unknown>[]}};
for(const shape of windowMake.args.shapes){
  if(['box','leaf','bloom'].includes(String(shape.tint))&&(shape.at as number[]|undefined)) (shape.at as number[])[2]*=-1;
  if(shape.tint==='sill'){(shape.at as number[])[2]=0;(shape.size as number[])[2]=.18;}
  if(shape.role==='door'&&shape.tint==='frame'&&shape.kind==='box'){(shape.at as number[])[2]=.02;(shape.size as number[])[2]=.02;}
  if(shape.tint==='frame'&&shape.kind==='extrude')shape.round=0;
}
windowInput.params!.variant={type:'enum',values:['square','arched'],default:'square',doc:'style variant'};
windowMake.args.shapes.push({kind:'sphere',at:[.34,.65,.08],r:.035,segments:8,tint:'brass',role:'door',pivot:[-.44,.65,.02]});
HAND_OPENINGS.push({...windowInput,version:2,tags:[...(windowInput.tags??[]),'hand-operated','wall-window'],description:'An inward-opening casement with an interior handle, a sill and an exterior flower box. A Soul approaches the reachable interior handle while standing on the floor. Square and arched variants.'});
// Soul Actions entry 32: a lockable hand-operated door. door@2 plus a lock (front: brass escutcheon and keyhole, where the
// owner's key turns; back: a rim lock with a thumb-turn and a bolt that slides across into a keeper on the frame), a knob
// on both faces, and lock / unlock / knock. Its front (+z, where the leaf swings) faces out; the back is the inside.
// The lock's moving parts (roles bolt, thumb, key) ride on the leaf; the viewer turns and slides them with the hand.
const door2=HAND_OPENINGS[0]!,brass='brass',iron='#34302b',dark='#17140f',leaf={role:'door' as const,pivot:[-.5,0,0]};
const lockShapes=[
  {kind:'sphere',at:[.38,1.04,-.07],r:.035,segments:5,tint:brass,...leaf},
  {kind:'box',at:[.38,.9,.034],size:[.045,.085,.008],round:0,tint:brass,...leaf},
  {kind:'box',at:[.38,.893,.0385],size:[.01,.032,.002],round:0,color:dark,...leaf},
  {kind:'box',at:[.375,.9,-.047],size:[.13,.1,.034],round:0,color:iron,...leaf},
  {kind:'sphere',at:[.35,.9,-.066],r:.019,segments:6,scale:[1,1,.45],tint:brass,...leaf},
  {kind:'box',at:[.35,.9,-.075],size:[.013,.046,.014],round:0,tint:brass,role:'thumb',pivot:[.35,.9,-.075]},
  {kind:'box',at:[.44,.91,-.047],size:[.04,.022,.018],round:0,tint:brass,role:'bolt',pivot:[.44,.91,-.047]},
  {kind:'box',at:[.38,.9,.052],size:[.007,.007,.03],round:0,tint:brass,role:'key',pivot:[.38,.9,.04]},
  {kind:'box',at:[.38,.9,.071],size:[.034,.022,.006],round:0,tint:brass,role:'key',pivot:[.38,.9,.04]},
  {kind:'box',at:[.535,.91,-.047],size:[.04,.05,.034],round:0,color:iron},
];
const vocabDoor=vocab.find(d=>d.name==='core-door')! as unknown as DefInput;
export const LOCKABLE_DOOR:DefInput=(()=>{const d=structuredClone(door2) as DefInput&{make:{args:{shapes:unknown[]}}};
  d.make.args.shapes=[...d.make.args.shapes,...structuredClone(lockShapes)];
  return {...d,version:3,tags:[...(d.tags??[]).filter(t=>t!=='hand-operated'),'hand-operated','lockable'],
    description:`${vocabDoor.description} A Soul approaches and operates it by hand; its owner locks it with a key from outside or the thumb-turn inside, anyone inside can always open it with the thumb-turn, and a Soul outside can knock.`,
    actions:[...structuredClone(vocabDoor.actions!),{name:'knock',label:'Knock on the door',roles:'anyone',reach:'touch',params:{},when:[{field:'open',is:false}],then:[{op:'set',field:'open',value:false}]}]} as DefInput;})();
// Openings family (#427), entry 1. A tent flap a Soul fastens and unfastens by hand: core-tent@1 plus a doorway pole on
// the flap's free side with a toggle (tinted `valve`, where the hand goes). It is the drawn covering's contact (curtains,
// entry 23): no hinge component, so the tent gains no door solid; at the toggle's contact the flap swings on its pivot.
const tentInput=vocabW3.find(d=>d.name==='core-tent')! as unknown as DefInput;
export const TENT_FLAP:DefInput=(()=>{const d=structuredClone(tentInput) as DefInput&{make:{args:{shapes:unknown[]}};params:Record<string,unknown>;palette:Record<string,string>};
  // the pole stands just in front of the canvas's front edge (z 1.2), so it never pokes through the sloped side
  d.make.args.shapes.push({kind:'cyl',at:[.5,.56,1.24],r:.02,h:1.12,segments:5,tint:'pole'},
    {kind:'cyl',at:[.47,.85,1.21],r:.012,h:.07,segments:5,tint:'valve',roll:Math.PI/2});
  d.params.valve={type:'color',default:'#e8dcc0',doc:'valve colour (the flap toggle; the hand goes here)'};d.palette.valve='#e8dcc0';
  return {...d,version:2,tags:[...(d.tags??[]),'hand-operated'],
    description:`${tentInput.description} A Soul opens and closes the flap by hand at the toggle on its doorway pole.`} as DefInput;})();
// A five-bar wooden field gate (a 1.3 m leaf between two posts, a diagonal brace, a galvanised latch on its free end): the
// hinge contact of core-gate@2 with data only (the `opening` component, the leaf's pivot, the latch where the hand goes).
const bar=(y:number)=>({kind:'box',at:[0,y,0],size:[1.3,.085,.04],round:0,tint:'leaf',role:'door',pivot:[-.66,0,0]});
export const FIELD_GATE:DefInput={schema:'def/1',name:'core-field-gate',version:1,
  description:'A five-bar wooden field gate between two posts (a 1.3 m leaf with a diagonal brace). A Soul approaches, lifts the latch on its free end and swings it open or shut by hand; shut, it closes its gap.',
  tags:['civic','gate','fence','garden','farm','door','hand-operated','local-fixture'],form:'point',
  make:{kind:'gen',gen:'kit/2',args:{round:.01,shapes:[
    {kind:'box',at:[-.73,.66,0],size:[.12,1.32,.12],round:.01,tint:'post'},
    {kind:'box',at:[.73,.66,0],size:[.12,1.32,.12],round:.01,tint:'post'},
    ...[.2,.42,.64,.86,1.08].map(bar),
    {kind:'box',at:[-.61,.64,.035],size:[.08,.98,.03],round:0,tint:'leaf',role:'door',pivot:[-.66,0,0]},
    {kind:'box',at:[.61,.64,.035],size:[.08,.98,.03],round:0,tint:'leaf',role:'door',pivot:[-.66,0,0]},
    {kind:'box',at:[0,.64,-.03],size:[1.38,.07,.025],round:0,roll:-.66,tint:'leaf',role:'door',pivot:[-.66,0,0]},
    {kind:'box',at:[.6,.98,.075],size:[.12,.035,.03],round:0,tint:'chrome',role:'door',pivot:[-.66,0,0]},
  ]}},
  params:{post:{type:'color',default:'#7a5c3e',doc:'post colour'},leaf:{type:'color',default:'#b08d62',doc:'leaf colour'},chrome:{type:'color',default:'#9aa0a3',doc:'chrome colour (the galvanised latch; the hand goes here)'}},
  palette:{post:'#7a5c3e',leaf:'#b08d62',chrome:'#9aa0a3'},
  state:{open:{type:'bool',default:false}},components:{opening:{width:1.3,height:1.1,state:'closed'}},size:{box:[1.58,1.32,.2]},
  actions:door.actions!.filter(a=>['open','close'].includes(a.name)).map(a=>({...structuredClone(a),label:a.label.replace('door','gate')})),
} as unknown as DefInput;
HAND_OPENINGS.push(TENT_FLAP,FIELD_GATE);
