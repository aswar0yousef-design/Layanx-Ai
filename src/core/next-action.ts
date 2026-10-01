import type {Mission} from "./types.js";
import type {DelegatedTask} from "./delegation.js";
import type {MissionHandoff} from "./handoff.js";

export type NextActionKind="complete"|"handoff"|"retry"|"blocked"|"none";

export interface NextAction{
 kind:NextActionKind;
 reason:string;
 missionId:string;
 targetAgentId?:string;
 goal?:string;
 sourceTaskId?:string;
}

export class NextActionEngine{
 decide(input:{
  mission:Mission;
  tasks:DelegatedTask[];
  handoffs:MissionHandoff[];
 }):NextAction{
  const {mission,tasks,handoffs}=input;
  if(mission.status==="completed")return{kind:"complete",reason:"Mission verification completed.",missionId:mission.id};
  if(mission.status==="blocked")return{kind:"blocked",reason:"Mission is blocked by a security or policy gate.",missionId:mission.id};
  const pendingHandoff=handoffs.find(h=>h.status==="pending"||h.status==="accepted");
  if(pendingHandoff)return{kind:"handoff",reason:"A scoped handoff is awaiting execution.",missionId:mission.id,targetAgentId:pendingHandoff.toAgentId,goal:pendingHandoff.goal};
  const failed=tasks.find(t=>t.status==="failed");
  if(failed)return{kind:"retry",reason:"A delegated task failed and is eligible for recovery.",missionId:mission.id,sourceTaskId:failed.id};
  const pending=tasks.find(t=>t.status==="pending");
  if(pending)return{kind:"handoff",reason:"A delegated workstream is pending.",missionId:mission.id,targetAgentId:pending.agentId,goal:pending.goal,sourceTaskId:pending.id};
  return{kind:"none",reason:"No executable next action is currently available.",missionId:mission.id};
 }
}
