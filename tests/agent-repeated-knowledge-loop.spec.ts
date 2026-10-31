import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {LayanXCore} from "../src/core/orchestrator.js";
import type {ModelProviderAdapter} from "../src/models/inference.js";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-identical-read-"));
process.env.LAYANX_STORE_DIR=path.join(dir,"state");
process.env.LAYANX_WORKSPACE_ROOT=path.join(dir,"projects");
fs.mkdirSync(process.env.LAYANX_WORKSPACE_ROOT,{recursive:true});
const core=new LayanXCore();
let reads=0;
const plan={tool:"project.knowledge",action:"read project knowledge",permission:"L1_READ" as const,
  reason:"Review the same reference notes",payload:{query:"capabilities"}};
core.registerAgent({agentId:"core",purpose:"Read local reference notes",
  allowedTools:["project.knowledge"],forbiddenResources:[],
  requiredPermission:"L1_READ",maxToolCalls:12,maxRuntimeMs:120000,
  successCriteria:["A new report has been saved to disk"],stopCondition:"Stop if the goal is not progressing"});
core.tools.register({name:"project.knowledge",description:"Read project knowledge",permission:"L1_READ",
  dangerous:false,actions:["read project knowledge"],tags:["knowledge","read"]});
core.toolAdapters.register("project.knowledge",{async execute(){reads++;return {data:{notes:["Same knowledge as before"],count:1}};}});
const provider:ModelProviderAdapter={
  name:"repeating-read-model",
  async health(){return {provider:this.name,available:true,updatedAt:new Date().toISOString()};},
  async generate(model){
    return {provider:this.name,modelId:model.id,output:JSON.stringify({
      risk:"low",requiredPermission:"L1_READ",
      steps:[{description:"Read knowledge and then create a report"}],
      successCriteria:["A new report has been saved to disk"],
      stopCondition:"Stop if no report can be produced",
      tools:[plan]
    })};
  }
};
core.providers.register(provider);
core.models.register({id:"repeating-read-test-model",provider:provider.name,capabilities:["reasoning"],
  local:true,enabled:true,priority:999});
(core.aiPlanner as unknown as {nextTool:(input:unknown)=>Promise<unknown>}).nextTool=async()=>({...plan});
try{
  const result=await core.runAgentGateway("Read project knowledge and prepare a real report","default",8) as {
    completed:boolean;status:string;reason?:string;results:Array<{ok:boolean;tool:string}>;
  };
  assert.equal(result.completed,false,"Repeating observations cannot satisfy a deliverable goal");
  assert.equal(result.status,"failed");
  assert.match(result.reason??"",/Repeated read-only tool blocked/);
  assert.equal(reads,2,"Do not execute the third identical successful read");
  assert.equal(result.results?.length,2);
  assert.ok(result.results.every(r=>r.ok),"The issue is lack of progress, not a read failure");
  console.log("agent live loop: repeated project knowledge stopped after two successful identical reads, with explicit failed outcome");
}finally{
  fs.rmSync(dir,{recursive:true,force:true});
}
process.exit(0);
