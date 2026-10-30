import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {startRuntimeApi} from "../src/api-server.js";
import {LayanXCore} from "../src/core/orchestrator.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-profile-api-"));
process.env.LAYANX_STORE_DIR=path.join(root,"store");
process.env.LAYANX_WORKSPACE_ROOT=path.join(root,"projects");
fs.mkdirSync(process.env.LAYANX_STORE_DIR,{recursive:true});
const core=new LayanXCore();
const server=startRuntimeApi({core,host:"127.0.0.1",port:0,token:"test-profile-token"} as never);
await new Promise<void>(resolve=>server.on("listening",resolve));
const address=server.address();
assert.ok(address&&typeof address!=="string");
const base="http://127.0.0.1:"+address.port+"/v1/supervisor/jobs";
const headers={"content-type":"application/json","authorization":"Bearer test-profile-token"};
const request=(data:unknown)=>fetch(base,{method:"POST",headers,body:JSON.stringify(data)});
try{
  const unauth=await fetch(base,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({goal:"Create a task app"})});
  assert.equal(unauth.status,401);
  const invalid=await request({goal:"Create a task app",acceptanceProfile:"skip-validation"});
  assert.equal(invalid.status,422);
  const denied=await invalid.json() as {error:string};
  assert.match(denied.error,/unsupported_acceptance_profile/);
  const valid=await request({goal:"Create a task app with persistent tasks",projectId:"acceptance-api",acceptanceProfile:"task-app-http-v1"});
  assert.equal(valid.status,201);
  const created=await valid.json() as {job:{id:string;acceptanceProfile?:string;projectId:string}};
  assert.equal(created.job.acceptanceProfile,"task-app-http-v1");
  assert.equal(created.job.projectId,"acceptance-api");
  const detail=await fetch(base+"/"+encodeURIComponent(created.job.id),{headers});
  assert.equal(detail.status,200);
  const stored=await detail.json() as {job:{acceptanceProfile?:string}};
  assert.equal(stored.job.acceptanceProfile,"task-app-http-v1");
  const ordinary=await request({goal:"Read workspace status",projectId:"default"});
  assert.equal(ordinary.status,201);
  assert.equal((await ordinary.json() as {job:{acceptanceProfile?:string}}).job.acceptanceProfile,undefined);
  console.log("supervisor acceptance API: allowlisted profile, auth, rejection, persistence passed");
}finally{
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  fs.rmSync(root,{recursive:true,force:true});
}
process.exit(0);
