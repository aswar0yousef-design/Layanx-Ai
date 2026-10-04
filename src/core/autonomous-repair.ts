import type {Mission,PermissionLevel} from "./types.js";
import type {RuntimeResult} from "./runtime.js";
import type {ToolCatalogEntry} from "./tool-catalog.js";
import type {AiMissionPlanner,PlannedTool} from "./ai-planner.js";

export interface RepairAttempt{attempt:number;tool?:string;action?:string;ok:boolean;error?:string;data?:unknown;}
export interface RepairLoopResult{missionId:string;completed:boolean;attempts:number;repaired:boolean;exhausted:boolean;blocked:boolean;results:RepairAttempt[];reason?:string;}
export interface RepairLoopPolicy{maxAttempts:number;allowedPermissions:PermissionLevel[];}
export interface RepairExecutionContext{
 planner:AiMissionPlanner;
 tools:ToolCatalogEntry[];
 execute:(plan:PlannedTool,attempt:number)=>Promise<RuntimeResult>;
 memory?:Array<{kind:string;summary:string;content:unknown;tags:string[]}>;
 projectContext?:unknown;
}

export class AutonomousRepairLoop{
 readonly defaultPolicy:RepairLoopPolicy={maxAttempts:3,allowedPermissions:["L1_READ","L2_ANALYZE","L3_MODIFY","L4_EXECUTE"]};
 normalizeAttempts(value:number|undefined):number{
  if(!Number.isFinite(value??NaN))return this.defaultPolicy.maxAttempts;
  return Math.min(Math.max(Math.floor(value as number),1),5);
 }
 isRepairCandidate(result:RuntimeResult):boolean{return result.ok===false&&result.recoverable!==false;}
 isSafeRepairPermission(permission:PermissionLevel):boolean{return this.defaultPolicy.allowedPermissions.includes(permission);}
 async run(mission:Mission,initial:RuntimeResult,context:RepairExecutionContext,maxAttempts?:number):Promise<RepairLoopResult>{
  const limit=this.normalizeAttempts(maxAttempts);
  const results:RepairAttempt[]=[];
  if(initial.ok)return{missionId:mission.id,completed:initial.verified,attempts:0,repaired:false,exhausted:false,blocked:false,results};
  if(!this.isRepairCandidate(initial))return{missionId:mission.id,completed:false,attempts:0,repaired:false,exhausted:false,blocked:true,results,reason:initial.error??"Failure is not recoverable."};
  let latest=initial;
  const completedTools:string[]=[];
  for(let attempt=1;attempt<=limit;attempt++){
   let plan:PlannedTool|null;
   try{
    plan=await context.planner.nextTool({
     goal:"Repair the failed mission: "+mission.goal,
     result:{error:latest.error,data:latest.data,missionId:mission.id,attempt},
     tools:context.tools,requiredPermission:mission.requiredPermission,completedTools,memory:context.memory,projectContext:context.projectContext
    });
   }catch(error){
    return{missionId:mission.id,completed:false,attempts:attempt-1,repaired:false,exhausted:false,blocked:true,results,reason:error instanceof Error?error.message:"Repair planner failed."};
   }
   if(!plan)return{missionId:mission.id,completed:false,attempts:attempt-1,repaired:false,exhausted:false,blocked:false,results,reason:"Repair planner found no safe next action."};
   if(!this.isSafeRepairPermission(plan.permission))
    return{missionId:mission.id,completed:false,attempts:attempt-1,repaired:false,exhausted:false,blocked:true,results,reason:"Repair permission "+plan.permission+" is outside the autonomous repair policy."};
   const key=plan.tool+"::"+plan.action;
   if(completedTools.includes(key))
    return{missionId:mission.id,completed:false,attempts:attempt-1,repaired:false,exhausted:false,blocked:true,results,reason:"Repair planner repeated an already attempted action."};
   completedTools.push(key);
   let next:RuntimeResult;
   try{next=await context.execute(plan,attempt);}
   catch(error){next={ok:false,missionId:mission.id,verified:false,error:error instanceof Error?error.message:"Repair execution failed.",recoverable:true};}
   results.push({attempt,tool:plan.tool,action:plan.action,ok:next.ok,error:next.error,data:next.data});
   latest=next;
   if(next.ok&&next.verified){

    return{missionId:mission.id,completed:true,attempts:attempt,repaired:true,exhausted:false,blocked:false,results};
   }
  }
  return{missionId:mission.id,completed:false,attempts:limit,repaired:false,exhausted:true,blocked:false,results,reason:latest.error??"Repair attempt limit exhausted."};
 }
}
