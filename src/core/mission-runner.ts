import type {Mission,ToolRequest} from "./types.js";
import type {ToolAdapter} from "../tools/executor.js";
import type {AgentContract} from "./contracts.js";
import {ToolSelector} from "./tool-selection.js";
import {ExecutionRuntime} from "./runtime.js";
import {Replanner} from "./replan.js";
import type {RuntimeSecurityContext} from "./runtime.js";

export class MissionRunner{
 private readonly runtime:ExecutionRuntime;
 private readonly selector:ToolSelector;
 private readonly replanner=new Replanner();
 constructor(private readonly core:ConstructorParameters<typeof ExecutionRuntime>[0]){this.runtime=core.executionRuntime;this.selector=new ToolSelector(core.tools);}
 async execute(mission:Mission,request:ToolRequest,adapter:ToolAdapter,approvalId?:string,security?:RuntimeSecurityContext){
  let current=mission;
  let currentRequest=request;
  for(let attempt=0;attempt<2;attempt++){
   const result=await this.runtime.run(current,currentRequest,adapter,approvalId,security);
   if(result.ok){
    Object.assign(mission,current);
    return result;
   }
   if(!result.recoverable)return result;
   const replanned=this.replanner.replan(current,{code:"EXECUTION_FAILURE",message:result.error??"Execution failed",recoverable:true});
   if(replanned===current)return result;
   current=replanned;
   Object.assign(mission,current);
   this.core.executionStates.update(current.id,{status:"running"});
   await this.runtime.persist(current);
   currentRequest={...currentRequest,idempotencyKey:`${request.idempotencyKey}:retry:${attempt+1}`};
  }
  return{ok:false,missionId:mission.id,verified:false,error:"Mission failed after recovery attempt.",recoverable:false};
 }
 async executeHandoff(mission:Mission,handoff:import("./handoff.js").MissionHandoff,adapter:ToolAdapter,security:RuntimeSecurityContext,approvalId?:string){
  if(handoff.missionId!==mission.id)throw new Error("Handoff does not belong to the mission.");
  if(handoff.status!=="accepted")throw new Error("Handoff must be accepted before execution.");
  if(!handoff.execution)throw new Error("Handoff has no execution descriptor.");
  const agent=this.core.agents.get(handoff.toAgentId);
  if(!agent.allowedTools.includes(handoff.execution.tool))throw new Error("Handoff tool is not allowed for the target agent.");
  if(agent.requiredPermission==="L5_CRITICAL" && handoff.requiredPermission!=="L5_CRITICAL")throw new Error("Handoff permission is below the target agent requirement.");
  const selection=this.selector.select(handoff.execution.action,agent,mission.requiredPermission);
  const selected=selection.find(item=>item.tool.name===handoff.execution!.tool);
  if(!selected)throw new Error("Handoff tool or permission is not authorized.");
  if(selected.tool.permission!==handoff.requiredPermission)throw new Error("Handoff execution permission mismatch.");
  const request:ToolRequest={
   missionId:mission.id,agentId:agent.agentId,tool:selected.tool.name,action:handoff.execution.action,
   permission:handoff.requiredPermission,idempotencyKey:["handoff",handoff.id,mission.id,agent.agentId,selected.tool.name,handoff.execution.action].join(":"),
   payload:handoff.execution.payload
  };
  const result=await this.execute(mission,request,adapter,approvalId,security);
  if(!result.ok)return{handoff:this.core.handoffs.get(handoff.id),request,result};
  this.core.handoffs.complete(handoff.id);
  this.core.memory.remember({
   missionId:mission.id,kind:"handoff",summary:handoff.goal,
   content:{handoffId:handoff.id,fromAgentId:handoff.fromAgentId,toAgentId:handoff.toAgentId,tool:selected.tool.name,action:handoff.execution.action,verified:true},
   confidence:1,tags:["handoff",selected.tool.name]
  });
  await this.runtime.persist(mission);
  return{handoff:this.core.handoffs.get(handoff.id),request,result};
 }

 async executeAction(mission:Mission,agent:AgentContract,action:string,payload:unknown,adapter:ToolAdapter,approvalId?:string,security?:RuntimeSecurityContext){
  const selection=this.selector.select(action,agent,mission.requiredPermission);
  const selected=selection[0];
  if(!selected)throw new Error("No authorized tool matches the requested action.");
  const step=mission.steps.find(candidate=>candidate.status==="pending");
  if(!step)throw new Error("No pending mission step is available.");
  const task=this.core.delegation.create(mission.id,agent,step.description);
  this.core.delegation.start(task.id);
  const request:ToolRequest={
   missionId:mission.id,agentId:agent.agentId,tool:selected.tool.name,action,
   permission:selected.tool.permission,
   idempotencyKey:[mission.id,agent.agentId,step.id,selected.tool.name,action].join(":"),
   payload
  };
  const result=await this.execute(mission,request,adapter,approvalId,security);
  step.status=result.ok?"completed":"failed";
  if(result.ok)this.core.delegation.complete(task.id);else this.core.delegation.fail(task.id);
  return{task,tool:selected.tool.name,request,result};
 }

 buildTeam(mission:Mission,agents:AgentContract[]){
  if(!agents.length)throw new Error("Mission requires at least one agent.");
  if(new Set(agents.map(agent=>agent.agentId)).size!==agents.length)throw new Error("Mission team contains duplicate agent IDs.");
  return this.core.teams.build(mission.id,agents,mission.goal);
 }

}
