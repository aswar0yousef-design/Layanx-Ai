import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {startRuntimeApi} from "../src/api-server.js";
import {LayanXCore} from "../src/core/orchestrator.js";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-dialogue-api-"));
process.env.LAYANX_STORE_DIR=path.join(root,"store");
process.env.LAYANX_WORKSPACE_ROOT=path.join(root,"projects");
fs.mkdirSync(process.env.LAYANX_STORE_DIR,{recursive:true});
const core=new LayanXCore();
const server=startRuntimeApi({core,host:"127.0.0.1",port:0,token:"test-dialogue-secret"} as never);
await new Promise<void>(resolve=>server.on("listening",resolve));
const address=server.address();assert.ok(address&&typeof address!=="string");
const url="http://127.0.0.1:"+address.port+"/v1/assistant/classify";
const headers={"content-type":"application/json","authorization":"Bearer test-dialogue-secret"};
const post=(text:string,withAuth=true)=>fetch(url,{method:"POST",
 headers:withAuth?headers:{"content-type":"application/json"},body:JSON.stringify({text})});
try{
 assert.equal((await post("من أنت؟",false)).status,401);
 for(const [text,kind,topic] of [
  ["من أنت؟","conversation","identity"],
  ["هل تتعلم وتطور من نفسك؟","conversation","self-development"],
  ["كيف تعمل خاصية التداول؟","conversation","question"],
  ["أنشئ تطبيق مهام","action","instruction"],
  ["افتح المتصفح","action","instruction"]
 ]){
  const response=await post(text);assert.equal(response.status,200,text);
  const body=await response.json() as {ok:boolean;kind:string;topic:string};
  assert.equal(body.ok,true);assert.equal(body.kind,kind,text);assert.equal(body.topic,topic,text);
 }
 assert.equal((await post("")).status,422);
 assert.equal((await post("a".repeat(4100))).status,422);
 assert.equal(core.missions.list().length,0,"Classifying must never create a mission");
 console.log("dialogue classification API: authentication, question/action separation, no side effects");
}finally{
 await new Promise<void>(resolve=>server.close(()=>resolve()));
 fs.rmSync(root,{recursive:true,force:true});
}
process.exit(0);
