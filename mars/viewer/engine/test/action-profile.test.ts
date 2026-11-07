import test from 'node:test';import assert from 'node:assert/strict';
import {ROLLING_GRIPPER,QUADRUPED_TORSO,ACTION_PROFILES,isActionProfile,hasRollingProfile,hasDeclaredProfile,rollingActionProblem,profileActionProblem,ROLLING_ACTIONS,QUADRUPED_ACTIONS} from '../bodies/action-profile.ts';
import {admitFloaters} from '../bodies/policy.ts';

test('quadruped-torso/1 is additive: rolling-gripper/1 wording and disposition are unchanged',()=>{
 assert.deepEqual(ACTION_PROFILES,[ROLLING_GRIPPER,QUADRUPED_TORSO]);assert.ok(isActionProfile(QUADRUPED_TORSO)&&!isActionProfile('invented/1'));
 const pip={actionProfile:ROLLING_GRIPPER},centaur={actionProfile:QUADRUPED_TORSO};
 assert.ok(hasRollingProfile(pip)&&!hasRollingProfile(centaur)&&hasDeclaredProfile(centaur)&&!hasDeclaredProfile({})&&!hasDeclaredProfile(undefined));
 // The exact pre-#723 rolling strings.
 assert.equal(rollingActionProblem('sit',undefined,'edge'),'This rolling body has no admitted sit adapter; use ground movement, upright standby, dance or its grippers.');
 assert.equal(rollingActionProblem('mars:walk_to',{gait:'run'}),'This rolling body uses its ground rolling adapter, not cycling or an unqualified running gait.');
 assert.equal(rollingActionProblem('pose_v1',{activity:'nap'}),'This rolling body cannot sit, lie prone or use an unqualified pose/prop; use upright standby or an admitted standing gesture.');
 assert.equal(rollingActionProblem('body_motion_v1',{motion:'dance'}),'This rolling profile uses its authored standing dance clip; only upright rest uses body motion.');
 assert.equal(profileActionProblem(pip,'sit',undefined,'edge'),rollingActionProblem('sit',undefined,'edge'));
 assert.deepEqual([...QUADRUPED_ACTIONS.edge],[...ROLLING_ACTIONS.edge]);assert.deepEqual([...QUADRUPED_ACTIONS.native],[...ROLLING_ACTIONS.native]);
});

test('quadruped-torso/1 refuses seats, prone poses, swimming, rides, running and unknown actions, with its own words',()=>{
 const c={actionProfile:QUADRUPED_TORSO};
 for(const verb of ['sit','sit-ground','swim','ride','board','mount','eat','drink','hug','high-five','dance-with','jump','unregistered_future_verb'])assert.match(profileActionProblem(c,verb,undefined,'edge')??'',/^This four-legged body has no admitted .* adapter; use ground movement, upright standby, dance or its hands\.$/,verb);
 for(const verb of ['go','walk','stand','face','dance','rest','lie','nap','standby','pick-up','put-down','put-on','wave'])assert.equal(profileActionProblem(c,verb,undefined,'edge'),null,verb);
 assert.equal(profileActionProblem(c,'walk_to',{gait:'cycle'}),'This four-legged body uses its walking gait adapter, not cycling or an unqualified running gait.');
 assert.equal(profileActionProblem(c,'walk_to',{gait:'walk'}),null);
 assert.match(profileActionProblem(c,'pose_v1',{activity:'sit-ground'})??'',/^This four-legged body cannot sit, lie prone/);
 assert.match(profileActionProblem(c,'pose_v1',{activity:'wave',base:'sit'})??'',/cannot sit/);
 assert.equal(profileActionProblem(c,'pose_v1',{activity:'dance'}),null);
 assert.match(profileActionProblem(c,'body_motion_v1',{motion:'dance'})??'',/^This four-legged profile uses its authored standing dance clip/);
 assert.equal(profileActionProblem(c,'body_motion_v1',{motion:'rest'}),null);
 assert.equal(profileActionProblem(c,'swim_to',{}),'This four-legged body has no admitted swim_to adapter; use ground movement, upright standby, dance or its hands.');
});

test('native admission refuses a declared-profile body anywhere in the params, and leaves humanoids alone',()=>{
 const bodies:Record<string,any>={c:{family:'humanoid',type:'humanoid',actionProfile:QUADRUPED_TORSO,modelUrl:'/m.glb'},h:undefined};
 const at=admitFloaters('sit',{actor:'c'},id=>bodies[id]);assert.equal(at.status,'refuses');assert.equal(at.reason,'body.unsupported');assert.match(at.note??'',/four-legged/);
 assert.equal(admitFloaters('sit',{actor:'h'},id=>bodies[id]).status==='refuses'&&admitFloaters('sit',{actor:'h'},id=>bodies[id]).reason==='body.unsupported',false);
 assert.notEqual(admitFloaters('walk_to',{actor:'c',to:[1,1]},id=>bodies[id]).reason,'body.unsupported');
});
