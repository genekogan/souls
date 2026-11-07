// Release packaging through the existing frozen frontend esbuild toolchain.
// Two dependency-free Node22 entrypoints; launcher resolves run.mjs beside it.
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {isRuntimeSource} from './build-inputs.mjs';
const root=realpathSync(resolve(dirname(fileURLToPath(import.meta.url)),'../..'));
const output=process.argv[2];if(!output)throw Error('Usage: node tools/soul-runtime/build.mjs ABSOLUTE_NEW_OUTPUT_DIR');
const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
if(git('status','--porcelain'))throw Error('Release packaging requires a clean source tree');
const source=git('rev-parse','HEAD'),out=resolve(output);mkdirSync(out,{recursive:false});
const require=createRequire(realpathSync(resolve(root,'apps/web/node_modules/vite/package.json'))),{build,version}=require('esbuild');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');const artifacts=[],inputs=new Map();
for(const file of ['run.mjs','launch.mjs']){
 const result=await build({absWorkingDir:root,entryPoints:['tools/soul-runtime/'+file],bundle:true,platform:'node',format:'esm',target:'node22',write:false,metafile:true,outfile:file,legalComments:'inline'});
 for(const path of Object.keys(result.metafile.inputs)){const absolute=realpathSync(resolve(root,path)),local=relative(root,absolute);if(!isRuntimeSource(local))throw Error('Unexpected runtime source: '+path);inputs.set(local,{path:local,sha256:sha(readFileSync(absolute))});}
 const bytes=result.outputFiles[0].contents;writeFileSync(resolve(out,file),bytes,{flag:'wx'});artifacts.push({file,bytes:bytes.length,sha256:sha(bytes)});
}
if(git('rev-parse','HEAD')!==source||git('status','--porcelain'))throw Error('Source changed during packaging');
const manifest={format:'sim-soul-runtime/1',version:'0.1.0',nodeMinimum:'22.20.0',host:'codex app-server (experimental)',source,esbuild:version,artifacts,inputs:[...inputs.values()]};
writeFileSync(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({source,output:out,artifacts}));
