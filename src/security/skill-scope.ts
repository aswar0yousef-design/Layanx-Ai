export interface SkillScope{skillId:string;projectId:string;missionId:string;allowedTools:string[];allowedPaths:string[];networkHosts:string[];expiresAt:string;}
export class SkillScopeGuard{
 validate(scope:SkillScope,request:{skillId:string;projectId:string;missionId:string;tool?:string;path?:string;host?:string}){
  if(Date.parse(scope.expiresAt)<=Date.now())return{allowed:false,reason:"Skill scope expired."};
  if(scope.skillId!==request.skillId||scope.projectId!==request.projectId||scope.missionId!==request.missionId)return{allowed:false,reason:"Skill scope mismatch."};
  if(request.tool&&!scope.allowedTools.includes(request.tool))return{allowed:false,reason:"Tool is outside skill scope."};
  if(request.path&&!scope.allowedPaths.some(p=>request.path!.startsWith(p)))return{allowed:false,reason:"Path is outside skill scope."};
  if(request.host&&!scope.networkHosts.includes(request.host))return{allowed:false,reason:"Network host is outside skill scope."};
  return{allowed:true,reason:"Skill scope valid."};
 }
}
