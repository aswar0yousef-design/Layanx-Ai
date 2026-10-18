import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Supervisor,type SupervisorDeps,type SupervisorJob} from "../src/autonomy/supervisor.js";

const store=fs.mkdtempSync(path.join(os.tmpdir(),"lx-desktop-open-store-"));
const workspace=fs.mkdtempSync(path.join(os.tmpdir(),"lx-desktop-open-workspace-"));
process.env.LAYANX_STORE_DIR=store;
process.env.LAYANX_WORKSPACE_ROOT=workspace;
fs.mkdirSync(path.join(workspace,"default"),{recursive:true});

const goal="افتح تطبيق المفكرة Notepad على جهازي، وتأكد من نجاح فتحه.";
const now=new Date().toISOString();
// Simulate the persisted job from the Windows report: the first planned step incorrectly used research.
const oldJob:SupervisorJob={
  id:"cb4e4343-4b49-4492-bda9-67e70cc1c334",
  projectId:"default",
  goal,
  status:"cancelled",
  createdAt:now,
  updatedAt:now,
  deadline:new Date(Date.now()+60_000).toISOString(),
  trust:"supervised",
  acceptance:[goal],
  checks:{install:false,test:false,build:false,typecheck:false,lint:false,browser:null,security:false},
  milestones:[
    {title:"توثيق تشغيل التطبيقات",goal:"research how to open apps",kind:"research",agent:"researcher",status:"pending",attempts:2,missions:[],notes:"Agent stopped: Tool plan is outside the allowed catalog."},
    {title:"فتح المفكرة",goal:"افتح المفكرة",kind:"desktop",agent:"operator",status:"pending",attempts:0,missions:[]},
    {title:"التحقق من النافذة",goal:"verify window",kind:"desktop",agent:"operator",status:"pending",attempts:0,missions:[]}
  ],
  current:0,
  rounds:2,
  maxRounds:30,
  cloudUsed:true,
  externalUsed:[],
  checkpoints:[],
  log:[{at:now,msg:"Loaded prior failed attempt"}],
  finalRepairs:0,
  specChecks:{security:false}
};
const file=path.join(store,"supervisor-jobs.json");
fs.writeFileSync(file,JSON.stringify([oldJob]),"utf8");

const calls:{agent:string;goal:string}[]=[];
const forgottenApprovalMissions:string[]=[];
let planningCalls=0;
const deps:SupervisorDeps={
  async think(prompt){
    if(prompt.includes("planning lead"))planningCalls++;
    return JSON.stringify({title:"Desktop task",tags:["desktop"],stacks:["any"],steps:["Use the approved desktop tools"],pitfalls:[],checks:[]});
  },
  async runAgent(agentGoal,_projectId,agentId){
    calls.push({agent:agentId,goal:agentGoal});
    return{completed:true,missionId:"desktop-mission-"+calls.length,final:{ok:true,verified:true}};
  },
  async resumeAgent(){return{completed:true};},
  async runTool(){return{ok:true,data:{ok:true,exitCode:0}};},
  isApproved:()=>false,
  forgetApprovalsForMissions(missionIds){forgottenApprovalMissions.push(...missionIds);},
  cloudAvailable:()=>false,
  externalAgent:()=>null,
  detect:()=>null
};

const supervisor=new Supervisor(deps,{file,pollMs:5});
const resumed=supervisor.resume(oldJob.id);
assert.equal(resumed.status,"planning","the stale research plan should be discarded before it runs");
const until=async(f:()=>boolean,ms=8000)=>{
  const end=Date.now()+ms;
  while(!f()){
    if(Date.now()>end)throw new Error("timeout: "+JSON.stringify(supervisor.get(oldJob.id)?.log.slice(-8)));
    await new Promise(resolve=>setTimeout(resolve,10));
  }
};
await until(()=>["completed","failed"].includes(supervisor.get(oldJob.id)!.status));
const result=supervisor.get(oldJob.id)!;
assert.equal(result.status,"completed",result.log.map(line=>line.msg).join("\n"));
assert.equal(result.milestones.length,2,"the unnecessary research milestone must not return");
assert.ok(result.milestones.every(milestone=>milestone.kind==="desktop"));
assert.deepEqual(calls.map(call=>call.agent),["operator","operator"]);
assert.ok(calls[0]!.goal.includes("Current milestone (1/2): افتح Notepad"));
assert.ok(calls[1]!.goal.includes("Current milestone (2/2): تحقق من أن نافذة Notepad ظاهرة"));
assert.equal(planningCalls,0,"the direct local app-open plan should not call a model planner");
assert.ok(result.log.some(line=>line.msg.includes("Replanning the unfinished desktop-open request")));
assert.ok(result.log.some(line=>line.msg.includes("skipped research and planned opening plus window verification")));
supervisor.stop();

