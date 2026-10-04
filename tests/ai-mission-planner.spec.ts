import {ModelRegistry} from "../src/models/registry.js";
import {ModelExecutionRouter,ModelProviderRegistry} from "../src/core/model-execution.js";
import {AiMissionPlanner} from "../src/core/ai-planner.js";
import type {ModelProviderAdapter} from "../src/models/inference.js";

const models=new ModelRegistry();
models.register({id:"planner",provider:"fake",capabilities:["reasoning"],local:true,enabled:true,priority:1});
models.register({id:"vision",provider:"fake",capabilities:["vision"],local:true,enabled:true,priority:2});
const providers=new ModelProviderRegistry();
const provider:ModelProviderAdapter={
 name:"fake",
 async health(){return{provider:"fake",available:true,updatedAt:new Date().toISOString()};},
 async generate(model,request){if(model.id==="vision"){if(!Array.isArray(request.input)||!request.input.some(part=>part.type==="image"))throw new Error("Vision input missing.");return{modelId:model.id,provider:model.provider,output:JSON.stringify({tool:"desktop.screenshot",action:"desktop screenshot",permission:"L2_ANALYZE",reason:"inspect"})};} return{modelId:model.id,provider:model.provider,output:JSON.stringify({
   risk:"low",requiredPermission:"L1_READ",
   steps:[{description:"Understand the request"},{description:"Execute safely"},{description:"Verify the result"}],
   successCriteria:["result exists"],stopCondition:"Stop on policy denial"
 })};}
};
providers.register(provider);
const planner=new AiMissionPlanner(new ModelExecutionRouter(models,providers));
const fencedProviderModels=new ModelRegistry();
fencedProviderModels.register({id:"fenced",provider:"fenced",capabilities:["reasoning"],local:true,enabled:true,priority:1});
const fencedProviders=new ModelProviderRegistry();
fencedProviders.register({name:"fenced",async health(){return{provider:"fenced",available:true,updatedAt:new Date().toISOString()};},async generate(model){return{modelId:model.id,provider:model.provider,output:"Here is the plan:\n\x60\x60\x60json\n{\"risk\":\"low\",\"requiredPermission\":\"L1_READ\",\"steps\":[{\"description\":\"inspect\"}],\"successCriteria\":[\"done\"],\"stopCondition\":\"stop\",\"tools\":[]}\n\x60\x60\x60"};}});
const fencedPlan=await new AiMissionPlanner(new ModelExecutionRouter(fencedProviderModels,fencedProviders)).plan("x");
if(fencedPlan.steps[0]?.description!=="inspect")throw new Error("Planner did not parse fenced JSON.");
const plan=await planner.plan("Create a safe read-only report.");
if(plan.risk!=="low"||plan.requiredPermission!=="L1_READ"||plan.steps.length!==3)throw new Error("AI mission plan parsing failed.");
const visualTool=await planner.nextTool({goal:"Inspect the screen",result:{status:"screenshot"},tools:[{name:"desktop.screenshot",description:"Capture screen",permission:"L2_ANALYZE",dangerous:false,actions:["desktop screenshot"],tags:["desktop"]}],requiredPermission:"L2_ANALYZE",completedTools:[],visualContext:{mimeType:"image/png",base64:"aGVsbG8="}});
if(!visualTool)throw new Error("Visual planner did not return a tool.");

const brokenProviders=new ModelProviderRegistry();
brokenProviders.register({
 name:"broken",
 async health(){return{provider:"broken",available:true,updatedAt:new Date().toISOString()};},
 async generate(model){return{modelId:model.id,provider:model.provider,output:"not json"};}
});
const brokenModels=new ModelRegistry();
brokenModels.register({id:"broken",provider:"broken",capabilities:["reasoning"],local:true,enabled:true,priority:1});
try{await new AiMissionPlanner(new ModelExecutionRouter(brokenModels,brokenProviders)).plan("x");throw new Error("Expected invalid planner output.");}catch(error){if(!(error instanceof Error)||!error.message.includes("invalid JSON"))throw error;}
console.log("AI mission planner test passed.");
