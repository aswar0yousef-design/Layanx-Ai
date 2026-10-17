import assert from "node:assert/strict";
import {LayanXCore} from "../src/core/orchestrator.js";

/**
 * A mission the agent loop leaves without finishing is marked failed, never left "running" forever
 * (the dashboard showed such a mission as "in progress, 3/3, 100%" long after its job had ended).
 * A mission paused for an approval, or of another project, is left exactly as it is.
 */
function setup(planner:()=>string){
  const core=new LayanXCore();
  core.registerAgent({agentId:"core",purpose:"unfinished",allowedTools:["safe.read","dangerous.read"],forbiddenResources:[],requiredPermission:"L4_EXECUTE",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["finished"],stopCondition:"stop"});
  core.tools.register({name:"safe.read",description:"read a file",permission:"L1_READ",dangerous:false,actions:["read"],tags:["test"]});
  core.toolAdapters.register("safe.read",{async execute(){return{content:"x"};}});
  core.tools.register({name:"dangerous.read",description:"needs approval",permission:"L4_EXECUTE",dangerous:true,actions:["run"],tags:["test"]});
  core.toolAdapters.register("dangerous.read",{async execute(){return{finished:true};}});
  core.models.register({id:"planner",provider:"fake",capabilities:["reasoning"],local:true,enabled:true,priority:1});
  core.providers.register({name:"fake",async health(){return{provider:"fake",available:true,updatedAt:new Date().toISOString()};},async generate(model){return{modelId:model.id,provider:"fake",output:planner()};}});
  const mission=(project:string,tools:Array<{tool:string;action:string;permission:"L1_READ"|"L4_EXECUTE"}>)=>{
    const m=core.startMission("build the site",project);m.requiredPermission="L4_EXECUTE";
    m.tools=tools.map(x=>({...x,reason:"test"}));core.missions.save(m);return m;
  };
  return{core,mission};
}
const statusOf=(core:LayanXCore,id:string)=>core.missions.get(id)?.status;

// 1. The local model answers with something that is not JSON after a step ran: the loop throws, the mission is failed.
{
  const {core,mission}=setup(()=>"I will now write the homepage!");
  const m=mission("site",[{tool:"safe.read",action:"read",permission:"L1_READ"}]);
  await assert.rejects(core.executeAgentLoop(m.id,"site",5,{},"core"));
  assert.equal(statusOf(core,m.id),"failed","a mission whose planner failed is not left running");
  const stopped=core.audit.list().filter(a=>a.action==="mission.stopped"&&a.resource===m.id);
  assert.equal(stopped.length,1);assert.ok(String(stopped[0]!.metadata?.reason).length>0,"the reason is recorded");
}

// 2. Nothing ran at all (the planner had no step): failed too, and the result says so.
{
  const {core,mission}=setup(()=>"null");
  const m=mission("site",[]);
  const r=await core.executeAgentLoop(m.id,"site",5,{},"core");
  assert.equal(r.completed,false);assert.equal(r.status,"failed");
  assert.equal(statusOf(core,m.id),"failed");
}

// 3. Paused for the owner's approval: left as it is, and resumes to completion after the approval.
{
  const {core,mission}=setup(()=>"null");
  const m=mission("site",[{tool:"dangerous.read",action:"run",permission:"L4_EXECUTE"}]);
  const before=statusOf(core,m.id);
  const first=await core.executeAgentLoop(m.id,"site",3,{},"core");
  assert.ok("paused" in first&&first.paused,"paused for approval");
  assert.notEqual(statusOf(core,m.id),"failed","a paused mission is not failed");
  assert.equal(core.audit.list().filter(a=>a.action==="mission.stopped").length,0);
  core.executionRuntime.approvals.approve((first as {approvalId:string}).approvalId);
  const second=await core.executeAgentLoop(m.id,"site",3,{0:(first as {approvalId:string}).approvalId},"core");
  assert.equal(second.completed,true,JSON.stringify({before,second}));
  assert.equal(statusOf(core,m.id),"completed");
}

// 4. Another project's mission: the isolation error is thrown and that mission is not touched.
{
  const {core,mission}=setup(()=>"not json");
  const m=mission("site-a",[{tool:"safe.read",action:"read",permission:"L1_READ"}]);
  const before=statusOf(core,m.id);
  await assert.rejects(core.executeAgentLoop(m.id,"site-b",5,{},"core"));
  assert.equal(statusOf(core,m.id),before,"another project's mission keeps its status");
}

console.log("agent-loop-unfinished: an unfinished mission is failed, never left running; paused and other projects' missions are untouched");
