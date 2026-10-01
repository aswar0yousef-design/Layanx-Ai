import {startRuntimeApi} from "../src/api-server.js";
import {LayanXCore} from "../src/core/orchestrator.js";
import type {ModelProviderAdapter} from "../src/models/inference.js";

const core=new LayanXCore();
core.registerAgent({agentId:"core",purpose:"test",allowedTools:[],forbiddenResources:["secrets"],requiredPermission:"L1_READ",maxToolCalls:10,maxRuntimeMs:1000,successCriteria:["done"],stopCondition:"stop"});
const provider:ModelProviderAdapter={name:"test",async health(){return{provider:"test",available:true,updatedAt:new Date().toISOString()};},async generate(model){return{provider:"test",modelId:model.id,output:JSON.stringify({risk:"low",requiredPermission:"L1_READ",steps:[{description:"plan"}],successCriteria:["done"],stopCondition:"stop"})};}};
core.models.register({id:"test-model",provider:"test",capabilities:["reasoning"],local:true,enabled:true,priority:1});core.providers.register(provider);

const server=startRuntimeApi({core,host:"127.0.0.1",port:0});
await new Promise<void>(resolve=>server.on("listening",()=>resolve()));
const address=server.address();if(!address||typeof address==="string")throw new Error("Server did not bind.");
const base="http://127.0.0.1:"+address.port;
const status=await fetch(base+"/v1/status");if(!status.ok)throw new Error("Status endpoint failed.");
const created=await fetch(base+"/v1/missions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({goal:"test mission"})});if(created.status!==201)throw new Error("Mission endpoint failed: "+created.status);
const health=await fetch(base+"/v1/health");if(!health.ok)throw new Error("Health endpoint failed.");
server.close();console.log("Runtime API integration test passed.");
