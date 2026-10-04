import {LayanXCore} from "../src/core/orchestrator.js";

const core=new LayanXCore();
core.registerAgent({
 agentId:"core",purpose:"approval test",allowedTools:["dangerous.read"],forbiddenResources:[],
 requiredPermission:"L1_READ",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["approved"],stopCondition:"stop"
});
core.tools.register({name:"dangerous.read",description:"approval test",permission:"L1_READ",dangerous:true,actions:["run sensitive test"],tags:["test"]});
let calls=0;
core.toolAdapters.register("dangerous.read",{async execute(){calls++;return{approved:true};}});

const mission=core.startMission("approval workflow","approval-project");
mission.requiredPermission="L1_READ";
mission.tools=[{tool:"dangerous.read",action:"run sensitive test",permission:"L1_READ",reason:"approval workflow"}];
core.missions.save(mission);

const blocked=await core.executeMissionTool(mission.id,mission.projectId,0,{});
if(blocked.ok||!blocked.approvalId)throw new Error("Missing approval did not create an approval request.");
const approvalId=blocked.approvalId;
const listed=core.executionRuntime.approvals.get(approvalId);
if(listed.missionId!==mission.id)throw new Error("Approval request is not scoped to the mission.");

core.executionRuntime.approvals.approve(approvalId);
const resumed=await core.executeMissionTool(mission.id,mission.projectId,0,{},approvalId);
if(!resumed.ok||!resumed.verified||calls!==1)throw new Error(resumed.error??"Approved execution did not resume.");
console.log("Runtime approval workflow passed.");
