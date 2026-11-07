import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaultCommand,forkCommand} from './children.mjs';
import {forkOptions} from './fork-world.mjs';

test('new and forked worlds receive independent controller and legacy CLI paths',()=>{
 const dir=mkdtempSync(join(tmpdir(),'souls-controller-child-'));
 const legacy=join(dir,'eden-agent.mjs'),current=join(dir,'eden.mjs');writeFileSync(legacy,'// legacy');writeFileSync(current,'// current');
 const o={soulCliFile:legacy,soulControllerCliFile:current,publicOrigin:'https://sim.example.test',auth:{envFile:join(dir,'unused-env-file'),registryPath:join(dir,'unused-registry')}};
 const world={slug:'mars',dataDir:dir,fork:{descriptor:join(dir,'unused-descriptor'),accounts:join(dir,'unused-accounts')}};
 for(const command of [defaultCommand(world,5968,o),forkCommand(world,5968,o)]){
  assert.equal(command.env.EDGE_CLI_FILE,legacy);assert.equal(command.env.EDGE_CONTROLLER_CLI_FILE,current);
 }
 const cfg=forkOptions({worldKey:'mars',worldId:'mars-2026-1'}, {WORLD_PATH:'/worlds/w/mars',PORT:'5968',DATA_DIR:dir,PUBLIC_URL:o.publicOrigin,EDGE_CLI_FILE:legacy,EDGE_CONTROLLER_CLI_FILE:current},dir);
 assert.equal(cfg.cliFile,legacy);assert.equal(cfg.controllerCliFile,current);
 const absent=defaultCommand(world,5968,{...o,soulControllerCliFile:join(dir,'missing.mjs')});
 assert.equal(absent.env.EDGE_CONTROLLER_CLI_FILE,undefined);assert.equal(absent.env.EDGE_CLI_FILE,legacy);
});
