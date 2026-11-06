import assert from "node:assert/strict";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createFileWriteToolAdapter} from "../src/tools/fabric.js";
import type {ToolRequest} from "../src/core/types.js";

const root=await mkdtemp(join(tmpdir(),"layanx-package-manifest-"));
const request:ToolRequest={missionId:"manifest-test",agentId:"core",projectId:"project",
 tool:"files.write",action:"write file",permission:"L3_MODIFY",idempotencyKey:"manifest-test"};
const write=createFileWriteToolAdapter({root});
try{
 const file=join(root,"project","package.json");
 await assert.rejects(()=>write.execute({...request,payload:{path:"package.json",content:""}}),
  /valid, non-empty JSON/,"The agent must not write a blank package manifest");
 await assert.rejects(()=>write.execute({...request,payload:{path:"package.json",content:"{invalid"}}),
  /valid, non-empty JSON/);
 await assert.rejects(()=>readFile(file,"utf8"),{code:"ENOENT"});
 const valid='{"name":"acceptance-app","type":"module","scripts":{"test":"node --test"}}';
 await write.execute({...request,payload:{path:"package.json",content:valid}});
 await assert.rejects(()=>write.execute({...request,payload:{path:"package.json",content:""}}),
  /valid, non-empty JSON/);
 assert.equal(await readFile(file,"utf8"),valid,"Rejected rewrite must preserve last valid manifest");
 await assert.rejects(()=>write.execute({...request,payload:{path:"src/server.mjs",content:""}}),
  /Source file content must not be empty/,"A blank ESM module must not be created");
 await write.execute({...request,payload:{path:"src/server.mjs",content:"export const ready=true;\n"}});
 await assert.rejects(()=>write.execute({...request,payload:{path:"src/server.mjs",content:"  \n"}}),
  /Source file content must not be empty/,"A whitespace-only rewrite must not replace working code");
 assert.equal(await readFile(join(root,"project","src","server.mjs"),"utf8"),"export const ready=true;\n");
}finally{await rm(root,{recursive:true,force:true});}
console.log("Package manifest guard: malformed JSON cannot corrupt generated project");
