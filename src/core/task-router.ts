import {ModelRouter} from "./model-router.js";
import type {AgentContract,AgentRole} from "./contracts.js";
import {AgentManager} from "./agent-manager.js";
import type {DecomposedTask,TaskDecomposition} from "./task-decomposition.js";
import type {ModelDefinition} from "../models/registry.js";
import type {PermissionLevel} from "./types.js";

const rank:Record<PermissionLevel,number>={L1_READ:1,L2_ANALYZE:2,L3_MODIFY:3,L4_EXECUTE:4,L5_CRITICAL:5};

export interface TaskAssignment{
 taskId:string;
 agentId:string;
 role:AgentRole;
 modelId:string;
 capability:DecomposedTask["capability"];
 reason:string[];
}

export class TaskRouter{
 constructor(private readonly agents:AgentManager,private readonly models:ModelRouter){}

 assign(decomposition:TaskDecomposition):TaskAssignment[]{
  return decomposition.tasks.map(task=>{
   const candidates=this.agents.list().filter(agent=>rank[agent.requiredPermission]>=rank[task.permission]);
   if(!candidates.length)throw new Error("No agent has sufficient permission for task: "+task.id);
   const scored=candidates.map(agent=>({agent,score:this.agentScore(agent,task),reasons:this.reasons(agent,task)}))
    .sort((a,b)=>b.score-a.score||a.agent.agentId.localeCompare(b.agent.agentId));
   const selected=scored[0];
   const model=this.selectModel(task,selected.agent);
   return{taskId:task.id,agentId:selected.agent.agentId,role:selected.agent.profile?.role??this.inferRole(task.capability),modelId:model.id,capability:task.capability,reason:[...selected.reasons,"Model "+model.id+" selected for "+task.capability+"."]};
  });
 }

 private agentScore(agent:AgentContract,task:DecomposedTask){
  const role=this.inferRole(task.capability);
  let score=0;
  if(agent.profile?.role===role)score+=50;
  if(agent.profile?.preferredCapabilities.includes(task.capability))score+=30;
  if(agent.successCriteria.some(item=>task.successCriteria.some(criteria=>item.toLowerCase().includes(criteria.toLowerCase())||criteria.toLowerCase().includes(item.toLowerCase()))))score+=5;
  score-=Math.max(0,rank[agent.requiredPermission]-rank[task.permission]);
  return score;
 }

 private reasons(agent:AgentContract,task:DecomposedTask){
  const reasons:string[]=[];
  if(agent.profile?.role===this.inferRole(task.capability))reasons.push("Agent profile role matches task capability.");
  if(agent.profile?.preferredCapabilities.includes(task.capability))reasons.push("Agent profile explicitly prefers this capability.");
  if(!reasons.length)reasons.push("Agent satisfies the required permission.");
  return reasons;
 }

 private selectModel(task:DecomposedTask,agent:AgentContract):ModelDefinition{
  const profile=agent.profile;
  return this.models.select(task.capability,{tags:[task.capability,...(profile?.preferredCapabilities??[]),profile?.role??"general"],latencySensitive:task.capability==="chat"||task.capability==="audio",preferLocal:profile?.role==="developer"||profile?.role==="analyst"});
 }

 private inferRole(capability:DecomposedTask["capability"]):AgentRole{
  switch(capability){
   case "coding":return "developer";
   case "vision":return "analyst";
   case "embedding":return "researcher";
   case "audio":return "general";
   case "reasoning":return "orchestrator";
   default:return "general";
  }
 }
}