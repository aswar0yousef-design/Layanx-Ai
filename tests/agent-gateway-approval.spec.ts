import {LayanXCore} from "../src/core/orchestrator.js";

const core=new LayanXCore();
core.registerAgent({agentId:"core",purpose:"gateway approval",allowedTools:["dangerous.read"],forbiddenResources:[],requiredPermission:"L1_READ",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["approved"],stopCondition:"stop"});
core.tools.register({name:"dangerous.read",description:"gateway approval test",permission:"L1_READ",dangerous:true,actions:["run sensitive test"],tags:["test"]});
core.toolAdapters.register("dangerous.read",{async execute(){return{approved:true};}});
const mission=core.startMission("gateway approval","gateway-approval-project");
mission.requiredPermission="L1_READ";
mission.tools=[{tool:"dangerous.read",action:"run sensitive test",permission:"L1_READ",reason:"gateway approval"}];
core.missions.save(mission);

const first=await core.executeAgentLoop(mission.id,mission.projectId,2,{}, "core");
if(!first.paused||first.status!=="awaiting_approval"||!first.approvalId)throw new Error("Gateway did not pause with an approval id.");

core.executionRuntime.approvals.approve(first.approvalId);
const second=await core.executeAgentLoop(mission.id,mission.projectId,2,{0:first.approvalId},"core");
if(!second.completed||second.status!=="completed")throw new Error(JSON.stringify(second));

console.log("Agent gateway approval pause/resume passed.");
