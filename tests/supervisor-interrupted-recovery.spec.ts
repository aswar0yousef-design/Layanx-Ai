import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Supervisor,type SupervisorDeps} from "../src/autonomy/supervisor.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-recovery-"));
process.env.LAYANX_STORE_DIR=path.join(root,"store");
process.env.LAYANX_WORKSPACE_ROOT=path.join(root,"projects");
fs.mkdirSync(path.join(process.env.LAYANX_WORKSPACE_ROOT,"recover"),{recursive:true});
let calls=0,release!:()=>void;
const pending=new Promise<void>(resolve=>{release=resolve;});
const deps:SupervisorDeps={
  async think(){return JSON.stringify({acceptance:["Project updated"],milestones:[{title:"Modify",goal:"Edit project",kind:"code"}],
    checks:{test:false,build:false,install:false,security:false,browser:null}});},
  async runAgent(){calls++;if(calls===1)await pending;return{completed:true,missionId:"test-mission-"+calls};},
  async resumeAgent(){throw Error("Should not automatically replay an approval");},
  async runTool(){return{ok:true,data:{ok:true,exitCode:0}};},
  isApproved:()=>false,cloudAvailable:()=>false,externalAgent:()=>null,
  detect:()=>null
};
async function until(pred:()=>boolean,ms=7000){
  const end=Date.now()+ms;while(!pred()){if(Date.now()>end)throw Error("timeout");await new Promise(r=>setTimeout(r,10));}
}
const file=path.join(root,"inflight.json");
const initial=new Supervisor(deps,{file,pollMs:5});
try{
  const job=initial.create("Modify project safely","recover");
  await until(()=>{
    const stored=JSON.parse(fs.readFileSync(file,"utf8")) as Array<{milestones:{status:string}[];status:string}>;
    return calls===1&&stored[0]?.status==="running"&&stored[0]?.milestones[0]?.status==="running";
  });
  const state=fs.readFileSync(file,"utf8");
  const restartFile=path.join(root,"restart.json");
  fs.writeFileSync(restartFile,state);
  const restarted=new Supervisor(deps,{file:restartFile,pollMs:5});
  restarted.start();
  await until(()=>restarted.get(job.id)?.status==="failed");
  const held=restarted.get(job.id)!;
  assert.equal(held.recoveryHold?.kind,"interrupted-milestone");
  assert.match(held.result||"",/Review required/);
  assert.equal(calls,1,"A restart must not replay an in-flight mission");
  assert.throws(()=>restarted.resume(job.id),/recovery_reconciliation_required/);
  const stored=JSON.parse(fs.readFileSync(restartFile,"utf8")) as Array<{recoveryHold?:unknown;status:string}>;
  assert.equal(stored[0]?.status,"failed");
  assert.ok(stored[0]?.recoveryHold,"Hold must survive another restart");
  const again=new Supervisor(deps,{file:restartFile,pollMs:5});
  again.start();
  assert.equal(again.get(job.id)?.status,"failed");
  assert.equal(calls,1);
  assert.throws(()=>again.reconcile(job.id,"unexpected" as "retry"),/invalid_recovery_decision/);
  const stopped=again.reconcile(job.id,"abort");
  assert.equal(stopped.status,"cancelled");
  assert.ok(stopped.recoveryHold);
  assert.throws(()=>again.resume(job.id),/recovery_reconciliation_required/);
  restarted.stop();again.stop();
  const retryFile=path.join(root,"retry.json");
  fs.writeFileSync(retryFile,state);
  const retry=new Supervisor(deps,{file:retryFile,pollMs:5});
  retry.start();
  assert.equal(retry.get(job.id)?.status,"failed");
  retry.reconcile(job.id,"retry");
  await until(()=>calls>=2);
  assert.equal(retry.get(job.id)?.recoveryHold,undefined);
  assert.equal(retry.get(job.id)?.resumed,1);
  retry.stop();
  const approvalFile=path.join(root,"approval.json");
  const approval=JSON.parse(state) as Array<Record<string,unknown>>;
  approval[0]!.status="waiting_approval";
  approval[0]!.waiting={approvalId:"approval-123",missionId:"mission-123",index:0,kind:"agent",milestone:0,agentId:"coder"};
  fs.writeFileSync(approvalFile,JSON.stringify(approval));
  const waiting=new Supervisor(deps,{file:approvalFile,pollMs:5});
  waiting.start();
  await new Promise(r=>setTimeout(r,50));
  assert.equal(waiting.get(job.id)?.status,"waiting_approval","Recorded approval must survive restart");
  assert.equal(waiting.get(job.id)?.recoveryHold,undefined);
  waiting.stop();
  const orphanFile=path.join(root,"orphan.json");
  delete approval[0]!.waiting;
  fs.writeFileSync(orphanFile,JSON.stringify(approval));
  const orphan=new Supervisor(deps,{file:orphanFile,pollMs:5});
  orphan.start();
  assert.equal(orphan.get(job.id)?.status,"failed");
  assert.equal(orphan.get(job.id)?.recoveryHold?.kind,"missing-approval");
  orphan.stop();
  initial.stop();
  release();
  await new Promise(r=>setTimeout(r,75));
  console.log("supervisor interrupted recovery: persisted in-flight status, no auto replay, explicit retry/abort, approval recovery");
}finally{
  initial.stop();release();
  fs.rmSync(root,{recursive:true,force:true});
}
process.exit(0);
