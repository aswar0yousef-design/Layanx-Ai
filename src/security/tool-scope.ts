import type {PermissionLevel} from "../core/types.js";
export interface ToolScope{tool:string;projectId:string;missionId:string;permission:PermissionLevel;allowedActions:string[];expiresAt:string;}
export class ToolScopeGuard{
 validate(scope:ToolScope,request:{tool:string;projectId:string;missionId:string;permission:PermissionLevel;action:string}){
  if(Date.parse(scope.expiresAt)<=Date.now())return{allowed:false,reason:"Tool scope expired."};
  if(scope.tool!==request.tool||scope.projectId!==request.projectId||scope.missionId!==request.missionId)return{allowed:false,reason:"Tool scope mismatch."};
  if(!scope.allowedActions.includes(request.action))return{allowed:false,reason:"Action is outside tool scope."};
  if(scope.permission<request.permission)return{allowed:false,reason:"Tool permission insufficient."};
  return{allowed:true,reason:"Tool scope valid."};
 }
}
