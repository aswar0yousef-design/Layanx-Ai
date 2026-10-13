import {createHash} from "node:crypto";
import type {LayanXCore} from "../core/orchestrator.js";
import type {Supervisor,SupervisorJob} from "../autonomy/supervisor.js";
import {approvalDigest,type ApprovalRequest} from "../security/approval.js";
import {runSingleTool} from "../autonomy/runtime-deps.js";
import {systemLoad,type SystemLoad} from "../platform/system-load.js";
import {MT5_AUTO_STATUS_TOOL} from "../trading/mt5-agent-integration.js";

/**
 * What the phone (and the desktop island) need to follow LayanX without polling every
 * endpoint: approvals in every project, the autonomous jobs that are running or just
 * finished, the auto-scalper, and how busy the PC is. Decisions go through ONE function,
 * decideApproval(), used by the existing /v1/approvals/:id/approve|revoke route.
 */
export interface ApprovalView extends ApprovalRequest{
  projectId:string;goal:string;approved:boolean;rejected:boolean;pending:boolean;
  /** approvalDigest(): a phone must send it back, so its decision applies to exactly this request. */
  digest:string;
  /** The autonomous job waiting for this approval; it continues by itself once approved. */
  jobId?:string;
}
const FINISHED=["completed","cancelled","failed"];

export function approvalViews(core:LayanXCore,supervisor:Supervisor,projectId?:string):ApprovalView[]{
  const now=Date.now();
  const waiting=new Map<string,string>();
  for(const j of supervisor.list())if(j.status==="waiting_approval"&&j.waiting)waiting.set(j.waiting.approvalId,j.id);
  const out:ApprovalView[]=[];
  for(const a of core.executionRuntime.approvals.list()){
    if(Date.parse(a.expiresAt)<=now)continue;
    const mission=core.missions.get(a.missionId);
    if(!mission)continue;
    if(projectId){try{core.projectIsolation.assertMissionProject(projectId,mission.projectId);}catch{continue;}}
    const approved=core.executionRuntime.approvals.isApproved(a.id);
    const rejected=core.executionRuntime.approvals.isRejected(a.id);
    const jobId=waiting.get(a.id);
    out.push({...a,projectId:mission.projectId??"default",goal:(mission.goal.split("\n")[0]??"").slice(0,200),approved,rejected,
      // A finished mission withdraws its approvals; they are history, not something to decide.
      pending:!approved&&!rejected&&!FINISHED.includes(String(mission.status)),
      digest:approvalDigest(a),...(jobId?{jobId}:{})});
  }
  return out;
}

export class ApprovalDecisionError extends Error{
  constructor(readonly status:number,readonly code:string,message:string){super(message);}
}

/** Approvals already handed to a continuation: approving twice (notification + app) never runs a mission twice. */
const continued=new Set<string>();

function toolIndex(tools:NonNullable<ReturnType<LayanXCore["missions"]["get"]>>["tools"],r:ApprovalRequest):number{
  const list=tools??[];
  const hash=(p:unknown)=>createHash("sha256").update(JSON.stringify(p??null)).digest("hex");
  const exact=list.findIndex(t=>t.tool===r.tool&&t.action===r.action&&(hash(t.payload)===r.payloadHash||hash(t.payload??{})===r.payloadHash));
  return exact>=0?exact:list.findIndex(t=>t.tool===r.tool&&t.action===r.action);
}

/**
 * After an approval, carry on where the work stopped, on this PC, in the background:
 *  - an autonomous job waiting for it continues by itself ("job");
 *  - a single owner action (a terminal command, a quick tool) runs ("tool");
 *  - otherwise the mission's agent loop resumes with this approval ("mission").
 */
function continueAfterApproval(core:LayanXCore,supervisor:Supervisor,request:ApprovalRequest,projectId:string,log:(m:string)=>void):"job"|"tool"|"mission"|null{
  if(supervisor.list().some(j=>j.status==="waiting_approval"&&j.waiting?.approvalId===request.id))return "job";
  if(continued.has(request.id))return null;
  const mission=core.missions.get(request.missionId);
  if(!mission||FINISHED.includes(String(mission.status)))return null;
  const tools=mission.tools??[];
  const first=tools[0];
  continued.add(request.id);
  if(first&&tools.length===1&&(first.reason==="owner quick action"||mission.goal.startsWith("run terminal command"))){
    void runSingleTool(core,projectId,first.tool,first.payload??{},{missionId:mission.id,approvalId:request.id}).catch(error=>log(`continue ${first.tool}: ${(error as Error).message}`));
    return "tool";
  }
  const index=toolIndex(tools,request);
  if(index<0){continued.delete(request.id);return null;}
  void core.executeAgentLoop(mission.id,projectId,10,{[index]:request.id},request.agentId||"core").catch(error=>log(`continue mission ${mission.id}: ${(error as Error).message}`));
  return "mission";
}

