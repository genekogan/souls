import { writeFileSync } from 'node:fs';
import { hashOf } from '@souls/engine-contract';
import { existingCommonsFixture } from './fixture.ts';
const output=await existingCommonsFixture();
writeFileSync(new URL('./journey.v1.json',import.meta.url),JSON.stringify(output)+'\n');
console.log(JSON.stringify({tick:output.finalTick,chunks:output.chunks.length,scenes:output.scenes.length,hash:hashOf(output),paidSpendUSD:0}));
