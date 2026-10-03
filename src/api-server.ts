import {createServer,IncomingMessage,ServerResponse} from "node:http";
import type {LayanXCore} from "./core/orchestrator.js";
import type {RuntimePersistence} from "./core/runtime-persistence.js";
import {runtimeHealth,runtimeStatus} from "./runtime.js";
import {providerSummary} from "./config/providers.js";
import {McpGateway} from "./mcp-gateway.js";
import {ControlCenter} from "./control-center.js";
import {createHash} from "node:crypto";
import {VoiceService} from "./voice/service.js";
import {BusinessManager} from "./business/manager.js";
import {voiceUiHtml} from "./voice/ui.js";
import {AdsManager} from "./business/ads.js";
import {OAuthConnectionCenter} from "./business/oauth.js";
import {MediaManager} from "./business/media.js";
import {GrowthEngine} from "./business/growth-engine.js";
import {MessagingChannels} from "./channels/service.js";
export interface RuntimeApiOptions{core:LayanXCore;business:BusinessManager;ads?:AdsManager;media?:MediaManager;growth?:GrowthEngine;channels?:MessagingChannels;persistence?:RuntimePersistence;host?:string;port?:number;maxBodyBytes?:number;token?:string;requireToken?:boolean;}
function json(response:ServerResponse,status:number,body:unknown){response.statusCode=status;response.setHeader("content-type","application/json; charset=utf-8");response.end(JSON.stringify(body));}
async function rawBody(request:IncomingMessage,maxBytes:number){let total=0;const chunks:Buffer[]=[];for await(const chunk of request){const part=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);total+=part.length;if(total>maxBytes)throw new Error("request_too_large");chunks.push(part);}return Buffer.concat(chunks);}
async function body(request:IncomingMessage,maxBytes:number){let total=0;const chunks:Buffer[]=[];for await(const chunk of request){const part=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);total+=part.length;if(total>maxBytes)throw new Error("request_too_large");chunks.push(part);}const raw=Buffer.concat(chunks).toString("utf8");if(!raw)return{};try{return JSON.parse(raw) as Record<string,unknown>;}catch{throw new Error("invalid_json");}}
function authorized(request:IncomingMessage,token?:string){return !token||request.headers.authorization==="Bearer "+token;}
function runtimeView(core:LayanXCore,persistence:RuntimePersistence|undefined,business:BusinessManager,ads:AdsManager,media:MediaManager){return {core,models:core.models,providers:core.providers,providerSummary:providerSummary(),persistence,business,ads,media};}
export function startRuntimeApi(options:RuntimeApiOptions){
 const host=options.host??process.env.LAYANX_API_HOST??"127.0.0.1";const port=options.port??Number(process.env.LAYANX_API_PORT??3000);const max=options.maxBodyBytes??65536;const requireToken=options.requireToken??(process.env.LAYANX_API_REQUIRE_TOKEN==="true");const remoteHost=host!=="127.0.0.1"&&host!=="localhost"&&host!=="::1";if((requireToken||remoteHost)&&!options.token)throw new Error("LAYANX_API_TOKEN is required for remote API access");
 const mcp=new McpGateway(options.core);
 const control=new ControlCenter(options.core);
 const voice=new VoiceService();
 const oauth=new OAuthConnectionCenter();
 const business=options.business; const ads=options.ads; const media=options.media??new MediaManager(); const growth=options.growth; if(!ads)throw new Error("ads_manager_required");
 const server=createServer(async(request,response)=>{
  response.setHeader("cache-control","no-store");
  const publicWebhook=request.url==="/v1/channels/whatsapp/webhook";
  if(requireToken&&!authorized(request,options.token)&&!publicWebhook&&request.url!=="/v1/health"&&request.url!=="/voice"){json(response,401,{ok:false,error:"unauthorized"});return;}
  if(request.method==="GET"&&request.url==="/voice"){
   response.statusCode=200;response.setHeader("content-type","text/html; charset=utf-8");response.end(voiceUiHtml());return;
  }
  if(request.method==="POST"&&request.url==="/v1/voice/realtime-token"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{
    const input=await body(request,max);
    const model=typeof input.model==="string"&&input.model.trim()?input.model.trim():undefined;
    const voiceName=typeof input.voice==="string"&&input.voice.trim()?input.voice.trim():undefined;
    const projectId=typeof input.projectId==="string"&&input.projectId.trim()?input.projectId.trim():"default";
    const safetySource=`${request.socket.remoteAddress??"local"}|${request.headers["user-agent"]??"unknown"}|${projectId}`;
    const safetyIdentifier=createHash("sha256").update(safetySource).digest("hex");
    const result=await voice.createRealtimeClientSecret({model,voice:voiceName,safetyIdentifier,instructions:`You are LayanX AI, a local-first autonomous assistant. Speak concise Arabic by default. Current project: ${projectId}. For any project/system action, call layanx_execute with the user's exact goal and projectId "${projectId}". Never claim an action was completed unless the function result confirms it. Explain when approval is required.`});
    json(response,200,{ok:true,...result,safetyIdentifierBound:true});
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"realtime token creation failed"});}
   return;
  }
  if(request.method==="GET"&&request.url==="/v1/computer/live/status"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   json(response,200,{ok:true,...options.core.liveScreenStatus()});return;
  }
  if(request.method==="POST"&&request.url==="/v1/computer/live/start"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{
    options.core.startLiveScreen();
    json(response,200,{ok:true,...options.core.liveScreenStatus()});
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"live screen start failed"});}
   return;
  }
  if(request.method==="POST"&&request.url==="/v1/computer/live/stop"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{
    options.core.stopLiveScreen();
    json(response,200,{ok:true,...options.core.liveScreenStatus()});
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"live screen stop failed"});}
   return;
  }
  if(request.method==="GET"&&request.url==="/v1/computer/live/frame"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const frame=options.core.liveScreenFrame();
   if(!frame){json(response,404,{ok:false,error:"live_frame_unavailable"});return;}
   json(response,200,{ok:true,frame});
   return;
  }
  if(request.method==="GET"&&request.url==="/v1/voice/status"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   json(response,200,{ok:true,voice:voice.status()});return;
  }
  if(request.method==="POST"&&request.url==="/v1/voice/transcribe"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{
    const contentType=typeof request.headers["content-type"]==="string"?request.headers["content-type"]:"audio/webm";
    const filename=typeof request.headers["x-layanx-filename"]==="string"?request.headers["x-layanx-filename"]:"voice.webm";
    const language=typeof request.headers["x-layanx-language"]==="string"?request.headers["x-layanx-language"]:undefined;
    const audio=await rawBody(request,Math.max(max,16*1024*1024));
    if(!audio.length){json(response,400,{ok:false,error:"audio body is required"});return;}
    const text=await voice.transcribe(audio,contentType.split(";")[0]??"audio/webm",filename,language);
    json(response,200,{ok:true,text,provider:voice.status().provider});
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"voice transcription failed"});}
   return;
  }
  if(request.method==="POST"&&request.url==="/v1/voice/speak"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{
    const input=await body(request,max);
    const textValue=typeof input.text==="string"?input.text.trim():"";
    const format=input.format==="wav"||input.format==="opus"?input.format:"mp3";
    if(!textValue){json(response,400,{ok:false,error:"text is required"});return;}
    const result=await voice.speak(textValue,format);
    response.statusCode=200;response.setHeader("content-type",result.contentType);response.setHeader("cache-control","no-store");response.end(result.audio);
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"voice synthesis failed"});}
   return;
  }
  if(request.method==="POST"&&request.url==="/mcp"){
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
  if(request.method==="GET"&&request.url?.split("?")[0]==="/v1/approvals"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const projectId=new URL(request.url,"http://localhost").searchParams.get("projectId")?.trim()??"";
   if(!projectId){json(response,400,{ok:false,error:"projectId is required"});return;}
   const approvals=options.core.executionRuntime.approvals.list().filter(approval=>{
    const mission=options.core.missions.get(approval.missionId);
    if(!mission)return false;
    try{options.core.projectIsolation.assertMissionProject(projectId,mission.projectId);}catch{return false;}
    return Date.parse(approval.expiresAt)>Date.now();
   }).map(approval=>({...approval,approved:options.core.executionRuntime.approvals.isApproved(approval.id)}));
   json(response,200,{ok:true,approvals});return;
  }
  if(request.method==="POST"&&request.url?.match(/^\/v1\/approvals\/[^/]+\/(approve|revoke)$/)){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const parsedApprovalUrl=new URL(request.url,"http://localhost");
   const parts=parsedApprovalUrl.pathname.split("/");
   const approvalId=parts[3] as string;
   const action=parts[4] as string;
   const projectId=parsedApprovalUrl.searchParams.get("projectId")?.trim()??"";
   if(!projectId){json(response,400,{ok:false,error:"projectId is required"});return;}
   try{
    const approval=options.core.executionRuntime.approvals.get(approvalId);
    const mission=options.core.missions.get(approval.missionId);
    if(!mission){json(response,404,{ok:false,error:"mission_not_found"});return;}
    options.core.projectIsolation.assertMissionProject(projectId,mission.projectId);
    if(action==="approve")options.core.executionRuntime.approvals.approve(approvalId);
    else options.core.executionRuntime.approvals.revoke(approvalId);
    await options.core.executionRuntime.persist(mission);
    json(response,200,{ok:true,approval:{...approval,approved:options.core.executionRuntime.approvals.isApproved(approvalId)}});return;
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"approval operation failed"});return;}
  }
  if(request.method==="GET"&&request.url==="/v1/oauth/connections"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   json(response,200,{ok:true,connections:oauth.list()});return;
  }
  if(request.method==="POST"&&request.url==="/v1/oauth/connect"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{const input=await body(request,max);const provider=String(input.provider) as import("./business/types.js").OAuthProvider;const accountId=typeof input.accountId==="string"&&input.accountId.trim()?input.accountId.trim():"default";const result=oauth.begin(provider,accountId);json(response,200,{ok:true,...result});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"oauth_begin_failed"});}return;
  }
  if(request.method==="GET"&&request.url?.startsWith("/v1/oauth/callback")){
   try{const u=new URL(request.url,"http://localhost");const state=u.searchParams.get("state")??"";const code=u.searchParams.get("code")??"";if(!state||!code){json(response,400,{ok:false,error:"state_and_code_required"});return;}const connection=await oauth.callback(state,code);json(response,200,{ok:true,connection:oauth.status(connection)});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"oauth_callback_failed"});}return;
  }
  if(request.method==="GET"&&request.url?.match(/^\/v1\/oauth\/[^/]+\/discover-ads$/)){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{const id=decodeURIComponent(request.url.split("/")[3]??"");json(response,200,{ok:true,...await oauth.discoverAds(id)});}
   catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"oauth_ads_discovery_failed"});}
   return;
  }
  if(request.method==="GET"&&request.url?.match(/^\/v1\/oauth\/[^/]+\/discover$/)){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{const id=decodeURIComponent(request.url.split("/")[3]??"");json(response,200,{ok:true,...await oauth.discover(id)});}
   catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"oauth_discovery_failed"});}
   return;
  }
  if(request.method==="POST"&&request.url?.match(/^\/v1\/oauth\/[^/]+\/bind$/)){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{
    const id=decodeURIComponent(request.url.split("/")[3]??"");
    const connection=oauth.get(id);
    const input=await body(request,max);
    const platform=typeof input.platform==="string"?input.platform as import("./business/types.js").SocialPlatform:"generic";
    const externalId=typeof input.externalId==="string"?input.externalId.trim():"";
    const name=typeof input.name==="string"&&input.name.trim()?input.name.trim():externalId;
    if(!externalId||!name){json(response,400,{ok:false,error:"platform, externalId, and name are required"});return;}
    const allowed=["generic","instagram","facebook","tiktok","youtube","x","linkedin","snapchat","pinterest"];
    if(!allowed.includes(platform)){json(response,400,{ok:false,error:"unsupported_social_platform"});return;}
    if(!["meta","instagram","facebook","tiktok","youtube","x","linkedin","snapchat","pinterest"].includes(connection.provider)){
     json(response,400,{ok:false,error:"oauth_provider_cannot_bind_social"});return;
    }
    const account=business.upsertSocialAccount({platform,name,externalId,enabled:true});
    json(response,201,{ok:true,connection:oauth.status(connection),account});
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"oauth_bind_failed"});}
   return;
  }
  if(request.method==="POST"&&request.url?.match(/^\/v1\/oauth\/[^/]+\/revoke$/)){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{const id=request.url.split("/")[3] as string;const connection=oauth.get(id);oauth.revoke(connection);json(response,200,{ok:true,id});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"oauth_revoke_failed"});}return;
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
  if(request.method==="GET"&&request.url==="/v1/ads"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}json(response,200,{ok:true,ads:ads.snapshot(),dashboard:ads.dashboard()});return;}
  if(request.method==="POST"&&request.url==="/v1/ads/account"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}try{json(response,201,{ok:true,account:ads.addAccount(await body(request,max) as any)});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"ad account failed"});}return;}
  if(request.method==="POST"&&request.url==="/v1/ads/campaign"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}try{json(response,201,{ok:true,campaign:ads.createCampaign(await body(request,max) as any)});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"paid campaign creation failed"});}return;}
  if(request.method==="POST"&&request.url==="/v1/ads/adgroup"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}try{json(response,201,{ok:true,adGroup:ads.createAdGroup(await body(request,max) as any)});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"ad group creation failed"});}return;}
  if(request.method==="POST"&&request.url==="/v1/ads/creative"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}try{json(response,201,{ok:true,creative:ads.createCreative(await body(request,max) as any)});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"creative creation failed"});}return;}
  if(request.method==="POST"&&request.url==="/v1/ads/ad"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}try{json(response,201,{ok:true,ad:ads.createAd(await body(request,max) as any)});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"ad creation failed"});}return;}
  if(request.method==="POST"&&request.url==="/v1/ads/campaign/launch"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}try{const input=await body(request,max);json(response,200,{ok:true,result:await ads.launchCampaign(String(input.campaignId))});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"campaign launch failed"});}return;}
  if(request.method==="POST"&&request.url==="/v1/ads/campaign/pause"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}try{const input=await body(request,max);json(response,200,{ok:true,campaign:await ads.pauseCampaign(String(input.campaignId))});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"campaign pause failed"});}return;}
  if(request.method==="POST"&&request.url==="/v1/ads/insights/sync"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}try{const input=await body(request,max);json(response,200,{ok:true,metrics:await ads.syncInsights(String(input.accountId),input.campaignId?String(input.campaignId):undefined)});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"ad insights sync failed"});}return;}
  if(request.method==="GET"&&request.url==="/v1/business"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}json(response,200,{ok:true,business:business.snapshot(),persistence:business.store.persistenceStatus()});return;}
  if(request.method==="POST"&&request.url==="/v1/business/store"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}try{json(response,201,{ok:true,store:business.createStore(await body(request,max) as any)});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"store creation failed"});}return;}
  if(request.method==="POST"&&request.url==="/v1/business/product"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}try{json(response,201,{ok:true,product:business.createProduct(await body(request,max) as any)});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"product creation failed"});}return;}
  if(request.method==="PATCH"&&request.url?.match(/^\/v1\/business\/product\/[^/]+$/)){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}try{json(response,200,{ok:true,product:business.updateProduct(decodeURIComponent(request.url.split("/").pop()!),await body(request,max))});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"product update failed"});}return;}
  if(request.method==="POST"&&request.url==="/v1/business/product/publish"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}try{const input=await body(request,max);json(response,200,{ok:true,result:await business.publishProduct(String(input.productId))});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"product publish failed"});}return;}
  if(request.method==="POST"&&request.url==="/v1/business/orders/sync"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}try{const input=await body(request,max);json(response,200,{ok:true,orders:await business.syncOrders(String(input.storeId))});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"order sync failed"});}return;}
  if(request.method==="POST"&&request.url==="/v1/business/social-account"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}try{json(response,201,{ok:true,account:business.upsertSocialAccount(await body(request,max) as any)});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"social account failed"});}return;}
  if(request.method==="POST"&&request.url==="/v1/business/media/inspect"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}try{const input=await body(request,max);json(response,200,{ok:true,media:await media.inspect(String(input.url))});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"media inspection failed"});}return;}
  if(request.method==="POST"&&request.url==="/v1/business/media"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}try{json(response,201,{ok:true,media:business.addMedia(await body(request,max) as any)});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"media registration failed"});}return;}
  if(request.method==="POST"&&request.url==="/v1/business/content/generate"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}try{const input=await body(request,max);json(response,201,{ok:true,content:await business.generateProductContentAI(String(input.productId),Array.isArray(input.platforms)?input.platforms.filter((x):x is any=>typeof x==="string"):undefined)});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"content generation failed"});}return;}
  if(request.method==="POST"&&request.url==="/v1/business/content/approve"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}try{const input=await body(request,max);json(response,200,{ok:true,content:business.updateContent(String(input.contentId),{status:"approved"})});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"content approval failed"});}return;}
  if(request.method==="POST"&&request.url==="/v1/business/content/publish"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}try{const input=await body(request,max);json(response,200,{ok:true,result:await business.publishContent(String(input.contentId))});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"content publish failed"});}return;}
  if(request.method==="POST"&&request.url==="/v1/business/content/schedule"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}try{const input=await body(request,max);json(response,200,{ok:true,content:business.scheduleContent(String(input.contentId),String(input.scheduledAt))});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"content scheduling failed"});}return;}
  if(request.method==="POST"&&request.url==="/v1/business/content/process-scheduled"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}try{json(response,200,{ok:true,results:await business.processScheduledContent()});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"scheduled content processing failed"});}return;}
  if(request.method==="GET"&&request.url==="/v1/growth"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}if(!growth){json(response,503,{ok:false,error:"growth_engine_not_configured"});return;}json(response,200,{ok:true,growth:growth.snapshot()});return;}
  if(request.method==="GET"&&request.url==="/v1/growth/dashboard"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}if(!growth){json(response,503,{ok:false,error:"growth_engine_not_configured"});return;}json(response,200,{ok:true,dashboard:growth.dashboard()});return;}
  if(request.method==="POST"&&request.url==="/v1/growth/experiment"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}if(!growth){json(response,503,{ok:false,error:"growth_engine_not_configured"});return;}try{json(response,201,{ok:true,experiment:growth.createExperiment(await body(request,max) as any)});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"growth experiment creation failed"});}return;}
  if(request.method==="POST"&&request.url==="/v1/growth/plan-cycle"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}if(!growth){json(response,503,{ok:false,error:"growth_engine_not_configured"});return;}try{const input=await body(request,max);const projectId=typeof input.projectId==="string"?input.projectId.trim():"";if(!projectId){json(response,400,{ok:false,error:"projectId is required"});return;}json(response,201,{ok:true,...await growth.planCycle({projectId,storeId:typeof input.storeId==="string"?input.storeId:undefined,productId:typeof input.productId==="string"?input.productId:undefined,channel:typeof input.channel==="string"?input.channel:undefined})});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"growth cycle planning failed"});}return;}
  if(request.method==="POST"&&request.url==="/v1/growth/metric"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}if(!growth){json(response,503,{ok:false,error:"growth_engine_not_configured"});return;}try{json(response,201,{ok:true,metric:growth.recordMetric(await body(request,max) as any)});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"growth metric recording failed"});}return;}
  if(request.method==="POST"&&request.url==="/v1/growth/action/complete"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}if(!growth){json(response,503,{ok:false,error:"growth_engine_not_configured"});return;}try{const input=await body(request,max);json(response,200,{ok:true,action:growth.completeAction(String(input.id),input.status==="dismissed"?"dismissed":"done")});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"growth action update failed"});}return;}
  if(request.method==="GET"&&request.url==="/v1/business/analytics"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}json(response,200,{ok:true,analytics:business.analytics()});return;}
  if(request.method==="POST"&&request.url==="/v1/business/campaign"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}try{json(response,201,{ok:true,campaign:business.createCampaign(await body(request,max) as any)});}catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"campaign creation failed"});}return;}
  if(request.method==="GET"&&request.url==="/v1/status"){json(response,200,runtimeStatus(runtimeView(options.core,options.persistence,business,ads,media)));return;}
  if(request.method==="GET"&&request.url==="/v1/channels/status"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   json(response,200,{ok:true,channels:options.channels?.status()??{enabled:false}});
   return;
  }
  if(request.method==="GET"&&request.url==="/v1/channels/whatsapp/webhook"){
   const parsed=new URL(request.url,"http://localhost");
   const mode=parsed.searchParams.get("hub.mode")??"";
   const token=parsed.searchParams.get("hub.verify_token")??"";
   const challenge=parsed.searchParams.get("hub.challenge")??"";
   try{
    if(!options.channels){json(response,503,{ok:false,error:"messaging_channels_not_configured"});return;}
    response.statusCode=200;response.setHeader("content-type","text/plain; charset=utf-8");response.end(options.channels.whatsapp.verify(mode,token,challenge));
   }catch{json(response,403,{ok:false,error:"whatsapp_webhook_verification_failed"});}
   return;
  }
  if(request.method==="POST"&&request.url==="/v1/channels/whatsapp/webhook"){
   try{
    if(!options.channels){json(response,503,{ok:false,error:"messaging_channels_not_configured"});return;}
    const raw=await rawBody(request,max);
    const signature=typeof request.headers["x-hub-signature-256"]==="string"?request.headers["x-hub-signature-256"]:"";
    if(!options.channels.whatsapp.verifySignature(raw,signature)){json(response,403,{ok:false,error:"whatsapp_signature_invalid"});return;}
    const input=JSON.parse(raw.toString("utf8"));
    const message=options.channels.whatsapp.parseWebhook(input);
    response.statusCode=200;response.setHeader("content-type","application/json; charset=utf-8");response.end(JSON.stringify({ok:true}));
    if(message)void options.channels.handle(message).catch(()=>undefined);
   }catch(error){json(response,400,{ok:false,error:error instanceof Error?error.message:"whatsapp_webhook_failed"});}
   return;
  }
  if(request.method==="GET"&&request.url==="/v1/health"){const health=await runtimeHealth(runtimeView(options.core,options.persistence,business,ads,media));json(response,health.healthy?200:503,health);return;}
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
  if(request.method==="GET"&&request.url?.match(/^\/v1\/projects\/[^/]+\/graph$/)){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const parts=request.url.split("/");
   const projectId=decodeURIComponent(parts[3]??"").trim();
   if(!projectId){json(response,400,{ok:false,error:"projectId is required"});return;}
   try{
    const graph=await options.core.projectGraph.scan(projectId);
    json(response,200,{ok:true,graph});
   }catch(error){
    json(response,422,{ok:false,error:error instanceof Error?error.message:"project graph scan failed"});
   }
   return;
  }
  if(request.method==="POST"&&request.url?.match(/^\/v1\/projects\/[^/]+\/impact$/)){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const parts=request.url.split("/");
   const projectId=decodeURIComponent(parts[3]??"").trim();
   if(!projectId){json(response,400,{ok:false,error:"projectId is required"});return;}
   try{
    const input=await body(request,max);
    const query=typeof input.query==="string"?input.query.trim():"";
    if(!query){json(response,400,{ok:false,error:"query_required"});return;}
    const graph=await options.core.projectGraph.scan(projectId);
    const impact=options.core.impactAnalyzer.analyze(graph,query);
    const tests=options.core.testSelector.select(graph,impact);
    json(response,200,{ok:true,impact,selectedTests:tests.tests});
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"impact analysis failed"});}
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
  if(request.method==="POST"&&request.url?.match(/^\/v1\/missions\/[^/]+\/cancel$/)){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const missionId=decodeURIComponent(request.url.split("/")[3]??"");
   const mission=options.core.missions.get(missionId);
   if(!mission){json(response,404,{ok:false,error:"mission_not_found"});return;}
   try{
    const input=await body(request,max);
    const projectId=typeof input.projectId==="string"?input.projectId.trim():"";
    if(!projectId){json(response,400,{ok:false,error:"projectId is required"});return;}
    const control=new ControlCenter(options.core);
    control.cancel(missionId,projectId);
    json(response,200,{ok:true,mission:options.core.missions.get(missionId)});
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"mission cancellation failed"});}
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
    let impactRisk:"low"|"medium"|"high"|"critical"="low";
    try{
      const impact=await options.core.prepareChangeImpact(mission,projectId,{tool:plan.tool,action:plan.action});
      impactRisk=impact.impact.risk;
    }catch(error){
      json(response,422,{ok:false,error:error instanceof Error?"change impact analysis failed: "+error.message:"change impact analysis failed"});return;
    }
    if(!risk.requiresApproval&&!tool.dangerous&&!["high","critical"].includes(impactRisk)){json(response,400,{ok:false,error:"This tool does not require explicit approval"});return;}
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
  if(request.method==="GET"&&request.url==="/v1/traces"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   json(response,200,{ok:true,traces:options.core.tracer.list()});return;
  }
  if(request.method==="GET"&&request.url==="/v1/release"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   json(response,200,{ok:true,releases:options.core.releaseRecords()});return;
  }
  if(request.method==="POST"&&request.url==="/v1/release"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{
    const input=await body(request,max);
    const required=["id","missionId","projectId","branch","baseBranch","commit","title"];
    if(required.some(key=>typeof input[key]!=="string"||!(input[key] as string).trim())){json(response,400,{ok:false,error:"id, missionId, projectId, branch, baseBranch, commit, and title are required"});return;}
    const release=options.core.createReleaseRecord({id:input.id as string,missionId:input.missionId as string,projectId:input.projectId as string,branch:input.branch as string,baseBranch:input.baseBranch as string,commit:input.commit as string,title:input.title as string});
    json(response,201,{ok:true,release});
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"release creation failed"});}
   return;
  }
  if(request.method==="POST"&&request.url?.match(/^\/v1\/release\/[^/]+\/transition$/)){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{
    const id=request.url.split("/")[3] as string;
    const input=await body(request,max);
    const next=typeof input.stage==="string"?input.stage as import("./core/release-state-machine.js").ReleaseStage:"BLOCKED";
    const blockers=Array.isArray(input.blockers)?input.blockers.filter((v):v is string=>typeof v==="string"): [];
    const release=options.core.transitionRelease(id,next,blockers);
    json(response,200,{ok:true,release});
   }catch(error){json(response,409,{ok:false,error:error instanceof Error?error.message:"release transition failed"});}
   return;
  }
  if(request.method==="POST"&&request.url==="/v1/git/pr-draft"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{
    const input=await body(request,max);
    const missionId=typeof input.missionId==="string"?input.missionId.trim():"";
    const projectId=typeof input.projectId==="string"?input.projectId.trim():"";
    const baseBranch=typeof input.baseBranch==="string"?input.baseBranch.trim():"";
    const title=typeof input.title==="string"?input.title.trim():"";
    const goal=typeof input.goal==="string"?input.goal.trim():"";
    const baseRef=typeof input.reviewBaseRef==="string"&&input.reviewBaseRef.trim()?input.reviewBaseRef.trim():"HEAD~1";
    if(!missionId||!projectId||!baseBranch||!title||!goal){json(response,400,{ok:false,error:"missionId, projectId, baseBranch, title, and goal are required"});return;}
    const [codeReview,securityReview]=await Promise.all([options.core.reviewCurrentCommit(baseRef),options.core.reviewCurrentCommitSecurity(baseRef)]);
    const draft=await options.core.generatePullRequest({missionId,projectId,baseBranch,title,goal,codeReview,securityReview});
    json(response,draft.ready?200:409,{ok:true,draft});
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"pull request draft failed"});}
   return;
  }
  if(request.method==="POST"&&request.url==="/v1/git/security-review"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{
    const input=await body(request,max);
    const baseRef=typeof input.baseRef==="string"&&input.baseRef.trim()?input.baseRef.trim():"HEAD~1";
    const review=await options.core.reviewCurrentCommitSecurity(baseRef);
    json(response,200,{ok:true,review});
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"security review failed"});}
   return;
  }
  if(request.method==="POST"&&request.url==="/v1/git/review"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{
    const input=await body(request,max);
    const baseRef=typeof input.baseRef==="string"&&input.baseRef.trim()?input.baseRef.trim():"HEAD~1";
    const review=await options.core.reviewCurrentCommit(baseRef);
    json(response,200,{ok:true,review});
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"code review failed"});}
   return;
  }
  if(request.method==="POST"&&request.url==="/v1/git/commit"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{
    const input=await body(request,max);
    const missionId=typeof input.missionId==="string"?input.missionId.trim():"";
    const projectId=typeof input.projectId==="string"?input.projectId.trim():"";
    const message=typeof input.message==="string"?input.message.trim():"";
    const expectedBranch=typeof input.expectedBranch==="string"&&input.expectedBranch.trim()?input.expectedBranch.trim():undefined;
    const paths=Array.isArray(input.paths)?input.paths.filter((p):p is string=>typeof p==="string").map(p=>p.trim()).filter(Boolean):undefined;
    if(!missionId||!projectId||!message){json(response,400,{ok:false,error:"missionId, projectId, and message are required"});return;}
    const result=await options.core.commitMissionChanges({missionId,projectId,message,expectedBranch,paths,requireCleanAfterCommit:input.requireCleanAfterCommit!==false});
    json(response,result.committed?201:200,{ok:true,result});
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"git commit failed"});}
   return;
  }
  if(request.method==="GET"&&request.url==="/v1/git/branch"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{json(response,200,{ok:true,status:await options.core.gitBranchStatus()});}
   catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"git status failed"});}
   return;
  }
  if(request.method==="POST"&&request.url==="/v1/git/branch"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{
    const input=await body(request,max);
    const branchName=typeof input.branchName==="string"?input.branchName.trim():"";
    const baseRef=typeof input.baseRef==="string"&&input.baseRef.trim()?input.baseRef.trim():undefined;
    if(!branchName){json(response,400,{ok:false,error:"branchName is required"});return;}
    const status=await options.core.createGitBranch(branchName,baseRef,input.requireClean!==false);
    json(response,201,{ok:true,status});
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"git branch creation failed"});}
   return;
  }
  if(request.method==="GET"&&request.url==="/v1/mission-dependencies"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const parsed=new URL(request.url,"http://localhost");
   const projectId=parsed.searchParams.get("projectId")?.trim()||undefined;
   json(response,200,{ok:true,dependencies:options.core.missionDependencies.list(projectId)});
   return;
  }
  if(request.method==="POST"&&request.url==="/v1/mission-dependencies"){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{
    const input=await body(request,max);
    const missionId=typeof input.missionId==="string"?input.missionId.trim():"";
    const projectId=typeof input.projectId==="string"?input.projectId.trim():"";
    const dependsOn=Array.isArray(input.dependsOn)?input.dependsOn.filter((id):id is string=>typeof id==="string"&&id.trim().length>0).map(id=>id.trim()):[];
    if(!missionId||!projectId){json(response,400,{ok:false,error:"missionId and projectId are required"});return;}
    const dependency=options.core.registerMissionDependencies(missionId,dependsOn,projectId);
    json(response,201,{ok:true,dependency,status:options.core.missionDependencyStatus(missionId)});
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"mission dependency registration failed"});}
   return;
  }
  if(request.method==="GET"&&request.url?.match(/^\/v1\/mission-dependencies\/[^/]+$/)){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const missionId=decodeURIComponent(request.url.split("/")[3]??"");
   try{json(response,200,{ok:true,status:options.core.missionDependencyStatus(missionId)});}
   catch(error){json(response,404,{ok:false,error:error instanceof Error?error.message:"mission not found"});}
   return;
  }
  if(request.method==="POST"&&request.url?.match(/^\/v1\/mission-dependencies\/[^/]+\/run$/)){
   if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   const missionId=decodeURIComponent(request.url.split("/")[3]??"");
   try{
    const input=await body(request,max);
    const projectId=typeof input.projectId==="string"?input.projectId.trim():"";
    const maxSteps=typeof input.maxSteps==="number"&&Number.isInteger(input.maxSteps)?Math.min(Math.max(input.maxSteps,1),25):10;
    const agentId=typeof input.agentId==="string"&&input.agentId.trim()?input.agentId.trim():"core";
    if(!projectId){json(response,400,{ok:false,error:"projectId is required"});return;}
    const result=await options.core.runDependentMission(missionId,projectId,maxSteps,agentId);
    json(response,result.completed?200:202,result);
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"dependent mission execution failed"});}
   return;
  }
  if(request.method==="GET"&&request.url==="/v1/scheduler"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   json(response,200,{ok:true,schedules:options.core.scheduler.list()});return;
  }
  if(request.method==="POST"&&request.url==="/v1/scheduler/schedules"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{
    const input=await body(request,max);
    const goal=typeof input.goal==="string"?input.goal.trim():"";
    const projectId=typeof input.projectId==="string"?input.projectId.trim():"";
    const trigger=input.trigger&&typeof input.trigger==="object"&&!Array.isArray(input.trigger)?input.trigger as import("./core/scheduler.js").ScheduleTrigger:null;
    if(!goal||!projectId||!trigger){json(response,400,{ok:false,error:"goal, projectId, and trigger are required"});return;}
    const schedule=options.core.scheduler.register({goal,projectId,trigger,maxSteps:typeof input.maxSteps==="number"?Math.min(Math.max(Math.floor(input.maxSteps),1),25):10,agentId:typeof input.agentId==="string"&&input.agentId.trim()?input.agentId.trim():"core",enabled:input.enabled!==false});
    json(response,201,{ok:true,schedule});
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"schedule creation failed"});}
   return;
  }
  if(request.method==="POST"&&request.url?.match(/^\/v1\/scheduler\/[^/]+\/enable$/)){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{
    const id=decodeURIComponent(request.url.split("/")[3]??"");
    const input=await body(request,max);
    const schedule=options.core.scheduler.setEnabled(id,input.enabled!==false);
    json(response,200,{ok:true,schedule});
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"schedule update failed"});}
   return;
  }
  if(request.method==="DELETE"&&request.url?.match(/^\/v1\/scheduler\/[^/]+$/)){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{options.core.scheduler.unregister(decodeURIComponent(request.url.split("/")[3]??""));json(response,200,{ok:true});}
   catch(error){json(response,404,{ok:false,error:error instanceof Error?error.message:"schedule not found"});}
   return;
  }
  if(request.method==="POST"&&request.url==="/v1/scheduler/tick"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{const runs=await options.core.scheduler.tick();json(response,200,{ok:true,runs});}
   catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"scheduler tick failed"});}
   return;
  }
  if(request.method==="GET"&&request.url==="/v1/events/triggers"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   json(response,200,{ok:true,triggers:options.core.eventEngine.list()});return;
  }
  if(request.method==="POST"&&request.url==="/v1/events/triggers"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{
    const input=await body(request,max);
    const eventType=typeof input.eventType==="string"?input.eventType.trim():"";
    const projectId=typeof input.projectId==="string"?input.projectId.trim():"";
    const goal=typeof input.goal==="string"?input.goal.trim():"";
    const match=input.match&&typeof input.match==="object"&&!Array.isArray(input.match)?input.match as Record<string,unknown>:undefined;
    if(!eventType||!projectId||!goal){json(response,400,{ok:false,error:"eventType, projectId, and goal are required"});return;}
    const trigger=options.core.eventEngine.register({eventType,projectId,goal,match,maxSteps:typeof input.maxSteps==="number"?Math.min(Math.max(Math.floor(input.maxSteps),1),25):10,agentId:typeof input.agentId==="string"&&input.agentId.trim()?input.agentId.trim():"core",enabled:input.enabled!==false});
    json(response,201,{ok:true,trigger});
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"event trigger creation failed"});}
   return;
  }
  if(request.method==="DELETE"&&request.url?.match(/^\/v1\/events\/triggers\/[^/]+$/)){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{options.core.eventEngine.remove(decodeURIComponent(request.url.split("/")[4]??""));json(response,200,{ok:true});}
   catch(error){json(response,404,{ok:false,error:error instanceof Error?error.message:"event trigger not found"});}
   return;
  }
  if(request.method==="POST"&&request.url==="/v1/events/emit"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}
   try{
    const input=await body(request,max);
    const type=typeof input.type==="string"?input.type.trim():"";
    const projectId=typeof input.projectId==="string"?input.projectId.trim():"";
    const payload=input.payload&&typeof input.payload==="object"&&!Array.isArray(input.payload)?input.payload as Record<string,unknown>:{};
    if(!type||!projectId){json(response,400,{ok:false,error:"type and projectId are required"});return;}
    const results=await options.core.eventEngine.emit({id:crypto.randomUUID(),type,projectId,timestamp:new Date().toISOString(),actor:"api",payload});
    json(response,200,{ok:true,triggered:results.length,results});
   }catch(error){json(response,422,{ok:false,error:error instanceof Error?error.message:"event emission failed"});}
   return;
  }
  if(request.method==="GET"&&request.url==="/v1/missions"){if(!authorized(request,options.token)){json(response,401,{ok:false,error:"unauthorized"});return;}json(response,200,{ok:true,missions:options.core.missions.list()});return;}
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
 if(options.channels)void options.channels.start();
 server.listen(port,host);options.core.scheduler.start();return server;
}
