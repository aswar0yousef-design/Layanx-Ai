import {LayanXCore} from "../src/core/orchestrator.js";
import {MissionRunner} from "../src/core/mission-runner.js";

const core=new LayanXCore();
const agent={
  agentId:"retry-agent",purpose:"recover failed execution",allowedTools:["terminal.run"],
  forbiddenResources:[],requiredPermission:"L4_EXECUTE" as const,maxToolCalls:5,maxRuntimeMs:10000,
  successCriteria:["done"],stopCondition:"stop"
};
core.registerAgent(agent);
core.tools.register({name:"terminal.run",description:"Run command",permission:"L4_EXECUTE",dangerous:true});

const mission=core.startMission("Recover a failed command","retry-project");
mission.requiredPermission="L4_EXECUTE";
mission.steps=[
  {id:"prepare",description:"Prepare execution",status:"pending"},
  {id:"execute",description:"Execute command",status:"pending"},
  {id:"verify",description:"Verify result",status:"pending"}
];

const capability=core.capabilities.issue({
  missionId:mission.id,agentId:agent.agentId,projectId:"retry-project",
  resource:"terminal.run",permission:"L4_EXECUTE",expiresAt:new Date(Date.now()+60000).toISOString()
});

const runner=new MissionRunner(core);
let calls=0;
const result=await runner.execute(
  mission,
  {missionId:mission.id,agentId:agent.agentId,tool:"terminal.run",action:"run command",permission:"L4_EXECUTE",idempotencyKey:"retry-flow",payload:{}},
  {async execute(){
    calls++;
    if(calls===1)throw new Error("temporary failure");
    return{done:true};
  }},
  undefined,
  {projectId:"retry-project",capabilityId:capability.id}
);

if(!result.ok||!result.verified)throw new Error(result.error??"Replan retry did not recover the mission.");
if(calls!==2)throw new Error("Recovery retry did not execute exactly once per attempt.");
if(mission.status!=="completed")throw new Error("Recovered mission did not complete.");
if(core.idempotency instanceof Object){
  const records=await core.idempotency.list();
  if(!records.some(record=>record.key==="retry-flow"&&record.status==="failed"))throw new Error("Original failed attempt was not preserved.");
  if(!records.some(record=>record.key==="retry-flow:retry:1"&&record.status==="completed"))throw new Error("Retry attempt was not recorded independently.");
}
console.log("Failure, replan, retry, verification and idempotency test passed.");
