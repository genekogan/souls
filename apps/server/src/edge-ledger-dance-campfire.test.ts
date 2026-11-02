import test from 'node:test';
import assert from 'node:assert/strict';
import {edenNavWorld} from '../test/eden-nav-fixture.ts';

test('ten native Souls walk to the Commons fire circle then dance together without relocating', {timeout:900000}, async t=>{
  const w=await edenNavWorld(10,{diagnosticSoulIds:Array.from({length:10},(_,i)=>'s_'+(i+1).toString(16).padStart(10,'0'))});
  t.after(()=>{w.f.host.stop();w.f.db.close();});
  const walks=[];
  for(const soul of w.souls){const out:any=await w.act(soul,'walk:social-eden-fire-circle');assert.equal(out.accepted,true);walks.push({soulId:soul.soulId,id:out.receipt.id});}
  await w.run(walks,12000);
  for(const walk of walks)assert.equal(w.ledger.receipt(walk.soulId,walk.id)!.phase,'completed');
  const positions=w.souls.map(s=>[...w.engine.world.entities[s.entityId].pose.p]);
  const clearance=positions.map(at=>w.engine.clearanceAtV1(at[0],at[2]));
  assert.ok(clearance.some(c=>c>=.28&&c<.38),'actual walk arrival uses ordinary standing clearance');
  for(const soul of w.souls){
    assert.equal(w.ledger.capabilities(soul).find(c=>c.id==='dance:here')!.available,true);
    const out:any=await w.act(soul,'dance here',{seconds:5});assert.equal(out.accepted,true,JSON.stringify(out));
  }
  let allDancing=false;
  for(let tick=0;tick<160;tick++){
    w.f.host.tickOnce();allDancing ||= w.souls.every(s=>w.engine.world.entities[s.entityId].human.activity==='dance');
    for(let i=0;i<w.souls.length;i++)assert.deepEqual(w.engine.world.entities[w.souls[i].entityId].pose.p,positions[i]);
  }
  assert.ok(allDancing);assert.deepEqual(w.engine.runtime.violations,[]);
  t.diagnostic(JSON.stringify({souls:10,clearance,positionsChanged:0,allDancing}));
});
