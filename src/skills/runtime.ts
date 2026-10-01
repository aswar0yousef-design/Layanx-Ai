import type {PermissionLevel,Mission} from "../core/types.js";
import {SkillRegistry} from "./registry.js";

const rank:Record<PermissionLevel,number>={L1_READ:1,L2_ANALYZE:2,L3_MODIFY:3,L4_EXECUTE:4,L5_CRITICAL:5};

export interface SkillExecutionResult{
 skillId:string;
 missionId:string;
 projectId:string;
 results:unknown[];
 completed:boolean;
 reason?:string;
}

export interface SkillExecutor{
 (missionId:string,projectId:string,toolIndex:number,payload:unknown):Promise<{ok:boolean;[key:string]:unknown}>;
}

export class SkillRuntime{
 constructor(private readonly registry:SkillRegistry,private readonly execute:SkillExecutor){}

 validate(skillId:string,mission:Mission,projectId:string):void{
  const skill=this.registry.get(skillId);
  if(skill.status!=="enabled")throw new Error("Skill is not enabled.");
  if(!mission.projectId||mission.projectId!==projectId)throw new Error("Skill project isolation violation.");
  for(const plan of mission.tools??[]){
   if(!skill.tools.includes(plan.tool))throw new Error("Mission tool is outside the enabled skill tool scope.");
   if(!skill.permissions.some(permission=>rank[plan.permission]<=rank[permission]))
    throw new Error("Mission tool permission exceeds the enabled skill scope.");
  }
 }

 async run(skillId:string,mission:Mission,projectId:string,payloads:unknown[]=[]):Promise<SkillExecutionResult>{
  this.validate(skillId,mission,projectId);
  const plans=mission.tools??[];
  const results:unknown[]=[];
  for(let index=0;index<plans.length;index++){
   const plan=plans[index];
   if(!plan)throw new Error("Skill mission tool plan is missing.");
   const result=await this.execute(mission.id,projectId,index,payloads[index]??plan.payload??{});
   results.push(result);
   if(!result.ok)return{skillId,missionId:mission.id,projectId,results,completed:false,reason:String(result.error??"skill tool execution failed")};
  }
  return{skillId,missionId:mission.id,projectId,results,completed:true};
 }
}
