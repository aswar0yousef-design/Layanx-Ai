import {LayanXCore} from "../src/core/orchestrator.js";
import {MissionRunner} from "../src/core/mission-runner.js";

const core=new LayanXCore();
const a={agentId:"agent-a",purpose:"prepare work",allowedTools:["terminal.run"],forbiddenResources:[],requiredPermission:"L4_EXECUTE" as const,maxToolCalls:3,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"};
const b={agentId:"agent-b",purpose:"execute handoff",allowedTools:["terminal.run"],forbiddenResources:[],requiredPermission:"L4_EXECUTE" as const,maxToolCalls:3,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"};
core.registerAgent(a);core.registerAgent(b);
core.tools.register({name:"terminal.run",description:"Execute terminal command",permission:"L4_EXECUTE",dangerous:true});
const mission=core.startMission("Prepare and execute through two agents");
mission.requiredPermission="L4_EXECUTE";
const source=core.delegation.create(mission.id,a,"Prepare the execution context");
core.delegation.start(source.id);
core.delegation.complete(source.id);

const handoff=core.handoffs.create({
 missionId:mission.id,fromAgentId:a.agentId,toAgent:b,goal:"Execute the prepared command",
 context:{sourceTaskId:source.id,prepared:true},
 execution:{action:"execute terminal command",payload:{command:"echo handoff"},tool:"terminal.run"},
 requiredPermission:"L4_EXECUTE"
});
const next=core.nextAction.decide({mission,tasks:core.delegation.forMission(mission.id),handoffs:core.handoffs.forMission(mission.id)});
if(next.kind!=="handoff"||next.targetAgentId!==b.agentId)throw new Error("Next action did not route to the handoff target.");

const capability=core.capabilities.issue({missionId:mission.id,agentId:b.agentId,projectId:"handoff-project",resource:"terminal.run",permission:"L4_EXECUTE",expiresAt:new Date(Date.now()+60000).toISOString()});
const runner=new MissionRunner(core);
let calls=0;
const result=await runner.executeHandoff(mission,handoff,{async execute(){calls++;return{done:true,output:"handoff"};}},{projectId:"handoff-project",capabilityId:capability.id});
if(!result.result.ok||!result.result.verified)throw new Error("Handoff execution was not verified.");
if(calls!==1)throw new Error("Handoff tool executed more than once.");
if(core.handoffs.get(handoff.id).status!=="completed")throw new Error("Handoff was not completed.");
if(core.delegation.get(result.task.id).status!=="completed")throw new Error("Handoff delegated task was not completed.");
if(mission.status!=="completed")throw new Error("Mission did not complete after handoff.");
if(!core.memory.recall("Execute the prepared command").some(e=>e.kind==="handoff"&&e.missionId===mission.id))throw new Error("Handoff context was not remembered.");
const terminal=core.nextAction.decide({mission,tasks:core.delegation.forMission(mission.id),handoffs:core.handoffs.forMission(mission.id)});
if(terminal.kind!=="complete")throw new Error("Next action did not reach terminal completion.");
console.log("Multi-stage handoff execution and next-action integration test passed.");
