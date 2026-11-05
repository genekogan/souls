#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {BODY_UPLOAD_POLICY,validateUpload} from './upload-validation.ts';
import {bindBodyDefinition,admitBodyGLB} from './admission.ts';

try {
 const [model,manifest]=process.argv.slice(2);if(!model||!manifest||process.argv.length!==4)throw Error('usage: node validate.mjs body.glb manifest.json');
 const definition=JSON.parse(readFileSync(manifest,'utf8')),bound=bindBodyDefinition(readFileSync(model),definition);
 const normalized=validateUpload(bound,BODY_UPLOAD_POLICY);
 const admitted=admitBodyGLB(Buffer.from(normalized.bytes),definition);
 console.log(JSON.stringify({valid:true,admitted},null,2));
} catch(e){console.error(JSON.stringify({valid:false,error:{code:e.code??'body.local-validation',message:e.message,...(e.details?{details:e.details}:{})}}));process.exitCode=1;}
