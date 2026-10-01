import {LayanXCore} from "../src/core/orchestrator.js";

const core=new LayanXCore();
const first={agentId:"planner-agent",purpose:"prepare work",allowedTools:["analyze"],forbiddenResources:[],requiredPermission:"L2_ANALYZE" as const,maxToolCalls:3,maxRuntimeMs:10000,successCriteria:["ready"],stopCondition:"stop"};
const second={agentId:"executor-agent",purpose:"execute work",allowedTools:["execute"],forbiddenResources:[],requiredPermission:"L4_EXECUTE" as const,maxToolCalls:3,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"};
core.registerAgent(first);core.registerAgent(second);
core.tools.register({name:"analyze",description:"Analyze",permission:"L2_ANALYZE",dangerous:false});
core.tools.register({name:"execute",description:"Execute",permission:"L4_EXECUTE",dangerous:true});

const mission=core.startMission("Prepare then execute a workflow");
mission.requiredPermission="L4_EXECUTE";

const task=core.delegation.create(mission.id,first,"Prepare the workflow");
const handoff=core.handoffs.create({
 missionId:mission.id,fromAgentId:first.agentId,toAgent:second,goal:"Execute the prepared workflow",
 context:{prepared:true,sourceTaskId:task.id},requiredPermission:"L4_EXECUTE"
});
const next=core.nextAction.decide({mission,tasks:core.delegation.forMission(mission.id),handoffs:core.handoffs.forMission(mission.id)});
if(next.kind!=="handoff"||next.targetAgentId!==second.agentId)throw new Error("Next action did not select the pending handoff.");

core.handoffs.accept(handoff.id);
const accepted=core.nextAction.decide({mission,tasks:core.delegation.forMission(mission.id),handoffs:core.handoffs.forMission(mission.id)});
if(accepted.kind!=="handoff")throw new Error("Accepted handoff lost its next action.");

core.handoffs.complete(handoff.id);
mission.status="completed";
const done=core.nextAction.decide({mission,tasks:core.delegation.forMission(mission.id),handoffs:core.handoffs.forMission(mission.id)});
if(done.kind!=="complete")throw new Error("Completed mission did not produce a terminal next action.");

const badAgent={...second,agentId:"critical-agent",requiredPermission:"L5_CRITICAL" as const};
try{
 core.handoffs.create({missionId:mission.id,fromAgentId:first.agentId,toAgent:badAgent,goal:"invalid",context:{},requiredPermission:"L4_EXECUTE"});
 throw new Error("Permission escalation was accepted.");
}catch(error){
 if(!(error instanceof Error)||!error.message.includes("cannot exceed"))throw error;
}

console.log("Mission handoff and next-action test passed.");
