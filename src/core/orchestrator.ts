import {MissionPlanner} from "./mission.js";
import {PolicyEngine} from "../security/policy.js";
import {Sentinel} from "../security/sentinel.js";
import type {PermissionLevel,ToolRequest} from "./types.js";
export class LayanXCore{
 readonly planner=new MissionPlanner(); readonly policy=new PolicyEngine(); readonly sentinel=new Sentinel();
 startMission(goal:string){return this.planner.create(goal);}
 authorize(request:ToolRequest,granted:PermissionLevel){
  const policy=this.policy.evaluate(request,granted); if(!policy.allowed)return policy;
  return this.sentinel.inspect(request.action);
 }
}