import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {startRuntimeApi} from "../src/api-server.js";
import {LayanXCore} from "../src/core/orchestrator.js";
import type {SupervisorJob} from "../src/autonomy/supervisor.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-reconcile-api-"));
process.env.LAYANX_STORE_DIR=path.join(root,"store");
process.env.LAYANX_WORKSPACE_ROOT=path.join(root,"projects");
fs.mkdirSync(process.env.LAYANX_STORE_DIR,{recursive:true});
fs.mkdirSync(process.env.LAYANX_WORKSPACE_ROOT,{recursive:true});
const now=new Date().toISOString();
const id="a0000000-0000-4000-a000-000000000042";
const job:SupervisorJob={
  id,projectId:"recover",goal:"Create a local test app",status:"running",
  createdAt:now,updatedAt:now,deadline:new Date(Date.now()+120000).toISOString(),
  trust:"supervised",acceptance:["Runs"],checks:null,
  milestones:[{title:"Create",goal:"Generate files",kind:"code",agent:"coder",status:"running",attempts:1,missions:[]}],
  current:0,rounds:1,maxRounds:10,
  cloudUsed:false,externalUsed:[],checkpoints:[],log:[],finalRepairs:0
};
fs.writeFileSync(path.join(process.env.LAYANX_STORE_DIR,"supervisor-jobs.json"),JSON.stringify([job]));
const server=startRuntimeApi({core:new LayanXCore(),host:"127.0.0.1",port:0,token:"test-recovery-token"} as never);
await new Promise<void>(resolve=>server.on("listening",resolve));
const address=server.address();assert.ok(address&&typeof address!=="string");
const base="http://127.0.0.1:"+address.port+"/v1/supervisor/jobs/"+id;
const headers={authorization:"Bearer test-recovery-token","content-type":"application/json"};
const post=(route:string,data:unknown,h=headers)=>fetch(base+route,{method:"POST",headers:h,body:JSON.stringify(data)});
try{
  assert.equal((await fetch(base)).status,401);
  const response=await fetch(base,{headers});
  assert.equal(response.status,200);
  const loaded=await response.json() as {job:{status:string;recoveryHold?:{kind:string}}};
  assert.equal(loaded.job.status,"failed");
  assert.equal(loaded.job.recoveryHold?.kind,"interrupted-milestone");
  const directResume=await post("/resume",{});
  assert.equal(directResume.status,422);
  assert.match(JSON.stringify(await directResume.json()),/recovery_reconciliation_required/);
  const withoutAck=await post("/reconcile",{decision:"retry"});
  assert.equal(withoutAck.status,422);
  assert.match(JSON.stringify(await withoutAck.json()),/recovery_acknowledgement_required/);
  assert.equal((await post("/reconcile",{decision:"unrecognized",acknowledgeUnknownEffects:true})).status,422);
  const result=await post("/reconcile",{decision:"abort",acknowledgeUnknownEffects:true});
  assert.equal(result.status,200);
  const body=await result.json() as {job:{status:string;recoveryHold?:unknown}};
  assert.equal(body.job.status,"cancelled");
  assert.ok(body.job.recoveryHold);
  assert.equal((await post("/resume",{})).status,422);
  console.log("supervisor reconciliation API: auth, fail-closed resume, explicit ack, invalid decision, abort");
}finally{
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  fs.rmSync(root,{recursive:true,force:true});
}
process.exit(0);
