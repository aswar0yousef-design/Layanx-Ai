import type {AgentContract} from "./contracts.js";
export interface DelegatedTask{id:string;parentMissionId:string;agentId:string;goal:string;dependsOn:string[];status:"pending"|"running"|"completed"|"failed";}
export class DelegationManager{
 private readonly tasks=new Map<string,DelegatedTask>();
 create(parentMissionId:string,agent:AgentContract,goal:string,dependsOn:string[]=[]):DelegatedTask{
  const task={id:crypto.randomUUID(),parentMissionId,agentId:agent.agentId,goal,dependsOn,status:"pending" as const};
  this.tasks.set(task.id,task);return task;
 }
 start(id:string){const t=this.get(id);const next={...t,status:"running" as const};this.tasks.set(id,next);return next;}
 complete(id:string){const t=this.get(id);const next={...t,status:"completed" as const};this.tasks.set(id,next);return next;}
 fail(id:string){const t=this.get(id);const next={...t,status:"failed" as const};this.tasks.set(id,next);return next;}
 get(id:string){const t=this.tasks.get(id);if(!t)throw new Error("Unknown delegated task: "+id);return t;}
 forMission(id:string){return[...this.tasks.values()].filter(t=>t.parentMissionId===id);}
}
