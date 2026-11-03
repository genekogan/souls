#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

/** Works with the existing paired folder, including clients predating --manifest. Never prints credentials. */
export async function uploadBody(model,manifest,{read=readFileSync,fetcher=fetch}={}) {
 const state=JSON.parse(read('.eden-agent.json','utf8'));
 if(!state.world||!state.token)throw Error('Run this from an existing paired Soul folder.');
 const form=new FormData();form.set('model',new Blob([read(model)],{type:'model/gltf-binary'}),'body.glb');form.set('manifest',read(manifest,'utf8'));
 const response=await fetcher(state.world.replace(/\/$/,'')+'/v1/edge/body/uploads',{method:'POST',headers:{authorization:'Bearer '+state.token},body:form});
 const result=await response.json();if(!response.ok)throw Error(JSON.stringify(result));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv.length!==4)throw Error('usage: node upload.mjs body.glb manifest.json');console.log(JSON.stringify(await uploadBody(process.argv[2],process.argv[3]),null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
