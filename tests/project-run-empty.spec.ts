import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {LayanXCore} from "../src/core/orchestrator.js";
import {emptyProjectReason} from "../src/autonomy/project-runner.js";
import type {ModelProviderAdapter} from "../src/models/inference.js";

// A new goal ("build a website for a computer shop") starts in an empty folder. The planner once chose
// project.run first: the owner was asked to approve npm twice, and both runs failed. Now the agent loop
// tells the planner there is nothing to run yet, without asking anyone.
const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-empty-run-"));
process.env.LAYANX_WORKSPACE_ROOT=root;
delete process.env.LAYANX_PROJECTS_FILE;

// 1. The check itself.
fs.mkdirSync(path.join(root,"shop"));
assert.match(emptyProjectReason("shop",{task:"install"})!,/has no project yet.*project\.bootstrap/);
assert.match(emptyProjectReason("new-folder",{task:"dev:start"})!,/nothing to run/,"a folder that does not exist yet");
assert.equal(emptyProjectReason("shop",{task:"detect"}),undefined,"detect works on any folder");
assert.equal(emptyProjectReason("shop",{}),undefined,"no task = detect");
assert.equal(emptyProjectReason("shop",{task:"dev:status"}),undefined);
fs.writeFileSync(path.join(root,"shop","package.json"),JSON.stringify({name:"shop",scripts:{test:"node -e 1"}}));
assert.equal(emptyProjectReason("shop",{task:"install"}),undefined,"a real project runs normally");

// 2. In the agent loop: no approval request, no run, and the planner hears why.
const runs:string[]=[];const prompts:string[]=[];
const provider:ModelProviderAdapter={name:"ollama",
  async health(){return{provider:"ollama",available:true,updatedAt:new Date().toISOString()};},
  async generate(model,request){
    const prompt=typeof request.input==="string"?request.input:"";prompts.push(prompt);
    if(prompts.length===1)return{provider:"ollama",modelId:model.id,output:JSON.stringify({risk:"medium",requiredPermission:"L4_EXECUTE",steps:[{description:"Install the packages"}],successCriteria:["done"],stopCondition:"stop",
      tools:[{tool:"project.run",action:"run project task",permission:"L4_EXECUTE",reason:"install",payload:{task:"install"}}]})};
    return{provider:"ollama",modelId:model.id,output:"null"};
  }};
const core=new LayanXCore();
core.models.register({id:"qwen3.5:4b",provider:"ollama",capabilities:["reasoning"],local:true,enabled:true,priority:1});
core.providers.register(provider);
core.registerAgent({agentId:"core",purpose:"build",allowedTools:["project.run"],forbiddenResources:[],requiredPermission:"L4_EXECUTE",maxToolCalls:10,maxRuntimeMs:60000,successCriteria:["done"],stopCondition:"stop"});
core.tools.register({name:"project.run",description:"run project tasks",permission:"L4_EXECUTE",dangerous:true,actions:["run project task"]});
core.toolAdapters.register("project.run",{async execute(r){runs.push(String((r.payload as any).task));return{data:{ok:true,exitCode:0}};}});

const empty=await core.runAgentGateway("Build a website for a computer shop","site",4) as any;
assert.notEqual(empty.status,"awaiting_approval","no approval for a run that cannot work: "+JSON.stringify(empty).slice(0,300));
assert.deepEqual(runs,[],"nothing was run");
assert.ok(prompts.slice(1).some(p=>/has no project yet/.test(p)),"the planner is told why, to create the project first");
assert.ok(prompts[0]!.includes("A new project starts as an empty folder"),"the planner knows it before the first step");

// The same plan on a real project still asks the owner first (supervised trust).
prompts.length=0;
const real=await core.runAgentGateway("Install the shop packages","shop",4) as any;
assert.equal(real.status,"awaiting_approval","a real project run still waits for approval");
fs.rmSync(root,{recursive:true,force:true});
console.log("project-run-empty: no approval and no run for project.run in an empty folder; the planner is told to create the project first");
process.exit(0);