export async function decideApproval(core:LayanXCore,supervisor:Supervisor,input:{
  id:string;projectId:string;action:"approve"|"revoke";digest?:unknown;requireDigest:boolean;resume:boolean;log?:(m:string)=>void;
}):Promise<{approval:ApprovalView|ApprovalRequest&{approved:boolean};continuing:"job"|"tool"|"mission"|null}>{
  let request:ApprovalRequest;
  try{request=core.executionRuntime.approvals.get(input.id);}catch{throw new ApprovalDecisionError(404,"approval_not_found","This request no longer exists.");}
  const mission=core.missions.get(request.missionId);
  if(!mission)throw new ApprovalDecisionError(404,"mission_not_found","Its mission no longer exists.");
  core.projectIsolation.assertMissionProject(input.projectId,mission.projectId);
  if(input.requireDigest||input.digest!==undefined){
    if(typeof input.digest!=="string"||!input.digest)throw new ApprovalDecisionError(428,"digest_required","Send the request's digest with the decision.");
    if(input.digest!==approvalDigest(request))throw new ApprovalDecisionError(409,"approval_changed","This request changed since you saw it. Look at it again.");
  }
  if(input.action==="approve")core.executionRuntime.approvals.approve(input.id);
  else core.executionRuntime.approvals.revoke(input.id);
  await core.executionRuntime.persist(mission);
  const continuing=input.action==="approve"&&input.resume?continueAfterApproval(core,supervisor,request,input.projectId,input.log??(()=>undefined)):null;
  const view=approvalViews(core,supervisor).find(v=>v.id===input.id);
  return{approval:view??{...request,approved:core.executionRuntime.approvals.isApproved(input.id)},continuing};
}

// ---------------------------------------------------------------- feed
export interface FeedJob{
  id:string;projectId:string;goal:string;status:SupervisorJob["status"];
  /** Current milestone title, or what the job is doing. */
  stage:string;done:number;total:number;result?:string;preview?:string;updatedAt:string;waitingApprovalId?:string;
}
export interface Feed{
  cursor:string;at:string;
  approvals:ApprovalView[];
  jobs:FeedJob[];
  scalper:{running:boolean;tradesToday?:number;dailyPnl?:number;consecutiveLosses?:number;lastAction?:string;demo?:boolean}|null;
  load?:SystemLoad;
}
const ACTIVE=["queued","planning","running","waiting_approval","verifying"];
const RECENT_MS=6*3600_000;

function feedJob(j:SupervisorJob):FeedJob{
  const total=j.milestones.length,done=j.milestones.filter(m=>m.status==="done").length;
  const stage=j.status==="waiting_approval"?(j.log.at(-1)?.msg??"Waiting for your approval"):j.milestones[j.current]?.title??(j.log.at(-1)?.msg??j.status);
  return{id:j.id,projectId:j.projectId,goal:(j.goal.split("\n")[0]??"").slice(0,200),status:j.status,stage:stage.slice(0,160),done,total,
    ...(j.result?{result:j.result.slice(0,400)}:{}),...(j.preview?{preview:j.preview}:{}),updatedAt:j.updatedAt,
    ...(j.waiting?{waitingApprovalId:j.waiting.approvalId}:{})};
}

async function scalperStatus(core:LayanXCore):Promise<Feed["scalper"]>{
  try{
    const s=await core.toolAdapters.get(MT5_AUTO_STATUS_TOOL).execute({payload:{}} as never) as Record<string,unknown>;
    return{running:s.running===true,
      ...(typeof s.tradesToday==="number"?{tradesToday:s.tradesToday}:{}),...(typeof s.dailyPnl==="number"?{dailyPnl:s.dailyPnl}:{}),
      ...(typeof s.consecutiveLosses==="number"?{consecutiveLosses:s.consecutiveLosses}:{}),...(typeof s.lastAction==="string"?{lastAction:s.lastAction.slice(0,120)}:{}),
      ...(typeof s.demo==="boolean"?{demo:s.demo}:{})};
  }catch{return null;} // trading switched off on the setup page
}

export async function companionFeed(core:LayanXCore,supervisor:Supervisor,now=Date.now()):Promise<Omit<Feed,"load">>{
  const approvals=approvalViews(core,supervisor).filter(a=>a.pending);
  const jobs=supervisor.list().filter(j=>ACTIVE.includes(j.status)||now-Date.parse(j.updatedAt)<RECENT_MS).slice(0,8).map(feedJob);
  const scalper=await scalperStatus(core);
  // The cursor changes when something the phone shows changes (not with CPU load).
  const cursor=createHash("sha256").update(JSON.stringify([approvals.map(a=>a.id),jobs.map(j=>[j.id,j.status,j.stage,j.done,j.total,j.result,j.preview]),scalper&&[scalper.running,scalper.tradesToday,scalper.lastAction]])).digest("base64url").slice(0,22);
  return{cursor,at:new Date(now).toISOString(),approvals,jobs,scalper};
}

/**
 * Long poll: answer as soon as the feed differs from `cursor`, or after `waitMs` with the
 * same feed. One request at a time per phone keeps it informed within about a second
 * without a cloud push service.
 */
export async function waitForFeed(core:LayanXCore,supervisor:Supervisor,options:{cursor?:string;waitMs?:number;withLoad?:boolean;closed?:()=>boolean;stepMs?:number}={}):Promise<Feed>{
  const end=Date.now()+Math.min(Math.max(options.waitMs??0,0),30_000);
  let feed=await companionFeed(core,supervisor);
  while(options.cursor&&feed.cursor===options.cursor&&Date.now()<end&&!options.closed?.()){
    await new Promise(r=>setTimeout(r,options.stepMs??1000));
    feed=await companionFeed(core,supervisor);
  }
  return options.withLoad===false?feed:{...feed,load:await systemLoad().catch(()=>undefined)};
}
