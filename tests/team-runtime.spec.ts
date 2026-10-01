import {LayanXCore} from "../src/core/orchestrator.js";

const core=new LayanXCore();
core.registerAgent({agentId:"a",purpose:"work",allowedTools:[],forbiddenResources:[],requiredPermission:"L1_READ",maxToolCalls:5,maxRuntimeMs:1000,successCriteria:[],stopCondition:"stop"});
core.registerAgent({agentId:"b",purpose:"repair",allowedTools:[],forbiddenResources:[],requiredPermission:"L1_READ",maxToolCalls:5,maxRuntimeMs:1000,successCriteria:[],stopCondition:"stop"});
const mission=core.startMission("team","project-a");
const t=core.teams.build(mission.id,[core.agents.get("a"),core.agents.get("b")],"work");
t[1].dependsOn=[t[0].id];
let first=true;
const result=await core.executeAgentTeam(mission.id,"project-a",t,{
 async execute(task){
  if(task.id===t[0].id&&first){first=false;return{ok:false,error:"transient"}}
  return{ok:true};
 },
 async repair(){return true;}
});
if(result.failed.length||result.blocked.length||result.completed.length!==2)throw new Error("Team dependency/repair execution failed.");
if(result.repaired.length!==1)throw new Error("Bounded repair was not recorded.");

const other=await core.executeAgentTeam(mission.id,"project-b",t,{async execute(){return{ok:true}}}).then(()=>null).catch(error=>String(error));
if(!other?.includes("Project isolation"))throw new Error("Team project isolation was not enforced.");

const noRepair=await core.executeAgentTeam(mission.id,"project-a",t,{async execute(){return{ok:false,error:"hard failure"}}},1);
if(noRepair.completed.length!==0)throw new Error("Failed team task unexpectedly completed.");

console.log("Agent team runtime tests passed.");
