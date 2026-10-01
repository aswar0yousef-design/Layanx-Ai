import type {Mission,ToolRequest} from "./types.js";
import type {ToolAdapter} from "../tools/executor.js";
import type {AgentContract} from "./contracts.js";
import {ToolSelector} from "./tool-selection.js";
import {ExecutionRuntime} from "./runtime.js";
import {Replanner} from "./replan.js";
import type {RuntimeSecurityContext} from "./runtime.js";\nimport type {MissionHandoff} from "./handoff.js";

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
   currentRequest={...currentRequest,idempotencyKey:`${request.idempotencyKey}:retry:${attempt+1}`};
  }
  return{ok:false,missionId:mission.id,verified:false,error:"Mission failed after recovery attempt.",recoverable:false};
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
