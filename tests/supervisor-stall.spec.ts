import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Supervisor,type SupervisorDeps} from "../src/autonomy/supervisor.js";
import {StallError,stallLimits,withStallLimit} from "../src/autonomy/stall-guard.js";

// The guard's timer does not keep a process alive by itself; a real server has its socket for that.
setInterval(()=>undefined,1000);
const root=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-stall-"));
process.env.LAYANX_STORE_DIR=path.join(root,"store");
process.env.LAYANX_WORKSPACE_ROOT=path.join(root,"projects");
let serial=0;
const project=()=>{const id="p"+(++serial);fs.mkdirSync(path.join(process.env.LAYANX_WORKSPACE_ROOT!,id),{recursive:true});return id;};
const never=()=>new Promise<never>(()=>undefined);
const plan=JSON.stringify({acceptance:["done"],milestones:[{title:"Change it",goal:"Edit the project",kind:"code"}],checks:{test:false,build:false,install:false,security:false,browser:null}});
const base=():SupervisorDeps=>({
  async think(){return plan;},
  async runAgent(){return{completed:true,missionId:"m"};},
  async resumeAgent(){throw Error("no resume expected");},
  async runTool(){return{ok:true,data:{ok:true,exitCode:0}};},
  isApproved:()=>false,cloudAvailable:()=>false,externalAgent:()=>null,detect:()=>null
});
async function until(pred:()=>boolean,ms=5000){const end=Date.now()+ms;while(!pred()){if(Date.now()>end)throw Error("timeout waiting");await new Promise(r=>setTimeout(r,5));}}
const make=(deps:SupervisorDeps,stall={modelMs:60,actionMs:80,noProgressMs:60_000})=>new Supervisor(deps,{pollMs:2,stall});
const FINAL=["completed","failed","budget_exhausted","cancelled"];

// The guard itself.
await assert.rejects(withStallLimit(never,{what:"x",kind:"model",limitMs:20}),(e:unknown)=>e instanceof StallError&&/timed out: x/.test((e as Error).message));
assert.equal(await withStallLimit(async()=>7,{what:"x",kind:"model",limitMs:1000}),7);
await assert.rejects(withStallLimit(()=>{throw Error("sync")},{what:"x",kind:"model",limitMs:1000}),/sync/);
let beat=Date.now();const beating=setInterval(()=>{beat=Date.now();},5);
const slow=await withStallLimit(()=>new Promise<string>(r=>setTimeout(()=>r("finished"),120)),{what:"x",kind:"action",limitMs:40,activity:()=>beat});
clearInterval(beating);assert.equal(slow,"finished","activity keeps a long call alive");
assert.equal(stallLimits({LAYANX_STALL_MODEL_MS:"1234"} as NodeJS.ProcessEnv).modelMs,1234);
assert.equal(stallLimits({LAYANX_STALL_MODEL_MS:"junk"} as NodeJS.ProcessEnv).modelMs,7*60_000);
assert.ok(stallLimits({} as NodeJS.ProcessEnv).actionMs>15*60_000,"longer than the longest project task");

// A planner that never answers ends the job, with the cause; it does not wait for the 120 minute budget.
{
  const s=make({...base(),think:never});
  const job=s.create("Plan something hanging",project());
  await until(()=>FINAL.includes(job.status));
  assert.notEqual(job.status,"completed");
  assert.match(job.log.map(l=>l.msg).join("\n"),/timed out|no usable plan|made no progress/);
}

// An agent that hangs: stopped once, what was running is aborted, nothing is repeated, and a retry needs the owner.
{
  let agents=0;const aborted:string[]=[];
  const s=make({...base(),runAgent(){agents++;return never();},abortProject:(p)=>{aborted.push(p);}});
  const id=project();const job=s.create("Hanging agent work",id);
  await until(()=>job.status==="failed");
  assert.equal(agents,1,"an action that may be half done is not repeated");
  assert.deepEqual(aborted,[id]);
  assert.equal(job.stall?.kind,"action");
  assert.match(job.stall!.what,/coder agent/);
  assert.equal(job.recoveryHold?.kind,"stalled-operation");
  assert.match(job.result!,/not moving.*coder agent/s);
  assert.throws(()=>s.resume(job.id),/recovery_reconciliation_required/);
  s.reconcile(job.id,"abort");assert.equal(job.status,"cancelled");
}

