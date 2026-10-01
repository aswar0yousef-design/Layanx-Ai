import {LayanXCore} from "../src/core/orchestrator.js";
import {MissionRunner} from "../src/core/mission-runner.js";

const core=new LayanXCore();
const agent={agentId:"project-agent",purpose:"project isolation test",allowedTools:["echo"],forbiddenResources:[],requiredPermission:"L1_READ" as const,maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"};
core.registerAgent(agent);
core.tools.register({name:"echo",description:"echo",permission:"L1_READ",dangerous:false});

const mission=core.startMission("read project data","project-a");
const capability=core.capabilities.issue({
 missionId:mission.id,agentId:agent.agentId,projectId:"project-a",resource:"echo",permission:"L1_READ",
 expiresAt:new Date(Date.now()+60000).toISOString()
});
const runner=new MissionRunner(core);
const wrong=await runner.execute(
 mission,
 {missionId:mission.id,agentId:agent.agentId,tool:"echo",action:"echo",permission:"L1_READ",idempotencyKey:"project-isolation-wrong",payload:"x"},
 {async execute(){throw new Error("cross-project execution must not run");}},
 undefined,
 {projectId:"project-b",capabilityId:capability.id}
);
if(wrong.ok||!String(wrong.error).includes("Project isolation"))throw new Error("Cross-project mission execution was not blocked.");

const unbound={...core.startMission("unbound"),projectId:undefined};
const unboundResult=await runner.execute(
 unbound,
 {missionId:unbound.id,agentId:agent.agentId,tool:"echo",action:"echo",permission:"L1_READ",idempotencyKey:"project-isolation-unbound",payload:"x"},
 {async execute(){throw new Error("unbound execution must not run");}},
 undefined,
 {projectId:"project-a",capabilityId:core.capabilities.issue({
   missionId:unbound.id,agentId:agent.agentId,projectId:"project-a",resource:"echo",permission:"L1_READ",
   expiresAt:new Date(Date.now()+60000).toISOString()
 }).id}
);
if(unboundResult.ok||!String(unboundResult.error).includes("not bound to a project"))throw new Error("Unbound mission was not rejected.");

const matchingMission=core.startMission("read project data","project-a");
const matchingCapability=core.capabilities.issue({
 missionId:matchingMission.id,agentId:agent.agentId,projectId:"project-a",resource:"echo",permission:"L1_READ",
 expiresAt:new Date(Date.now()+60000).toISOString()
});
const matching=await runner.execute(
 matchingMission,
 {missionId:matchingMission.id,agentId:agent.agentId,tool:"echo",action:"echo",permission:"L1_READ",idempotencyKey:"project-isolation-right",payload:"ok"},
 {async execute(){return{ok:true};}},
 undefined,
 {projectId:"project-a",capabilityId:matchingCapability.id}
);
if(!matching.ok)throw new Error("Matching project execution was incorrectly blocked.");

console.log("Project isolation enforcement passed.");
