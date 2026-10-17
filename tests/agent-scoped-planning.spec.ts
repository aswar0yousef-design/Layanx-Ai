import assert from "node:assert/strict";
import {LayanXCore} from "../src/core/orchestrator.js";
import type {ModelProviderAdapter} from "../src/models/inference.js";

const plannerInputs:string[]=[];
const core=new LayanXCore();
core.registerAgent({
  agentId:"core",purpose:"Only use core-only tools",allowedTools:["core.only"],forbiddenResources:[],
  requiredPermission:"L1_READ",maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"
});
core.registerAgent({
  agentId:"researcher",purpose:"Read reference notes",allowedTools:["files.read"],forbiddenResources:[],
  requiredPermission:"L1_READ",maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"
});
for (const name of ["core.only","files.read"]) {
  core.tools.register({
    name,description:name==="files.read"?"read a file":"core-only operation",
    permission:"L1_READ",dangerous:false,actions:["read file"],tags:["test"]
  });
}
const provider:ModelProviderAdapter={
  name:"agent-scope-test",
  async health(){return{provider:"agent-scope-test",available:true,updatedAt:new Date().toISOString()};},
  async generate(model,request){
    const input=typeof request.input==="string"?request.input:"";
    plannerInputs.push(input);
    const marker="Available tool catalog: ";
    const line=input.split("\n").find(value=>value.startsWith(marker));
    if(!line)throw new Error("Planner input did not include its allowed tool catalog.");
    const catalog=JSON.parse(line.slice(marker.length)) as Array<{name:string;permission:string;actions:string[]}>;
    if(!catalog.length)throw new Error("The researcher received an empty tool catalog.");
    const selected=catalog[0]!;
    return{
      provider:"agent-scope-test",
      modelId:model.id,
      output:JSON.stringify({
        risk:"low",
        requiredPermission:selected.permission,
        steps:[{description:"Read the supplied note"}],
        successCriteria:["done"],
        stopCondition:"Stop after the read attempt.",
        tools:[{tool:selected.name,action:selected.actions[0],permission:selected.permission,reason:"Use an allowed read tool."}]
      })
    };
  }
};
core.models.register({id:"agent-scope-model",provider:"agent-scope-test",capabilities:["reasoning"],local:true,enabled:true,priority:1});
core.providers.register(provider);

// Inspect the planned mission before execution so this test isolates the contract/catalog boundary.
let plannedTool="";
(core as any).executeAgentLoop=async(missionId:string,_projectId:string,_maxSteps:number,_approvalIds:Record<number,string>,agentId:string)=>{
  assert.equal(agentId,"researcher","the gateway must preserve the requested agent identity");
  plannedTool=core.missions.get(missionId)?.tools?.[0]?.tool??"";
  return{missionId,completed:true,status:"completed",steps:0,results:[]};
};

const result=await core.runAgentGateway("Read a reference note","default",5,{},"researcher") as any;
assert.equal(result.completed,true);
assert.equal(plannedTool,"files.read","planning must use the selected researcher's allowed tools, not the core agent's catalog");
assert.ok(plannerInputs[0]?.includes('"name":"files.read"'));
assert.ok(!plannerInputs[0]?.includes('"name":"core.only"'),"the core-only tool must not leak into the researcher's planning catalog");

console.log("agent-scoped-planning: gateway plans with the selected agent's allowed tool catalog");
