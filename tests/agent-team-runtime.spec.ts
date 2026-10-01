import {LayanXCore} from "../src/core/orchestrator.js";
import {MissionRunner} from "../src/core/mission-runner.js";

const core=new LayanXCore();
const agent={agentId:"ops",purpose:"run commands",allowedTools:["terminal.run"],forbiddenResources:[],requiredPermission:"L4_EXECUTE" as const,maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"};
core.registerAgent(agent);
core.tools.register({name:"terminal.run",description:"Run command",permission:"L4_EXECUTE",dangerous:true});

const mission=core.startMission("Run command");
const runner=new MissionRunner(core);
const tasks=runner.buildTeam(mission,[agent]);
if(tasks.length!==1)throw new Error("Agent team was not built.");
const capability=core.capabilities.issue({
  missionId:mission.id,agentId:"ops",projectId:"project-1",resource:"terminal.run",
  permission:"L4_EXECUTE",expiresAt:new Date(Date.now()+60000).toISOString()
});
const result=await runner.executeAction(mission,agent,"run command",{command:"echo ok"},{
  async execute(){return{done:true};}
},undefined,{projectId:"project-1",capabilityId:capability.id});
if(!result.result.ok||result.tool!=="terminal.run")throw new Error("Agent delegation did not reach secured execution.");
if(core.delegation.get(result.task.id).status!=="completed")throw new Error("Delegated task was not completed.");
console.log("Agent team, tool selection and runtime integration test passed.");
