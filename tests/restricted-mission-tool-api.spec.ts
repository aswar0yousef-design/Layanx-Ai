import {startRuntimeApi} from "../src/api-server.js";
import {LayanXCore} from "../src/core/orchestrator.js";
import type {ModelProviderAdapter} from "../src/models/inference.js";
import type {ToolRequest} from "../src/core/types.js";

const core=new LayanXCore();
core.registerAgent({agentId:"runner",purpose:"test",allowedTools:["echo"],forbiddenResources:["secrets"],requiredPermission:"L1_READ",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"});
core.tools.register({name:"echo",description:"read echo value",permission:"L1_READ",dangerous:false});
let calls=0;
core.toolAdapters.register("echo",{async execute(request:ToolRequest){calls++;return{echo:request.payload};}});
const provider:ModelProviderAdapter={name:"test",async health(){return{provider:"test",available:true,updatedAt:new Date().toISOString()};},async generate(model){return{provider:"test",modelId:model.id,output:JSON.stringify({risk:"low",requiredPermission:"L1_READ",steps:[{description:"read"}],successCriteria:["done"],stopCondition:"stop"})};}};
core.models.register({id:"test-model",provider:"test",capabilities:["reasoning"],local:true,enabled:true,priority:1});core.providers.register(provider);

const mission=core.startMission("execute echo","p1");
core.missions.save(mission);
const token=core.capabilities.issue({missionId:mission.id,agentId:"runner",projectId:"p1",resource:"echo",permission:"L1_READ",expiresAt:new Date(Date.now()+60000).toISOString()});
const server=startRuntimeApi({core,host:"127.0.0.1",port:0});
await new Promise<void>(resolve=>server.on("listening",resolve));
const address=server.address();if(!address||typeof address==="string")throw new Error("bind failed");
const base="http://127.0.0.1:"+address.port;
const common={agentId:"runner",tool:"echo",action:"read echo",permission:"L1_READ",projectId:"p1",capabilityId:token.id,idempotencyKey:"api-echo-1",payload:{value:42}};
const ok=await fetch(base+"/v1/missions/"+mission.id+"/tools",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(common)});
if(ok.status!==200)throw new Error("safe execution failed: "+ok.status+" "+await ok.text());
if(calls!==1)throw new Error("adapter should execute once");
const replay=await fetch(base+"/v1/missions/"+mission.id+"/tools",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(common)});
if(replay.status!==200)throw new Error("idempotent replay failed");
if(calls!==1)throw new Error("idempotent replay executed adapter twice");

const deniedMission=core.startMission("execute echo");
const deniedToken=core.capabilities.issue({missionId:deniedMission.id,agentId:"runner",projectId:"p1",resource:"echo",permission:"L1_READ",expiresAt:new Date(Date.now()+60000).toISOString()});
const denied=await fetch(base+"/v1/missions/"+deniedMission.id+"/tools",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...common,idempotencyKey:"api-echo-2",capabilityId:deniedToken.id,permission:"L2_ANALYZE"})});
if(denied.status!==403)throw new Error("scope denial failed: "+denied.status);

const sentinelMission=core.startMission("blocked action");
const sentinelToken=core.capabilities.issue({missionId:sentinelMission.id,agentId:"runner",projectId:"p1",resource:"echo",permission:"L1_READ",expiresAt:new Date(Date.now()+60000).toISOString()});
const sentinel=await fetch(base+"/v1/missions/"+sentinelMission.id+"/tools",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...common,idempotencyKey:"api-echo-3",capabilityId:sentinelToken.id,action:"disable_security"})});
if(sentinel.status!==403)throw new Error("sentinel denial failed: "+sentinel.status);

const unknown=await fetch(base+"/v1/missions/"+mission.id+"/tools",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...common,idempotencyKey:"api-echo-4",tool:"missing"})});
if(unknown.status!==422)throw new Error("unknown tool handling failed: "+unknown.status);
server.close();
console.log("Restricted mission tool API test passed.");