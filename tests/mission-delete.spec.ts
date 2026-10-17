import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The owner deletes a mission or an autonomous job made by mistake, so only what matters stays:
 * it leaves the list, its pending approvals and saved snapshot go (it does not return after a restart),
 * a running one stops, another project's mission cannot be deleted, and a job's own milestone missions
 * go with it (the project's files stay).
 */
const store=fs.mkdtempSync(path.join(os.tmpdir(),"lx-delete-"));
process.env.LAYANX_STORE_DIR=store;
const {LayanXCore}=await import("../src/core/orchestrator.js");
const {RuntimePersistence}=await import("../src/core/runtime-persistence.js");
const {RuntimeStorage}=await import("../src/storage/runtime-storage.js");
const {startRuntimeApi}=await import("../src/api-server.js");

function makeCore(){
  const persistence=new RuntimePersistence(new RuntimeStorage());
  const core=new LayanXCore(undefined,persistence);
  core.registerAgent({agentId:"core",purpose:"delete",allowedTools:["slow.read","dangerous.read"],forbiddenResources:[],requiredPermission:"L4_EXECUTE",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"});
  core.tools.register({name:"slow.read",description:"slow",permission:"L1_READ",dangerous:false,actions:["read"],tags:["test"]});
  core.toolAdapters.register("slow.read",{async execute(){await new Promise(r=>setTimeout(r,300));return{content:"x"};}});
  core.tools.register({name:"dangerous.read",description:"needs approval",permission:"L4_EXECUTE",dangerous:true,actions:["run"],tags:["test"]});
  core.toolAdapters.register("dangerous.read",{async execute(){return{done:true};}});
  core.models.register({id:"planner",provider:"fake",capabilities:["reasoning"],local:true,enabled:true,priority:1});
  core.providers.register({name:"fake",async health(){return{provider:"fake",available:true,updatedAt:new Date().toISOString()};},async generate(model){return{modelId:model.id,provider:"fake",output:"null"};}});
  const mission=(project:string,tools:Array<{tool:string;action:string;permission:"L1_READ"|"L4_EXECUTE"}>,goal="by mistake")=>{
    const m=core.startMission(goal,project);m.requiredPermission="L4_EXECUTE";m.tools=tools.map(x=>({...x,reason:"test"}));core.missions.save(m);return m;
  };
  return{core,persistence,mission};
}

// 1. A mission waiting for approval: deleted with its approval request and its snapshot; not another project's.
{
  const {core,persistence,mission}=makeCore();
  const m=mission("shop",[{tool:"dangerous.read",action:"run",permission:"L4_EXECUTE"}]);
  const paused=await core.executeAgentLoop(m.id,"shop",3,{},"core") as {paused?:boolean;approvalId?:string};
  assert.ok(paused.paused&&paused.approvalId);
  assert.ok(await persistence.get(m.id),"saved before");
  await assert.rejects(core.deleteMission(m.id,"other-project"),"another project cannot delete it");
  assert.ok(core.missions.get(m.id),"still there");
  assert.equal(await core.deleteMission(m.id,"shop"),true);
  assert.equal(core.missions.get(m.id),undefined,"gone from the list");
  assert.equal(await persistence.get(m.id),undefined,"gone from the saved snapshots (not back after a restart)");
  assert.ok(!core.executionRuntime.approvals.list().some(a=>a.missionId===m.id),"its pending approval is gone");
  assert.ok(core.audit.list().some(a=>a.action==="mission.deleted"&&a.resource===m.id),"the audit log keeps a line");
  assert.equal(await core.deleteMission(m.id,"shop"),false,"deleting twice is harmless");
}

// 2. A running mission: deleted while its step runs; it stops and does not come back when the step ends.
{
  const {core,persistence,mission}=makeCore();
  const m=mission("shop",[{tool:"slow.read",action:"read",permission:"L1_READ"},{tool:"slow.read",action:"read",permission:"L1_READ"}]);
  const run=core.executeAgentLoop(m.id,"shop",5,{},"core").catch(e=>e);
  await new Promise(r=>setTimeout(r,100));
  assert.equal(await core.deleteMission(m.id,"shop"),true);
  await run;
  assert.equal(core.missions.get(m.id),undefined,"not saved again by the step that was running");
  assert.equal(await persistence.get(m.id),undefined);
}

// 3. The API: a stopped autonomous job and the missions of its milestones (recorded, and one its model
//    failed before reporting); another job's mission and a mission of its own stay.
{
  const {core,mission}=makeCore();
  const goal="Build a professional website for a computer shop";
  const recorded=mission("shop",[],`Overall goal: ${goal}\nCurrent milestone (1/6): metadata`);
  const unreported=mission("shop",[],`Overall goal: ${goal}\nCurrent milestone (1/6): metadata (attempt 2)`);
  const otherJobs=mission("shop",[],"Overall goal: Another site\nCurrent milestone (1/1): x");
  const own=mission("shop",[],"open the browser");
  const now=new Date().toISOString();
  const job=(id:string,g:string,missions:string[])=>({id,projectId:"shop",goal:g,status:"failed",createdAt:now,updatedAt:now,log:[],acceptance:[],notes:[],externalUsed:[],trust:"trusted",rounds:1,current:0,
    milestones:[{title:"Add site metadata",goal:"metadata",kind:"code",agent:"coder",status:"failed",attempts:4,missions}]});
  fs.writeFileSync(path.join(store,"supervisor-jobs.json"),JSON.stringify([job("job-a",goal,[recorded.id]),job("job-b","Another site",[otherJobs.id])]));
  const server=startRuntimeApi({core,host:"127.0.0.1",port:0});
  await new Promise<void>(r=>server.on("listening",()=>r()));
  const base="http://127.0.0.1:"+(server.address() as {port:number}).port;
  const post=(p:string,b:unknown={})=>fetch(base+p,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)}).then(async r=>({status:r.status,body:await r.json() as any}));
  const del=await post("/v1/supervisor/jobs/job-a/delete");
  assert.equal(del.status,200);assert.equal(del.body.missions,2,JSON.stringify(del.body));
  const jobs=await fetch(base+"/v1/supervisor/jobs?projectId=shop").then(r=>r.json()) as any;
  assert.deepEqual(jobs.jobs.map((j:any)=>j.id),["job-b"],"the job is gone, the other stays");
  assert.equal(core.missions.get(recorded.id),undefined);assert.equal(core.missions.get(unreported.id),undefined);
  assert.ok(core.missions.get(otherJobs.id),"another job's mission stays");assert.ok(core.missions.get(own.id),"a mission of its own stays");
  assert.equal((await post("/v1/supervisor/jobs/job-a/delete")).status,404);
  // A mission of its own, from the missions list.
  assert.equal((await post(`/v1/control-center/missions/${own.id}/delete`,{})).status,400,"projectId is required");
  assert.equal((await post(`/v1/control-center/missions/${own.id}/delete`,{projectId:"elsewhere"})).status,403,"another project cannot");
  assert.equal((await post(`/v1/control-center/missions/${own.id}/delete`,{projectId:"shop"})).status,200);
  assert.equal(core.missions.get(own.id),undefined);
  assert.equal((await post(`/v1/control-center/missions/${own.id}/delete`,{projectId:"shop"})).status,404);
  server.close();
}
fs.rmSync(store,{recursive:true,force:true});
console.log("mission-delete: missions and autonomous jobs made by mistake are deleted for good, with their approvals and milestone missions; nothing else");
process.exit(0);
