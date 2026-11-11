import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

/**
 * What the owner was told was accepted must still be there after a restart. A new runtime over the same real database
 * file stands in for the restart (a real process kill is covered by scripts/outcome-restart-acceptance.ts).
 * A mission that was only planned must come back without running by itself, and a failed save must be reported.
 */
const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-restart-"));
const storagePath=path.join(root,"runtime.json");
Object.assign(process.env,{LAYANX_STORE_DIR:root,LAYANX_DATA_DIR:root,LAYANX_WORKSPACE_ROOT:root,LAYANX_DATABASE_URL:"",DATABASE_URL:"",LAYANX_CAPABILITIES:"coding",MT5_AUTO_START:"false",LAYANX_BUSINESS_STORAGE_PATH:path.join(root,"business.json"),LAYANX_RUNTIME_STORAGE_PATH:storagePath});
const {createRuntime,restoreRuntime}=await import("../src/runtime.js");
const {startRuntimeApi}=await import("../src/api-server.js");
const {LayanXCore}=await import("../src/core/orchestrator.js");
const {RuntimePersistence}=await import("../src/core/runtime-persistence.js");
const {RuntimeStorage}=await import("../src/storage/runtime-storage.js");

const freePort=()=>new Promise<number>(resolve=>{const s=http.createServer().listen(0,"127.0.0.1",()=>{const p=(s.address() as {port:number}).port;s.close(()=>resolve(p));});});
async function boot(){
  const runtime=createRuntime({storagePath}) as any;
  await restoreRuntime(runtime);
  runtime.core.planMission=async(goal:string)=>runtime.core.planner.create(goal);
  const port=await freePort();
  startRuntimeApi({core:runtime.core,business:runtime.business,host:"127.0.0.1",port});
  await new Promise(resolve=>setTimeout(resolve,100));
  const api=`http://127.0.0.1:${port}`;
  const post=async(url:string,data:unknown)=>{const r=await fetch(api+url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)});return{status:r.status,body:await r.json() as any};};
  const get=async(url:string)=>await (await fetch(api+url)).json() as any;
  return{runtime,post,get};
}
const release={id:"r1",missionId:"m1",projectId:"default",branch:"feature/x",baseBranch:"main",commit:"abc",title:"Release"};
const failTransactions=()=>{const original=RuntimeStorage.prototype.transaction;RuntimeStorage.prototype.transaction=async function(){throw new Error("disk full");} as typeof original;return()=>{RuntimeStorage.prototype.transaction=original;};};

// 1. Accepted before the restart.
const first=await boot();
const planned=await first.post("/v1/missions",{goal:"planned only"});
assert.equal(planned.status,201);
const toCancel=await first.post("/v1/missions",{goal:"cancel me"});
assert.equal((await first.post(`/v1/missions/${toCancel.body.mission.id}/cancel`,{projectId:"default"})).status,200);
assert.equal((await first.post("/v1/release",release)).status,201);
assert.equal((await first.post("/v1/release/r1/transition",{stage:"REVIEWED"})).status,200);

// 2. Still there afterwards, unchanged, and nothing ran by itself.
const second=await boot();
const after=(await second.get("/v1/missions")).missions as any[];
const plannedAfter=after.find(m=>m.id===planned.body.mission.id);
assert.ok(plannedAfter,"a planned mission must survive a restart");
assert.equal(plannedAfter.status,"planned");
assert.equal(after.find(m=>m.id===toCancel.body.mission.id)?.status,"cancelled","a cancelled mission must not come back as live");
assert.equal(second.runtime.core.executionStates.get(plannedAfter.id).toolCalls,0);
const resumable=await second.runtime.persistence.resumable() as any[];
assert.ok(!resumable.some(s=>s.mission.id===plannedAfter.id),"a mission that never started has nothing to resume");
assert.equal((await second.get("/v1/release")).releases.find((r:any)=>r.id==="r1")?.stage,"REVIEWED","a release record must survive a restart");

// 3. The restored state machine carries on, and a repeated id cannot reset a record.
assert.equal((await second.post("/v1/release/r1/transition",{stage:"SECURITY_APPROVED"})).status,200);
assert.equal((await second.post("/v1/release/r1/transition",{stage:"RELEASED"})).status,409,"an illegal jump stays illegal after a restart");
const duplicate=await second.post("/v1/release",release);
assert.equal(duplicate.status,422);
assert.match(duplicate.body.error,/already exists/);
assert.equal((await second.get("/v1/release")).releases.find((r:any)=>r.id==="r1").stage,"SECURITY_APPROVED");

