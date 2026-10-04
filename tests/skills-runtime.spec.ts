import {LayanXCore} from "../src/core/orchestrator.js";

const core=new LayanXCore();
core.registerAgent({
 agentId:"core",purpose:"skill test",allowedTools:["runtime.status"],forbiddenResources:[],
 requiredPermission:"L1_READ",maxToolCalls:10,maxRuntimeMs:10000,
 successCriteria:["result.ready === true"],stopCondition:"stop"
});
core.tools.register({name:"runtime.status",description:"read runtime status",permission:"L1_READ",dangerous:false,actions:["read runtime status"],tags:["runtime"]});
core.toolAdapters.register("runtime.status",{async execute(){return{ready:true};}});

const mission=core.startMission("Run status skill","project-a");
mission.requiredPermission="L1_READ";
mission.successCriteria=["result.ready === true"];
mission.steps=[{id:"execute",description:"execute runtime status",status:"completed"}];
mission.tools=[{tool:"runtime.status",action:"read runtime status",permission:"L1_READ",reason:"skill fixture"}];
core.missions.save(mission);

core.skills.register({
 id:"status-skill",name:"Status Skill",version:"1.0.0",description:"read runtime status",
 source:"builtin",license:"internal",permissions:["L1_READ"],tools:["runtime.status"],networkHosts:[],checksum:"fixture",status:"discovered"
});
core.skills.approve("status-skill");
core.skills.enable("status-skill");

const result=await core.executeSkill("status-skill",mission.id,"project-a");
if(!result.completed||result.results.length!==1)throw new Error("Enabled skill did not complete.");
if(core.missions.get(mission.id).status!=="completed")throw new Error("Skill execution did not complete mission.");

const wrongProject=await core.executeSkill("status-skill",mission.id,"project-b").then(()=>null).catch(error=>String(error));
if(!wrongProject?.includes("project isolation"))throw new Error("Skill project isolation was not enforced.");

core.skills.disable("status-skill");
const disabled=await core.executeSkill("status-skill",mission.id,"project-a").then(()=>null).catch(error=>String(error));
if(!disabled?.includes("not enabled"))throw new Error("Disabled skill was executable.");

console.log("Skills runtime tests passed.");
