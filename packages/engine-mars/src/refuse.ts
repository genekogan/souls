// #1150 rung 1 (design note on the issue): a body's move that would break a rule is not applied. The engine checks at the end
// of its own step and undoes it there, so the decision reads only world state and the rules version: replay, restart and
// read workers all make the same one. What can't be undone from a pose copy (support, connections) goes to the host's repair.
export const SOULS_REPAIR_POLICY='souls-repair/1';
/** A programme refused this many times inside the window is past refusing: its cleanup keeps breaking the rule (rung 2). */
export const REFUSALS_ALLOWED=2,REFUSAL_WINDOW_TICKS=100;
const WHY:Readonly<Record<string,string>>={
  'collision.human-static':'it would have put you inside something solid',
  'collision.human-human':'it would have walked you into someone',
  'collision.human-load':'it would have walked you into a carried load',
  'motion.overspeed':'it would have moved you faster than a body can go',
  'motion.teleport':'it would have jumped you across the ground',
  'carry.load-static':'it would have pushed the load into something solid',
  'lift.hands-out-of-reach':'it would have taken the load out of reach of your hands',
};
export const refusableRule=(code:string)=>Object.hasOwn(WHY,code);
export const refusalDiag=(rule:string)=>({code:`world.refused:${rule}`,message:`Your action stopped: ${WHY[rule]}. Nothing else changed.`});
/** Decision 1 on #1150: the world landed on a body, so there is no pose to go back to. The one named exception to "never teleport". */
export const relocationDiag={code:'world.relocated',message:'The world changed where you stood, so you were moved to the nearest free spot. Nothing else changed.'};
