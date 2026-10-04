import {MemoryEngine} from "../src/core/memory.js";
import {LayanXCore} from "../src/core/orchestrator.js";
import {MissionRunner} from "../src/core/mission-runner.js";

const memory=new MemoryEngine();
const secretValue=["super","secret","value"].join("-");
const entry=memory.remember({
  missionId:"m1",kind:"success",summary:"Verified deployment",confidence:1,tags:["deploy"],
  content:{result:"ok",apiKey:secretValue,nested:{authorization:"Bearer abcdefghijkl"}}
});
const serialized=JSON.stringify(entry.content);
if(serialized.includes("super-secret-value")||serialized.includes("Bearer abcdefghijkl"))throw new Error("Memory firewall leaked sensitive material.");
if(!memory.recall("verified deployment").length)throw new Error("Memory recall failed.");

const core=new LayanXCore();
const agent={agentId:"memory-runner",purpose:"execute",allowedTools:["terminal.run"],forbiddenResources:[],requiredPermission:"L2_ANALYZE" as const,maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"};
core.registerAgent(agent);
core.tools.register({name:"terminal.run",description:"Run command",permission:"L2_ANALYZE",dangerous:false});
const mission=core.startMission("Remember verified command","default");
mission.requiredPermission="L2_ANALYZE";
const capability=core.capabilities.issue({missionId:mission.id,agentId:agent.agentId,projectId:"default",resource:"terminal.run",permission:"L2_ANALYZE",expiresAt:new Date(Date.now()+60000).toISOString()});
const runner=new MissionRunner(core);
const result=await runner.executeAction(mission,agent,"run command",{command:"echo ok"},{async execute(){return{done:true};}},undefined,{projectId:"default",capabilityId:capability.id});
if(!result.result.ok)throw new Error("Verified runtime result was not produced: "+JSON.stringify(result.result));
if(!core.memory.recall("Remember verified command").some(item=>item.missionId===mission.id))throw new Error("Verified mission result was not remembered.");
console.log("Verified memory and final-result integration test passed.");