// 4. A failed save is reported and nothing is claimed; the store recovers afterwards.
let heal=failTransactions();
const lostMission=await second.post("/v1/missions",{goal:"never saved"});
const lostRelease=await second.post("/v1/release",{...release,id:"r2"});
const lostTransition=await second.post("/v1/release/r1/transition",{stage:"PR_READY"});
const lostCancel=await second.post(`/v1/missions/${plannedAfter.id}/cancel`,{projectId:"default"});
heal();
assert.equal(lostMission.status,422);
assert.ok(!(await second.get("/v1/missions")).missions.some((m:any)=>m.goal==="never saved"),"an unsaved mission must not be listed");
assert.equal(lostRelease.status,422);
assert.ok(!(await second.get("/v1/release")).releases.some((r:any)=>r.id==="r2"),"an unsaved release must not be listed");
assert.equal(lostTransition.status,409);
assert.equal((await second.get("/v1/release")).releases.find((r:any)=>r.id==="r1").stage,"SECURITY_APPROVED","a failed save must not advance the record");
assert.equal(lostCancel.status,422,"a cancel that could not be saved must say so");
assert.equal((await second.post("/v1/release/r1/transition",{stage:"PR_READY"})).status,200,"one failed write must not poison later ones");

// 5. Simultaneous requests all count.
const many=await Promise.all(Array.from({length:8},(_,i)=>second.post("/v1/missions",{goal:`parallel ${i}`})));
assert.ok(many.every(r=>r.status===201),JSON.stringify(many.map(r=>[r.status,r.body.error])));
const third=await boot();
const missions=(await third.get("/v1/missions")).missions as any[];
for(let i=0;i<8;i++)assert.ok(missions.some(m=>m.goal===`parallel ${i}`),`parallel ${i} was lost`);
assert.ok(!missions.some(m=>m.goal==="never saved"));
const releases=(await third.get("/v1/release")).releases as any[];
assert.equal(releases.find(r=>r.id==="r1").stage,"PR_READY");
assert.ok(!releases.some(r=>r.id==="r2"));

// 6. A restored plan runs only when asked, and its effect does not repeat.
{
  const file=path.join(root,"effects.json");
  let effects=0;
  const start=async()=>{
    const storage=RuntimeStorage.local(file),persistence=new RuntimePersistence(storage),core=new LayanXCore(undefined,persistence,storage) as any;
    core.registerAgent({agentId:"core",purpose:"restart",allowedTools:["effect.write"],forbiddenResources:[],requiredPermission:"L4_EXECUTE",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"});
    core.tools.register({name:"effect.write",description:"counts",permission:"L1_READ",dangerous:false,actions:["run"],tags:["test"]});
    core.toolAdapters.register("effect.write",{async execute(){effects++;return{content:"done"};}});
    core.models.register({id:"planner",provider:"fake",capabilities:["reasoning"],local:true,enabled:true,priority:1});
    core.providers.register({name:"fake",async health(){return{provider:"fake",available:true,updatedAt:new Date().toISOString()};},async generate(model:{id:string}){return{modelId:model.id,provider:"fake",output:"null"};}});
    core.planMission=async(goal:string)=>({...core.planner.create(goal),requiredPermission:"L4_EXECUTE",tools:[{tool:"effect.write",action:"run",permission:"L1_READ",reason:"test"}]});
    for(const snapshot of await persistence.list())core.restoreRuntimeSnapshot(snapshot);
    return core;
  };
  const before=await start();
  const mission=await before.planAndStartMission("write once","shop");
  const restored=await start();
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(effects,0,"a restored plan must not run by itself");
  assert.ok(restored.missions.get(mission.id)?.tools?.length,"the plan's steps must come back");
  await restored.executeAgentLoop(mission.id,"shop",3,{},"core");
  assert.equal(effects,1,"asked once, the restored plan runs once");
  const finished=await start();
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(effects,1,"a finished mission must not run again after a restart");
  await finished.executeAgentLoop(mission.id,"shop",3,{},"core").catch(()=>undefined);
  assert.equal(effects,1,"running a finished mission again must not repeat its effect");
}
console.log("Restart durability passed.");
process.exit(0);