// A tool that hangs is the same, and the next tool never starts.
{
  const tools:string[]=[];
  const s=make({...base(),detect:()=>({dir:root,stack:"node",scripts:[],hasLockfile:false,git:true,tasks:[]}) as never,runTool(_p,tool){tools.push(tool);return never();}});
  const job=s.create("Hanging tool work",project());
  await until(()=>job.status==="failed");
  assert.equal(job.stall?.kind,"action");
  assert.equal(tools.length,1);
}

// An agent that takes long but keeps working is left alone.
{
  let last=0;
  const beats=setInterval(()=>{last=Date.now();},5);
  const s=make({...base(),activity:()=>last,runAgent:()=>new Promise(r=>setTimeout(()=>r({completed:true,missionId:"m"}),300))});
  const job=s.create("Slow but busy agent",project());
  await until(()=>FINAL.includes(job.status));
  clearInterval(beats);
  assert.equal(job.stall,undefined);
  assert.ok(job.log.some(l=>l.msg.startsWith("Milestone passed")),"the slow agent's work was accepted");
}

// With a model ladder, a model that hangs loses its turn and the next one continues.
{
  const used:string[]=[];let files=0;const id=project();
  const dir=path.join(process.env.LAYANX_WORKSPACE_ROOT!,id);
  const s=make({...base(),modelLadders:()=>({coding:["hangs","works"],planning:["works"]}),
    runAgent(_g,_p,_a,routing){used.push(String(routing?.modelId));if(routing?.modelId==="hangs")throw new StallError("the model","model",60);fs.writeFileSync(path.join(dir,"f"+(++files)),"x");return Promise.resolve({completed:true,missionId:"m"});}});
  const job=s.create("Ladder moves on from a hung model",id);
  await until(()=>FINAL.includes(job.status));
  assert.deepEqual(used.slice(0,2),["hangs","works"]);
  assert.equal(job.stall,undefined);
}

// Steps that keep running while nothing changes are stopped with the reason, and can be resumed.
{
  let runs=0;
  const s=make({...base(),runAgent(){runs++;return Promise.resolve({completed:false,reason:"nothing to do"});}},{modelMs:1000,actionMs:1000,noProgressMs:1});
  const job=s.create("Spinning without any change",project());
  await until(()=>FINAL.includes(job.status));
  assert.equal(job.status,"failed");
  assert.equal(job.stall?.kind,"no-progress");
  assert.match(job.result!,/nothing changed in the files/);
  assert.equal(job.recoveryHold,undefined,"nothing was in flight, so no review is needed");
  assert.ok(runs<=1);
}

// The same unexpected error three times is reported as itself, instead of using up the rounds.
{
  let boom=0;
  const s=make({...base(),detect(){boom++;throw Error("disk unavailable");}},{modelMs:1000,actionMs:1000,noProgressMs:60_000});
  const original=(s as any).step.bind(s);(s as any).step=async(job:any)=>{boom++;await original;throw Error("disk unavailable 12");};
  const job=s.create("Always throws",project());
  await until(()=>FINAL.includes(job.status));
  assert.equal(job.stall?.kind,"repeating-error");
  assert.match(job.result!,/same error happened 3 times.*disk unavailable/s);
  assert.equal(job.rounds,3);
}

// Waiting for the owner is not a stall, however long it takes.
{
  let approved=false;
  const s=make({...base(),runAgent:async()=>({paused:true,approvalId:"a",missionId:"m",nextToolIndex:0}),isApproved:()=>approved,
    resumeAgent:async()=>({completed:true,missionId:"m"})},{modelMs:1000,actionMs:1000,noProgressMs:1});
  const job=s.create("Needs approval",project());
  await until(()=>job.status==="waiting_approval");
  await new Promise(r=>setTimeout(r,120));
  assert.equal(job.status,"waiting_approval");
  assert.equal(job.stall,undefined);
  approved=true;s.cancel(job.id);
}

// Outside a job (status pages) calls are untouched.
{
  const hanging=make({...base(),runTool:never});
  const pending=(hanging as any).deps.runTool("p","git.status",{});
  const result=await Promise.race([pending.then(()=>"done"),new Promise(r=>setTimeout(()=>r("still waiting"),150))]);
  assert.equal(result,"still waiting");
}

console.log("supervisor-stall: hung calls and motionless jobs end with their cause, and half-done actions are not repeated");
process.exit(0);
