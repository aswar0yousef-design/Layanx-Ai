import {createServer,IncomingMessage,ServerResponse} from "node:http";
import type {LayanXCore} from "./core/orchestrator.js";
import {runtimeHealth,runtimeStatus} from "./runtime.js";
import {providerSummary} from "./config/providers.js";
export interface RuntimeApiOptions{core:LayanXCore;host?:string;port?:number;maxBodyBytes?:number;token?:string;}
function json(response:ServerResponse,status:number,body:unknown){response.statusCode=status;response.setHeader("content-type","application/json; charset=utf-8");response.end(JSON.stringify(body));}
async function body(request:IncomingMessage,maxBytes:number){let total=0;const chunks:Buffer[]=[];for await(const chunk of request){const part=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);total+=part.length;if(total>maxBytes)throw new Error("request_too_large");chunks.push(part);}const raw=Buffer.concat(chunks).toString("utf8");if(!raw)return{};try{return JSON.parse(raw) as Record<string,unknown>;}catch{throw new Error("invalid_json");}}
function authorized(request:IncomingMessage,token?:string){return !token||request.headers.authorization==="Bearer "+token;}
function runtimeView(core:LayanXCore){return {core,models:core.models,providers:core.providers,providerSummary:providerSummary()};}
export function startRuntimeApi(options:RuntimeApiOptions){
 const host=options.host??process.env.LAYANX_API_HOST??"127.0.0.1";const port=options.port??Number(process.env.LAYANX_API_PORT??3000);const max=options.maxBodyBytes??65536;
 const server=createServer(async(request,response)=>{
  response.setHeader("cache-control","no-store");
  if(request.method==="GET"&&request.url==="/v1/status"){json(response,200,runtimeStatus(runtimeView(options.core)));return;}
  if(request.method==="GET"&&request.url==="/v1/health"){const health=await runtimeHealth(runtimeView(options.core));json(response,health.healthy?200:503,health);return;}
  if(request.method==="GET"&&request.url==="/v1/missions"){json(response,200,{ok:true,missions:options.core.missions.list()});return;}
  if(request.method==="GET"&&request.url?.startsWith("/v1/missions/")){const id=request.url.slice("/v1/missions/".length);const mission=options.core.missions.get(id);if(!mission){json(response,404,{ok:false,error:"mission_not_found"});return;}json(response,200,{ok:true,mission,execution:options.core.executionStates.get(id),audit:options.core.audit.forMission(id),ledger:options.core.ledger.forMission(id)});return;}
  if(request.method==="POST"&&request.url?.match(/^\/v1\/missions\/[^/]+\/tools$/)){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const id=request.url.split("/")[3];
   const mission=options.core.missions.get(id);
   if(!mission){json(response,404,{ok:false,error:"mission_not_found"});return;}
   try{
    const input=await body(request,max);
    const agentId=typeof input.agentId==="string"?input.agentId.trim():"";
    const tool=typeof input.tool==="string"?input.tool.trim():"";
    const action=typeof input.action==="string"?input.action.trim():"";
    const permission=typeof input.permission==="string"?input.permission:"";
    const projectId=typeof input.projectId==="string"?input.projectId.trim():"";
    const capabilityId=typeof input.capabilityId==="string"?input.capabilityId.trim():"";
    const idempotencyKey=typeof input.idempotencyKey==="string"?input.idempotencyKey.trim():"";
    const allowedPermissions=["L1_READ","L2_ANALYZE","L3_MODIFY","L4_EXECUTE","L5_CRITICAL"];
    if(!agentId||!tool||!action||!allowedPermissions.includes(permission)||!projectId||!capabilityId||!idempotencyKey){
     json(response,400,{ok:false,error:"agentId, tool, action, permission, projectId, capabilityId, and idempotencyKey are required"});return;
    }
    const contract=options.core.agents.get(agentId);
    const definition=options.core.tools.get(tool);
    if(!contract.allowedTools.includes(tool)||contract.forbiddenResources.includes(tool)){
     json(response,403,{ok:false,error:"Tool is not authorized for the agent"});return;
    }
    if(!options.core.toolAdapters.has(tool)){
     json(response,503,{ok:false,error:"No registered adapter is available for this tool"});return;
    }
    const requestData={missionId:id,agentId,tool,action,permission:permission as import("./core/types.js").PermissionLevel,idempotencyKey,payload:input.payload};
    const rank:Record<string,number>={L1_READ:1,L2_ANALYZE:2,L3_MODIFY:3,L4_EXECUTE:4,L5_CRITICAL:5};
    if(rank[requestData.permission]>rank[mission.requiredPermission]||rank[requestData.permission]>rank[contract.requiredPermission]){
     json(response,403,{ok:false,error:"Requested permission exceeds mission or agent scope"});return;
    }
    if(rank[definition.permission]>rank[requestData.permission]){
     json(response,403,{ok:false,error:"Requested permission is below the tool requirement"});return;
    }
    const result=await options.core.executionRuntime.run(
     mission,requestData,options.core.toolAdapters.get(tool),
     typeof input.approvalId==="string"?input.approvalId:undefined,
     {projectId,capabilityId}
    );
    options.core.missions.save(mission);
    json(response,result.ok?200:403,{ok:result.ok,missionId:id,tool,action,verified:result.verified,data:result.data,error:result.error,recoverable:result.recoverable});
   }catch(error){
    const message=error instanceof Error?error.message:"tool_execution_failed";
    json(response,422,{ok:false,error:message});
   }
   return;
  }
  if(request.method==="POST"&&request.url==="/v1/missions"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{const input=await body(request,max);const goal=typeof input.goal==="string"?input.goal.trim():"";if(!goal||goal.length>4000){json(response,400,{ok:false,error:"goal_required"});return;}const mission=await options.core.planAndStartMission(goal);json(response,201,{ok:true,mission,execution:options.core.executionStates.get(mission.id)});}
   catch(error){const message=error instanceof Error?error.message:"mission_failed";json(response,422,{ok:false,error:message});}
   return;
  }
  json(response,404,{ok:false,error:"not_found"});
 });
 server.listen(port,host);return server;
}
