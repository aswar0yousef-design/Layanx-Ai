import type {AgentContract} from "./contracts.js";
import {DelegationManager} from "./delegation.js";
export interface TeamResult{completed:number;failed:number;tasks:string[];}
export class AgentTeam{
 constructor(private readonly delegation:DelegationManager){}
 build(parentMissionId:string,agents:AgentContract[],goal:string){
  if(!agents.length)throw new Error("Agent team requires at least one agent.");
  return agents.map((agent,i)=>this.delegation.create(parentMissionId,agent,goal+" [workstream "+(i+1)+"]"));
 }
 summarize(parentMissionId:string):TeamResult{
  const tasks=this.delegation.forMission(parentMissionId);
  return{completed:tasks.filter(t=>t.status==="completed").length,failed:tasks.filter(t=>t.status==="failed").length,tasks:tasks.map(t=>t.id)};
 }
}
