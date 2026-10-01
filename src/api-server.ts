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
