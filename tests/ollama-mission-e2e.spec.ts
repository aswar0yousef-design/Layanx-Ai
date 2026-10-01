import {LayanXCore} from "../src/core/orchestrator.js";
import {createOllamaProvider} from "../src/providers/ollama-provider.js";
import type {ModelProviderAdapter} from "../src/models/inference.js";

const calls:string[]=[];
const ollama:ModelProviderAdapter={
 name:"ollama",
 async health(){return{provider:"ollama",available:true,updatedAt:new Date().toISOString()};},
 async generate(model,request){
  calls.push(request.input);
  return{provider:"ollama",modelId:model.id,output:JSON.stringify({
   risk:"low",requiredPermission:"L1_READ",
   steps:[{description:"Understand the goal"},{description:"Execute the requested read"},{description:"Verify the result"}],
   successCriteria:["done"],stopCondition:"Stop on policy denial."
  })};
 }
};

const core=new LayanXCore();
core.models.register({id:"llama3.2:3b",provider:"ollama",capabilities:["reasoning"],local:true,enabled:true,priority:1});
core.providers.register(ollama);
const mission=await core.planAndStartMission("Read local system status");
if(mission.status!=="planned")throw new Error("Mission was not planned.");
if(mission.requiredPermission!=="L1_READ")throw new Error("Ollama planner returned the wrong permission.");
if(mission.steps.length!==3)throw new Error("Ollama planner mission was not compiled correctly.");
if(calls.length!==1)throw new Error("Ollama planner was not called exactly once.");
if(!calls[0].includes("Read local system status"))throw new Error("Mission goal was not included in the planner request.");
console.log("Ollama mission planning E2E path passed.");
