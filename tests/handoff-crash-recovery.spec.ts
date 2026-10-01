import {LayanXCore} from "../src/core/orchestrator.js";
import {RuntimePersistence} from "../src/core/runtime-persistence.js";
import {RuntimeStorage} from "../src/storage/runtime-storage.js";
import {RuntimeRecoveryManager} from "../src/core/runtime-recovery.js";
import {MissionRunner} from "../src/core/mission-runner.js";
import type {StorageAdapter,Transaction} from "../src/storage/repository.js";

class MemoryStorage implements StorageAdapter{
 private state=new Map<string,unknown>();
 async transaction<T>(work:(tx:Transaction)=>Promise<T>):Promise<T>{
  const tx:Transaction={
   get:async<T>(key:string)=>structuredClone(this.state.get(key)) as T|undefined,
   set:async<T>(key:string,value:T)=>{this.state.set(key,structuredClone(value));},
   commit:async()=>undefined,
   rollback:async()=>undefined
  };
  return work(tx);
 }
}

const storage=new MemoryStorage();
const persistence=new RuntimePersistence(new RuntimeStorage(storage));
const core=new LayanXCore(undefined,persistence);
const agent={agentId:"handoff-agent",purpose:"execute handoff",allowedTools:["terminal.run"],forbiddenResources:[],requiredPermission:"L4_EXECUTE" as const,maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"};
core.registerAgent(agent);
core.tools.register({name:"terminal.run",description:"Run command",permission:"L4_EXECUTE",dangerous:true});
const mission=core.startMission("Crash-safe handoff");
mission.requiredPermission="L4_EXECUTE";
mission.steps=[{id:"execute",description:"Execute handoff action",status:"pending"},{id:"verify",description:"Verify result",status:"pending"}];
const handoff=core.handoffs.create({
 missionId:mission.id,fromAgentId:"source",toAgent:agent,goal:"Finish delegated work",context:{scope:"test"},
 requiredPermission:"L4_EXECUTE",execution:{action:"run command",tool:"terminal.run",payload:{command:"echo ok"}}
});
core.handoffs.accept(handoff.id);
const cap=core.capabilities.issue({missionId:mission.id,agentId:agent.agentId,projectId:"p",resource:"terminal.run",permission:"L4_EXECUTE",expiresAt:new Date(Date.now()+60000).toISOString()});
let executions=0;
const originalPersist=core.executionRuntime.persist.bind(core.executionRuntime);
core.executionRuntime.persist=async current=>{
 if(current.status==="completed" && core.handoffs.get(handoff.id).status==="completed")throw new Error("SIMULATED_CRASH_BEFORE_FINAL_PERSIST");
 await originalPersist(current);
};
let crashed=false;
try{
 await new MissionRunner(core).executeHandoff(mission,handoff,{async execute(){executions++;return{done:true};}},{projectId:"p",capabilityId:cap.id});
}catch(error){
 crashed=error instanceof Error && error.message==="SIMULATED_CRASH_BEFORE_FINAL_PERSIST";
}
if(!crashed)throw new Error("Crash-after-handoff was not simulated.");
if(executions!==1)throw new Error("Initial handoff execution count is incorrect.");

const persisted=await persistence.get(mission.id);
if(!persisted||persisted.mission.status!=="completed")throw new Error("Completed mission state was not persisted before the simulated crash.");
if(persisted.handoffs?.[0]?.status!=="accepted")throw new Error("Persisted handoff should still be accepted after the simulated crash.");
if(!persisted.idempotency?.some(record=>record.status==="completed"))throw new Error("Completed handoff idempotency record was not persisted.");

const recovered=new LayanXCore(undefined,persistence);
recovered.registerAgent(agent);
recovered.tools.register({name:"terminal.run",description:"Run command",permission:"L4_EXECUTE",dangerous:true});
const recovery=new RuntimeRecoveryManager(persistence,recovered);
const request={missionId:mission.id,agentId:agent.agentId,tool:"terminal.run",action:"run command",permission:"L4_EXECUTE" as const,idempotencyKey:["handoff",handoff.id,mission.id,agent.agentId,"terminal.run","run command"].join(":"),payload:{command:"echo ok"}};
const recoveredResult=await recovery.resume(mission.id,request,{async execute(){executions++;throw new Error("HANDOFF_EXECUTED_TWICE");}},{projectId:"p",capabilityId:recovered.capabilities.issue({missionId:mission.id,agentId:agent.agentId,projectId:"p",resource:"terminal.run",permission:"L4_EXECUTE",expiresAt:new Date(Date.now()+60000).toISOString()}).id});
if(!recoveredResult.ok||!recoveredResult.verified)throw new Error("Crash recovery did not reconcile the completed handoff.");
if(executions!==1)throw new Error("Handoff was executed twice after recovery.");
const final=await persistence.get(mission.id);
if(!final||final.handoffs?.[0]?.status!=="completed")throw new Error("Recovered handoff was not finalized.");
if(final.nextAction?.kind!=="complete")throw new Error("Recovered next action is not complete.");
console.log("Crash after handoff completion -> recovery without duplicate execution passed.");