// A Windows restart can reload this same bad plan while the job is still marked "running".
// Startup recovery must replan it too, without requiring the owner to wait for another failure.
const startupJob:SupervisorJob={
  ...oldJob,
  id:"startup-stale-desktop-job",
  status:"running",
  updatedAt:now,
  deadline:new Date(Date.now()-60_000).toISOString(),
  log:[{at:now,msg:"Simulated restart while the old research milestone was running"}],
  milestones:oldJob.milestones.map(m=>({...m,missions:[...m.missions]}))
};
const startupFile=path.join(store,"startup-jobs.json");
fs.writeFileSync(startupFile,JSON.stringify([startupJob]),"utf8");
calls.length=0;
const startupSupervisor=new Supervisor(deps,{file:startupFile,pollMs:5});
startupSupervisor.start();
const untilStartup=async(f:()=>boolean,ms=8000)=>{
  const end=Date.now()+ms;
  while(!f()){
    if(Date.now()>end)throw new Error("startup recovery timeout: "+JSON.stringify(startupSupervisor.get(startupJob.id)?.log.slice(-8)));
    await new Promise(resolve=>setTimeout(resolve,10));
  }
};
await untilStartup(()=>["completed","failed"].includes(startupSupervisor.get(startupJob.id)!.status));
const recovered=startupSupervisor.get(startupJob.id)!;
assert.equal(recovered.status,"completed",recovered.log.map(line=>line.msg).join("\\n"));
assert.ok(Date.parse(recovered.deadline)>Date.now(),"startup recovery must renew an expired job deadline");
assert.equal(recovered.milestones.length,2);
assert.ok(recovered.milestones.every(m=>m.kind==="desktop"));
assert.deepEqual(calls.map(call=>call.agent),["operator","operator"]);
assert.ok(recovered.log.some(line=>line.msg.includes("Recovered an unfinished desktop-open request after restart")));
assert.ok(recovered.log.some(line=>line.msg.includes("Replanning the unfinished desktop-open request")));
assert.equal(planningCalls,0,"startup recovery should not call an LLM planner for a known app-open command");
startupSupervisor.stop();

// A job saved before the read-only verification fix can be waiting for approval to focus Notepad.
// On restart, keep the already-open milestone and rerun only the current verification milestone.
const staleVerifyJob:SupervisorJob={
  ...startupJob,
  id:"startup-stale-focus-verification",
  status:"waiting_approval",
  current:1,
  rounds:4,
  deadline:new Date(Date.now()-60_000).toISOString(),
  waiting:{approvalId:"obsolete-focus-approval",missionId:"prior-focus-mission",index:0,kind:"agent",agentId:"operator",milestone:1},
  milestones:[
    {...startupJob.milestones[1]!,title:"فتح المفكرة",goal:"افتح Notepad",kind:"desktop",agent:"operator",status:"done",attempts:1,missions:["prior-open-mission"]},
    {...startupJob.milestones[2]!,title:"التحقق من النافذة",goal:"تحقق من أن نافذة Notepad ظاهرة على سطح المكتب",kind:"desktop",agent:"operator",status:"running",attempts:3,missions:["prior-focus-mission"],notes:"Agent stopped: focus approval was required."}
  ],
  log:[{at:now,msg:"Simulated legacy job waiting for a focus approval"}]
};
const verifyFile=path.join(store,"startup-stale-focus-jobs.json");
fs.writeFileSync(verifyFile,JSON.stringify([staleVerifyJob]),"utf8");
calls.length=0;
const verifySupervisor=new Supervisor(deps,{file:verifyFile,pollMs:5});
verifySupervisor.start();
const untilVerify=async(f:()=>boolean,ms=8000)=>{
  const end=Date.now()+ms;
  while(!f()){
    if(Date.now()>end)throw new Error("focus-verification recovery timeout: "+JSON.stringify(verifySupervisor.get(staleVerifyJob.id)?.log.slice(-8)));
    await new Promise(resolve=>setTimeout(resolve,10));
  }
};
await untilVerify(()=>["completed","failed"].includes(verifySupervisor.get(staleVerifyJob.id)!.status));
const verifiedRecovery=verifySupervisor.get(staleVerifyJob.id)!;
assert.equal(verifiedRecovery.status,"completed",verifiedRecovery.log.map(line=>line.msg).join("\\n"));
assert.equal(verifiedRecovery.milestones[0]!.status,"done","the successful Notepad-open milestone must be preserved");
assert.equal(verifiedRecovery.milestones[0]!.missions[0],"prior-open-mission");
assert.equal(verifiedRecovery.milestones[1]!.attempts,1,"the obsolete focus mission should be replaced with one read-only verification attempt");
assert.deepEqual(calls.map(call=>call.agent),["operator"],"restart recovery should rerun verification only");
assert.ok(Date.parse(verifiedRecovery.deadline)>Date.now(),"legacy verification recovery must renew the deadline");
assert.ok(verifiedRecovery.log.some(line=>line.msg.includes("Replaced stale Notepad window-focus verification with a read-only window-presence check")));
assert.ok(forgottenApprovalMissions.includes("prior-focus-mission"),"obsolete focus approvals must be removed when verification is replanned");
verifySupervisor.stop();

fs.rmSync(store,{recursive:true,force:true});
fs.rmSync(workspace,{recursive:true,force:true});
console.log("supervisor-direct-desktop: resume and startup both replace stale research plans with open-app and window-verification milestones");
