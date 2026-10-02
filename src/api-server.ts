import {createServer,IncomingMessage,ServerResponse} from "node:http";
import type {LayanXCore} from "./core/orchestrator.js";
import type {RuntimePersistence} from "./core/runtime-persistence.js";
import {runtimeHealth,runtimeStatus} from "./runtime.js";
import {providerSummary} from "./config/providers.js";
import {McpGateway} from "./mcp-gateway.js";
import {ControlCenter} from "./control-center.js";
import {createHash} from "node:crypto";
export interface RuntimeApiOptions{core:LayanXCore;persistence?:RuntimePersistence;host?:string;port?:number;maxBodyBytes?:number;token?:string;requireToken?:boolean;}
function json(response:ServerResponse,status:number,body:unknown){response.statusCode=status;response.setHeader("content-type","application/json; charset=utf-8");response.end(JSON.stringify(body));}
async function body(request:IncomingMessage,maxBytes:number){let total=0;const chunks:Buffer[]=[];for await(const chunk of request){const part=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);total+=part.length;if(total>maxBytes)throw new Error("request_too_large");chunks.push(part);}const raw=Buffer.concat(chunks).toString("utf8");if(!raw)return{};try{return JSON.parse(raw) as Record<string,unknown>;}catch{throw new Error("invalid_json");}}
function authorized(request:IncomingMessage,token?:string){return !token||request.headers.authorization==="Bearer "+token;}
function runtimeView(core:LayanXCore,persistence?:RuntimePersistence){return {core,models:core.models,providers:core.providers,providerSummary:providerSummary(),persistence};}
export function startRuntimeApi(options:RuntimeApiOptions){
 const host=options.host??process.env.LAYANX_API_HOST??"127.0.0.1";const port=options.port??Number(process.env.LAYANX_API_PORT??3000);const max=options.maxBodyBytes??65536;const requireToken=options.requireToken??(process.env.LAYANX_API_REQUIRE_TOKEN==="true");const remoteHost=host!=="127.0.0.1"&&host!=="localhost"&&host!=="::1";if((requireToken||remoteHost)&&!options.token)throw new Error("LAYANX_API_TOKEN is required for remote API access");
 const mcp=new McpGateway(options.core);
 const control=new ControlCenter(options.core);
 const server=createServer(async(request,response)=>{
  response.setHeader("cache-control","no-store");
  if(requireToken&&!authorized(request,options.token)&&request.url!=="/v1/health"){json(response,401,{ok:false,error:"unauthorized"});return;}\n  if(request.method==="POST"&&request.url==="/mcp"){
   if(!authorized(request,options.token)){json(response,401,{jsonrpc:"2.0",error:{code:-32001,message:"Unauthorized"}});return;}
   try{
    const input=await body(request,max);
    const result=await mcp.handle(input);
    if(result===undefined){response.statusCode=202;response.end();return;}
    json(response,200,{jsonrpc:"2.0",...result});
   }catch(error){
    json(response,400,{jsonrpc:"2.0",error:{code:-32700,message:error instanceof Error?error.message:"Invalid JSON-RPC request."}});
   }
   return;
  }
  if(request.method==="POST"&&request.url==="/v1/agent/gateway"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{
    const input=await body(request,max);
    const goal=typeof input.goal==="string"?input.goal.trim():"";
    const projectId=typeof input.projectId==="string"?input.projectId.trim():"";
    const agentId=typeof input.agentId==="string"&&input.agentId.trim()?input.agentId.trim():"core";
    const maxSteps=typeof input.maxSteps==="number"&&Number.isInteger(input.maxSteps)?Math.min(Math.max(input.maxSteps,1),25):10;
    const raw=input.approvalIds&&typeof input.approvalIds==="object"&&!Array.isArray(input.approvalIds)?input.approvalIds as Record<string,unknown>:{};
    const approvalIds:Record<number,string>={};
    for(const [key,value] of Object.entries(raw)){const index=Number(key);if(Number.isInteger(index)&&index>=0&&typeof value==="string"&&value.trim())approvalIds[index]=value.trim();}
    if(!goal){json(response,400,{ok:false,error:"goal is required"});return;}
    if(!projectId){json(response,400,{ok:false,error:"projectId is required"});return;}
    const result=await options.core.runAgentGateway(goal,projectId,maxSteps,approvalIds,agentId);
    json(response,result.completed?200:result.paused?202:422,result);
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"agent gateway failed"});}
   return;
  }
  if(request.method==="GET"&&request.url?.match(/^\/v1\/missions\/[^/]+\/events$/)){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const missionId=request.url.split("/")[3] as string;
   const mission=options.core.missions.get(missionId);
   if(!mission){json(response,404,{ok:false,error:"mission_not_found"});return;}
   const parsed=new URL(request.url,"http://localhost");
   const projectId=parsed.searchParams.get("projectId")?.trim()??"";
   const after=parsed.searchParams.get("after")?.trim()||undefined;
   if(!projectId){json(response,400,{ok:false,error:"projectId is required"});return;}
   try{
    options.core.projectIsolation.assertMissionProject(projectId,mission.projectId);
    options.core.eventStream.sync(options.core.audit.forMission(missionId),{[missionId]:mission.projectId??""});
    const events=options.core.eventStream.list(projectId,missionId,after);
    json(response,200,{ok:true,missionId,projectId,events});
   }catch(error){json(response,403,{ok:false,error:error instanceof Error?error.message:"event stream access denied"});}
   return;
  }
  if(request.method==="GET"&&request.url?.startsWith("/v1/control-center")){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const parsed=new URL(request.url,"http://localhost");
   const projectId=parsed.searchParams.get("projectId")?.trim()||undefined;
   json(response,200,{ok:true,control:control.snapshot(projectId)});
   return;
  }
  if(request.method==="GET"&&request.url?.startsWith("/v1/control-center/session")){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const parsed=new URL(request.url,"http://localhost");
   const projectId=parsed.searchParams.get("projectId")?.trim()||"";
   const missionId=parsed.searchParams.get("missionId")?.trim()||"";
   if(!projectId){json(response,400,{ok:false,error:"projectId is required"});return;}
   try{
    const missions=options.core.missions.list().filter(m=>m.projectId===projectId).filter(m=>!missionId||m.id===missionId);
    const sessions=options.persistence?await Promise.all(missions.map(m=>options.core.getDevelopmentSessionState(m.id,projectId))):[];
    json(response,200,{ok:true,projectId,missions:missions.map(m=>({id:m.id,goal:m.goal,status:m.status})),sessions});
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"remote session state failed"});}
   return;
  }
  if(request.method==="POST"&&request.url?.match(/^\/v1\/control-center\/missions\/[^/]+\/cancel$/)){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const id=request.url.split("/")[4] as string;
   try{
    const input=await body(request,max);
    const projectId=typeof input.projectId==="string"?input.projectId.trim():"";
    if(!projectId){json(response,400,{ok:false,error:"projectId is required"});return;}
    control.cancel(id,projectId);
    json(response,200,{ok:true,missionId:id});
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"mission cancellation failed"});}
   return;
  }
  if(request.method==="GET"&&request.url==="/v1/status"){json(response,200,runtimeStatus(runtimeView(options.core,options.persistence)));return;}
  if(request.method==="GET"&&request.url==="/v1/health"){const health=await runtimeHealth(runtimeView(options.core,options.persistence));json(response,health.healthy?200:503,health);return;}
  if(request.method==="GET"&&request.url?.startsWith("/v1/missions/")&&request.url.endsWith("/tools/prepare")){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const id=request.url.slice("/v1/missions/".length,-"/tools/prepare".length);
   const mission=options.core.missions.get(id);
   if(!mission){json(response,404,{ok:false,error:"mission_not_found"});return;}
   const projectId=request.headers["x-layanx-project-id"];
   if(typeof projectId!=="string"||!projectId.trim()){json(response,400,{ok:false,error:"x-layanx-project-id is required"});return;}
   try{
    const prepared=options.core.prepareMissionToolRequests(mission,projectId,"core");
    json(response,200,{ok:true,missionId:id,requests:prepared});
   }catch(error){
    json(response,422,{ok:false,error:error instanceof Error?error.message:"tool request preparation failed"});
   }
   return;
  }
  if(request.method==="GET"&&request.url?.match(/^\/v1\/projects\/[^/]+\/intelligence$/)){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const parts=request.url.split("/");
   const projectId=decodeURIComponent(parts[3]??"").trim();
   if(!projectId){json(response,400,{ok:false,error:"projectId is required"});return;}
   try{
    const intelligence=await options.core.projectIntelligence.scan(projectId);
    json(response,200,{ok:true,intelligence});
   }catch(error){
    json(response,422,{ok:false,error:error instanceof Error?error.message:"project intelligence scan failed"});
   }
   return;
  }
  if(request.method==="POST"&&request.url?.match(/^\/v1\/missions\/[^/]+\/repair$/)){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const missionId=request.url.split("/")[3] as string;
   if(!options.core.missions.get(missionId)){json(response,404,{ok:false,error:"mission_not_found"});return;}
   try{
    const input=await body(request,max);
    const projectId=typeof input.projectId==="string"?input.projectId.trim():"";
    const attempts=typeof input.maxRepairAttempts==="number"?input.maxRepairAttempts:3;
    const agentId=typeof input.agentId==="string"&&input.agentId.trim()?input.agentId.trim():"core";
    if(!projectId){json(response,400,{ok:false,error:"projectId is required"});return;}
    const result=await options.core.executeMissionRepair(missionId,projectId,attempts,agentId);
    json(response,result.completed?200:result.blocked?403:422,result);
   }catch(error){
    json(response,422,{ok:false,error:error instanceof Error?error.message:"autonomous repair failed"});
   }
   return;
  }
  if(request.method==="POST"&&request.url?.match(/^\/v1\/missions\/[^/]+\/agent-loop$/)){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}const missionId=request.url.split("/")[3] as string;if(!options.core.missions.get(missionId)){json(response,404,{ok:false,error:"mission_not_found"});return;}try{const input=await body(request,max);const projectId=typeof input.projectId==="string"?input.projectId.trim():"";const agentId=typeof input.agentId==="string"&&input.agentId.trim()?input.agentId.trim():"core";const maxSteps=typeof input.maxSteps==="number"&&Number.isInteger(input.maxSteps)?Math.min(Math.max(input.maxSteps,1),25):10;const raw=input.approvalIds&&typeof input.approvalIds==="object"&&!Array.isArray(input.approvalIds)?input.approvalIds as Record<string,unknown>:{};const approvalIds:Record<number,string>={};for(const [key,value] of Object.entries(raw)){const index=Number(key);if(Number.isInteger(index)&&index>=0&&typeof value==="string"&&value.trim())approvalIds[index]=value.trim();}if(!projectId){json(response,400,{ok:false,error:"projectId is required"});return;}const result=await options.core.executeAgentLoop(missionId,projectId,maxSteps,approvalIds,agentId);json(response,result.completed?200:result.paused?202:422,result);}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"agent loop failed"});}return;}
  if(request.method==="POST"&&request.url?.match(/^\/v1\/missions\/[^/]+\/development-session$/)){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const missionId=request.url.split("/")[3] as string;
   const mission=options.core.missions.get(missionId);
   if(!mission){json(response,404,{ok:false,error:"mission_not_found"});return;}
   try{
    const input=await body(request,max);
    const projectId=typeof input.projectId==="string"?input.projectId.trim():"";
    const agentId=typeof input.agentId==="string"&&input.agentId.trim()?input.agentId.trim():"core";
    const raw=input.approvalIds&&typeof input.approvalIds==="object"&&!Array.isArray(input.approvalIds)?input.approvalIds as Record<string,unknown>:{};
    const approvalIds:Record<number,string>={};
    for(const [key,value] of Object.entries(raw)){const index=Number(key);if(Number.isInteger(index)&&index>=0&&typeof value==="string"&&value.trim())approvalIds[index]=value.trim();}
    if(!projectId){json(response,400,{ok:false,error:"projectId is required"});return;}
    const result=await options.core.executeDevelopmentSession(missionId,projectId,approvalIds,agentId);
    json(response,result.completed?200:result.paused?202:422,result);
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"development session failed"});}
   return;
  }
  if(request.method==="GET"&&request.url?.match(/^\/v1\/missions\/[^/]+\/development-session$/)){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const missionId=request.url.split("/")[3] as string;
   const projectId=new URL(request.url,"http://localhost").searchParams.get("projectId")?.trim()??"";
   if(!projectId){json(response,400,{ok:false,error:"projectId is required"});return;}
   try{const state=await options.core.getDevelopmentSessionState(missionId,projectId);json(response,state.exists?200:404,state);}
   catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"session state unavailable"});}
   return;
  }
  if(request.method==="POST"&&request.url?.match(/^\/v1\/missions\/[^/]+\/development-session\/resume$/)){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const missionId=request.url.split("/")[3] as string;
   try{
    const input=await body(request,max);
    const projectId=typeof input.projectId==="string"?input.projectId.trim():"";
    const agentId=typeof input.agentId==="string"&&input.agentId.trim()?input.agentId.trim():"core";
    const raw=input.approvalIds&&typeof input.approvalIds==="object"&&!Array.isArray(input.approvalIds)?input.approvalIds as Record<string,unknown>:{};
    const approvalIds:Record<number,string>={};
    for(const [key,value] of Object.entries(raw)){const index=Number(key);if(Number.isInteger(index)&&index>=0&&typeof value==="string"&&value.trim())approvalIds[index]=value.trim();}
    if(!projectId){json(response,400,{ok:false,error:"projectId is required"});return;}
    const result=await options.core.resumeDevelopmentSession(missionId,projectId,approvalIds,agentId);
    json(response,result.completed?200:result.paused?202:422,result);
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"development session resume failed"});}
   return;
  }
  if(request.method==="GET"&&request.url?.startsWith("/v1/context")){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const parsed=new URL(request.url,"http://localhost");
   const projectId=parsed.searchParams.get("projectId")?.trim()??"";
   const missionId=parsed.searchParams.get("missionId")?.trim()??"";
   const query=parsed.searchParams.get("query")?.trim()??"";
   if(!projectId||!missionId||!query){json(response,400,{ok:false,error:"projectId, missionId, and query are required"});return;}
   const mission=options.core.missions.get(missionId);
   if(!mission){json(response,404,{ok:false,error:"mission_not_found"});return;}
   try{
    const limit=Math.min(Math.max(Number(parsed.searchParams.get("limit")??8)||8,1),50);
    const context=options.core.contextFabric.build({projectId,mission,query,limit,maxChars:12000});
    json(response,200,{ok:true,context});
   }catch(error){
    json(response,403,{ok:false,error:error instanceof Error?error.message:"context resolution failed"});
   }
   return;
  }
  if(request.method==="GET"&&request.url==="/v1/skills"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   json(response,200,{ok:true,skills:options.core.skills.list()});
   return;
  }
  if(request.method==="POST"&&request.url?.match(/^\/v1\/missions\/[^/]+\/skills\/[^/]+\/execute$/)){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const parts=request.url.split("/");
   const missionId=parts[3] as string;
   const skillId=parts[5] as string;
   if(!options.core.missions.get(missionId)){json(response,404,{ok:false,error:"mission_not_found"});return;}
   try{
    const input=await body(request,max);
    const projectId=typeof input.projectId==="string"?input.projectId.trim():"";
    const payloads=Array.isArray(input.payloads)?input.payloads:[];
    if(!projectId){json(response,400,{ok:false,error:"projectId is required"});return;}
    const result=await options.core.executeSkill(skillId,missionId,projectId,payloads);
    json(response,result.completed?200:403,result);
   }catch(error){
    json(response,422,{ok:false,error:error instanceof Error?error.message:"skill execution failed"});
   }
   return;
  }
  if(request.method==="GET"&&request.url==="/v1/tools"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const contract=options.core.agents.get("core");
   json(response,200,{ok:true,tools:options.core.toolCatalog.list(contract,"L4_EXECUTE")});
   return;
  }
  if(request.method==="GET"&&request.url?.startsWith("/v1/tools/discover")){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const parsed=new URL(request.url,"http://localhost");
   const action=parsed.searchParams.get("action")?.trim()??"";
   const permission=parsed.searchParams.get("permission")??"L1_READ";
   const allowed=["L1_READ","L2_ANALYZE","L3_MODIFY","L4_EXECUTE","L5_CRITICAL"];
   if(!action||!allowed.includes(permission)){json(response,400,{ok:false,error:"action and valid permission are required"});return;}
   const tools=options.core.discoverTools(action,permission as import("./core/types.js").PermissionLevel,"core");
   json(response,200,{ok:true,action,permission,tools});
   return;
  }
  if(request.method==="POST"&&request.url?.match(/^\/v1\/missions\/[^/]+\/approvals$/)){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const id=request.url.split("/")[3] as string;
   const mission=options.core.missions.get(id);
   if(!mission){json(response,404,{ok:false,error:"mission_not_found"});return;}
   try{
    const input=await body(request,max);
    const projectId=typeof input.projectId==="string"?input.projectId.trim():"";
    const toolIndex=typeof input.toolIndex==="number"&&Number.isInteger(input.toolIndex)?input.toolIndex:-1;
    const agentId=typeof input.agentId==="string"&&input.agentId.trim()?input.agentId.trim():"core";
    if(!projectId||toolIndex<0){json(response,400,{ok:false,error:"projectId and a non-negative toolIndex are required"});return;}
    options.core.projectIsolation.assertMissionProject(projectId,mission.projectId);
    const plan=mission.tools?.[toolIndex];
    if(!plan){json(response,404,{ok:false,error:"mission_tool_plan_not_found"});return;}
    const contract=options.core.agents.get(agentId);
    const catalog=options.core.toolCatalog.list(contract,mission.requiredPermission);
    const tool=options.core.tools.get(plan.tool);
    if(!contract.allowedTools.includes(plan.tool)||!catalog.some(entry=>entry.name===plan.tool)){json(response,403,{ok:false,error:"Tool is not authorized for the agent"});return;}
    const requestData={missionId:id,agentId,tool:plan.tool,action:plan.action,permission:plan.permission,idempotencyKey:"approval-"+crypto.randomUUID(),payload:plan.payload};
    const risk=options.core.risk.assess(requestData);
    if(!risk.requiresApproval&&!tool.dangerous){json(response,400,{ok:false,error:"This tool does not require explicit approval"});return;}
    const approval=options.core.executionRuntime.approvals.create({
      missionId:id,agentId,tool:plan.tool,action:plan.action,permission:plan.permission,payloadHash:createHash("sha256").update(JSON.stringify(plan.payload??null)).digest("hex"),
      reason:risk.reasons.join("; ")||"Dangerous tool execution",
      expiresAt:new Date(Date.now()+15*60*1000).toISOString()
    });
    json(response,201,{ok:true,approval});
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"approval creation failed"});}
   return;
  }
  if(request.method==="POST"&&request.url?.match(/^\/v1\/missions\/[^/]+\/approvals\/[^/]+\/approve$/)){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const parts=request.url.split("/");
   const missionId=parts[3] as string,approvalId=parts[5] as string;
   if(!options.core.missions.get(missionId)){json(response,404,{ok:false,error:"mission_not_found"});return;}
   try{
    const approval=options.core.executionRuntime.approvals.get(approvalId);
    if(approval.missionId!==missionId){json(response,403,{ok:false,error:"approval scope mismatch"});return;}
    options.core.executionRuntime.approvals.approve(approvalId);
    json(response,200,{ok:true,approvalId});
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"approval failed"});}
   return;
  }
  if(request.method==="GET"&&request.url==="/v1/missions"){json(response,200,{ok:true,missions:options.core.missions.list()});return;}
   if(request.method==="POST"&&request.url?.match(/^\/v1\/missions\/[^/]+\/tools\/execute-adaptive$/)){
    if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
    const id=request.url.split("/")[3] as string;
    if(!options.core.missions.get(id)){json(response,404,{ok:false,error:"mission_not_found"});return;}
    try{
     const input=await body(request,max);
     const projectId=typeof input.projectId==="string"?input.projectId.trim():"";
     const maxSteps=typeof input.maxSteps==="number"&&Number.isInteger(input.maxSteps)?Math.min(Math.max(input.maxSteps,1),25):10;
     if(!projectId){json(response,400,{ok:false,error:"projectId is required"});return;}
     const result=await options.core.executeMissionAdaptive(id,projectId,maxSteps,"core");
     json(response,result.completed?200:403,result);
    }catch(error){
     json(response,422,{ok:false,error:error instanceof Error?error.message:"adaptive mission execution failed"});
    }
    return;
   }
  if(request.method==="GET"&&request.url?.startsWith("/v1/missions/")){const id=request.url.slice("/v1/missions/".length);const mission=options.core.missions.get(id);if(!mission){json(response,404,{ok:false,error:"mission_not_found"});return;}json(response,200,{ok:true,mission,execution:options.core.executionStates.get(id),audit:options.core.audit.forMission(id),ledger:options.core.ledger.forMission(id)});return;}
   if(request.method==="POST"&&request.url?.match(/^\/v1\/missions\/[^/]+\/tools\/execute-all$/)){
    if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
    const id=request.url.split("/")[3] as string;
    if(!options.core.missions.get(id)){json(response,404,{ok:false,error:"mission_not_found"});return;}
    try{
     const input=await body(request,max);
     const projectId=typeof input.projectId==="string"?input.projectId.trim():"";
     const payloads=Array.isArray(input.payloads)?input.payloads:[];
     const approvalId=typeof input.approvalId==="string"?input.approvalId:undefined;
     if(!projectId){json(response,400,{ok:false,error:"projectId is required"});return;}
     const result=await options.core.executeMissionTools(id,projectId,payloads,approvalId,"core");
     json(response,result.completed?200:403,result);
    }catch(error){
     json(response,422,{ok:false,error:error instanceof Error?error.message:"planned mission execution failed"});
    }
    return;
   }
  if(request.method==="POST"&&request.url?.match(/^\/v1\/missions\/[^/]+\/tools\/execute$/)){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const id=request.url.split("/")[3] as string;
   if(!options.core.missions.get(id)){json(response,404,{ok:false,error:"mission_not_found"});return;}
   try{
    const input=await body(request,max);
    const projectId=typeof input.projectId==="string"?input.projectId.trim():"";
    const toolIndex=typeof input.toolIndex==="number"&&Number.isInteger(input.toolIndex)?input.toolIndex:0;
    const approvalId=typeof input.approvalId==="string"?input.approvalId:undefined;
    if(!projectId||toolIndex<0){json(response,400,{ok:false,error:"projectId and a non-negative toolIndex are required"});return;}
    const result=await options.core.executeMissionTool(id,projectId,toolIndex,input.payload,approvalId,"core");
    json(response,result.ok?200:403,result);
   }catch(error){
    json(response,422,{ok:false,error:error instanceof Error?error.message:"planned tool execution failed"});
   }
   return;
  }
  if(request.method==="POST"&&request.url?.match(/^\/v1\/missions\/[^/]+\/tools$/)){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const id=request.url.split("/")[3] as string;
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
    const requestData:import("./core/types.js").ToolRequest={missionId:id,agentId,tool,action,permission:permission as import("./core/types.js").PermissionLevel,idempotencyKey,payload:input.payload};
    const rank:Record<import("./core/types.js").PermissionLevel,number>={L1_READ:1,L2_ANALYZE:2,L3_MODIFY:3,L4_EXECUTE:4,L5_CRITICAL:5};
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
   try{const input=await body(request,max);const goal=typeof input.goal==="string"?input.goal.trim():"";if(!goal||goal.length>4000){json(response,400,{ok:false,error:"goal_required"});return;}const projectId=typeof input.projectId==="string"&&input.projectId.trim()?input.projectId.trim():"default";const mission=await options.core.planAndStartMission(goal,projectId);json(response,201,{ok:true,mission,execution:options.core.executionStates.get(mission.id)});}
   catch(error){const message=error instanceof Error?error.message:"mission_failed";json(response,422,{ok:false,error:message});}
   return;
  }
  json(response,404,{ok:false,error:"not_found"});
 });
 server.listen(port,host);return server;
}
