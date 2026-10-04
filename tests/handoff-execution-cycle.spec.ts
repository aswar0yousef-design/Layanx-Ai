import {LayanXCore} from "../src/core/orchestrator.js";
import {MissionRunner} from "../src/core/mission-runner.js";

const core=new LayanXCore();
const agentA={agentId:"agent-a",purpose:"prepare",allowedTools:["terminal.run"],forbiddenResources:[],requiredPermission:"L2_ANALYZE" as const,maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"};
const agentB={agentId:"agent-b",purpose:"execute handoff",allowedTools:["terminal.run"],forbiddenResources:[],requiredPermission:"L2_ANALYZE" as const,maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"};
core.registerAgent(agentA);core.registerAgent(agentB);
core.tools.register({name:"terminal.run",description:"Run command",permission:"L2_ANALYZE",dangerous:false});
const mission=core.startMission("Execute delegated handoff");
mission.requiredPermission="L2_ANALYZE";
mission.steps=[
 {id:"execute",description:"Execute handoff action",status:"pending"},
 {id:"verify",description:"Verify result",status:"pending"}
];
const handoff=core.handoffs.create({
 missionId:mission.id,fromAgentId:agentA.agentId,toAgent:agentB,
 goal:"Run the delegated command",context:{scope:"test"},
 requiredPermission:"L2_ANALYZE",
 execution:{action:"run command",tool:"terminal.run",payload:{command:"echo ok"}}
});
core.handoffs.accept(handoff.id);
const cap=core.capabilities.issue({missionId:mission.id,agentId:agentB.agentId,projectId:"p",resource:"terminal.run",permission:"L2_ANALYZE",expiresAt:new Date(Date.now()+60000).toISOString()});
const runner=new MissionRunner(core);
const result=await runner.executeHandoff(mission,core.handoffs.get(handoff.id),{async execute(){return{done:true};}},{projectId:"p",capabilityId:cap.id});
if(!result.result.ok||!result.result.verified)throw new Error("Handoff execution was not verified.");
if(core.handoffs.get(handoff.id).status!=="completed")throw new Error("Handoff was not completed.");
if(!core.memory.recall("Run the delegated command").some(x=>x.kind==="handoff"))throw new Error("Verified handoff was not remembered.");
console.log("Accepted handoff -> secured execution -> verification -> memory passed.");