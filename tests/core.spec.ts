import {LayanXCore} from "../src/core/orchestrator.js";
import {ExecutionRuntime} from "../src/core/runtime.js";

const core=new LayanXCore();
core.registerAgent({agentId:"test-agent",purpose:"test",allowedTools:["echo"],forbiddenResources:["secrets"],requiredPermission:"L1_READ",maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["echo"],stopCondition:"stop on denial"});
core.tools.register({name:"echo",description:"test echo",permission:"L1_READ",dangerous:false});

const mission=core.startMission("Run an echo test");
const runtime=new ExecutionRuntime(core);
const result=await runtime.run(mission,{missionId:mission.id,agentId:"test-agent",tool:"echo",action:"echo",permission:"L1_READ",idempotencyKey:crypto.randomUUID(),payload:"hello"},{execute:async request=>request.payload});
if(!result.ok||!result.verified)throw new Error("Core runtime test failed.");
console.log("Core runtime test passed.");
