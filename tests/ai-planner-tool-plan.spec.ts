import {LayanXCore} from "../src/core/orchestrator.js";
import type {ModelProviderAdapter} from "../src/models/inference.js";

const inputs:string[]=[];
const provider:ModelProviderAdapter={
  name:"planner-test",
  async health(){return{provider:"planner-test",available:true,updatedAt:new Date().toISOString()};},
  async generate(model,request){
    inputs.push(request.input);
    return{provider:"planner-test",modelId:model.id,output:JSON.stringify({
      risk:"low",
      requiredPermission:"L1_READ",
      steps:[{description:"Read runtime status"}],
      successCriteria:["done"],
      stopCondition:"Stop on policy denial.",
      tools:[{tool:"runtime.status",action:"read runtime status",permission:"L1_READ",reason:"Goal asks for runtime status."}]
    })};
  }
};

const core=new LayanXCore();
core.registerAgent({
  agentId:"core",
  purpose:"planner",
  allowedTools:["runtime.status"],
  forbiddenResources:["secrets"],
  requiredPermission:"L1_READ",
  maxToolCalls:10,
  maxRuntimeMs:10000,
  successCriteria:["done"],
  stopCondition:"stop"
});
core.tools.register({
  name:"runtime.status",
  description:"read runtime status",
  permission:"L1_READ",
  dangerous:false,
  actions:["read runtime status"],
  tags:["runtime","status"]
});
core.models.register({id:"planner-model",provider:"planner-test",capabilities:["reasoning"],local:true,enabled:true,priority:1});
core.providers.register(provider);

const mission=await core.planAndStartMission("Read runtime status");
if(mission.tools?.length!==1)throw new Error("planner tool plan was not persisted");
if(mission.tools?.[0].tool!=="runtime.status")throw new Error("planner selected the wrong tool");
if(mission.tools?.[0].action!=="read runtime status")throw new Error("planner selected the wrong action");
if(!inputs[0].includes("runtime.status"))throw new Error("planner did not receive the constrained catalog");

const invalidCore=new LayanXCore();
invalidCore.registerAgent({
  agentId:"core",purpose:"planner",allowedTools:["runtime.status"],forbiddenResources:[],
  requiredPermission:"L1_READ",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"
});
invalidCore.tools.register({name:"runtime.status",description:"read runtime status",permission:"L1_READ",dangerous:false,actions:["read runtime status"],tags:["runtime"]});
invalidCore.models.register({id:"invalid-model",provider:"planner-test",capabilities:["reasoning"],local:true,enabled:true,priority:1});
invalidCore.providers.register({
  name:"planner-test",
  async health(){return{provider:"planner-test",available:true,updatedAt:new Date().toISOString()};},
  async generate(model){return{provider:"planner-test",modelId:model.id,output:JSON.stringify({
    risk:"low",requiredPermission:"L1_READ",steps:[{description:"read"}],successCriteria:["done"],stopCondition:"stop",
    tools:[{tool:"unknown.tool",action:"execute unknown",permission:"L1_READ",reason:"bad"}]
  })};}
});
let rejected=false;
try{await invalidCore.planMission("read runtime");}catch(error){rejected=error instanceof Error&&error.message.includes("outside the allowed catalog");}
if(!rejected)throw new Error("planner accepted a tool outside the catalog");

console.log("AI planner constrained tool-plan tests passed.");
