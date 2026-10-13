import crypto from "node:crypto";
import type {ApprovalRequest} from "../security/approval.js";
import type {SupervisorJob} from "../autonomy/supervisor.js";
import type {SystemLoad} from "../platform/system-load.js";
import type {AgentHookHub,AgentSession} from "./agent-hooks.js";
import {describeInput} from "./describe.js";

/**
 * What the phone, the screen-top island and the dashboard all watch: approvals waiting for the owner
 * (LayanX's own and coding agents' prompts), autonomous jobs and their progress, coding-agent sessions,
 * and how busy the PC is. Decisions go through decide() whoever makes them, so there is one path.
 *
 * Every item carries a digest of exactly what is being approved; a decision must quote it, so an
 * answer given on an older view can never apply to a different request.
 */
export interface CompanionApproval{
  id:string;kind:"layanx"|"agent";digest:string;tool:string;action?:string;title:string;
  /** Everything that will run (every field of the input). When full is false it was too long or is not
   *  known exactly; the phone and the island then send the owner to the PC instead of a quick approve. */
  detail:string;full:boolean;
  projectId?:string;agent?:string;jobId?:string;createdAt?:string;expiresAt?:string;
}
export interface CompanionJob{id:string;projectId:string;goal:string;status:string;milestone?:{index:number;total:number;title:string};progress:number;updatedAt:string;result?:string;preview?:string}
export interface CompanionFeed{v:string;at:string;approvals:CompanionApproval[];jobs:CompanionJob[];agents:AgentSession[];pc:{cpu:number;ram:number;gpu?:number;vram?:number}|null;scalper?:unknown}

interface MissionLike{id:string;projectId?:string;goal?:string;status?:string;tools?:Array<{tool:string;action:string;reason?:string;payload?:Record<string,unknown>}>}
export interface CompanionDeps{
  approvals:{list():ApprovalRequest[];isApproved(id:string):boolean;approve(id:string):void;revoke(id:string):void;get(id:string):ApprovalRequest};
  mission(id:string):MissionLike|undefined;
  persist(missionId:string):Promise<void>;
  cancelMission(missionId:string,projectId:string):void;
  jobs():SupervisorJob[];
  cancelJob(id:string):void;
  /** Same resume paths the dashboard always used: one quick-action tool, or the agent loop. */
  resumeTool(projectId:string,tool:string,payload:Record<string,unknown>,resume:{missionId:string;approvalId:string}):Promise<unknown>;
  resumeAgent(missionId:string,projectId:string,approvalIds:Record<number,string>):Promise<unknown>;
  hub:AgentHookHub;
  load():Promise<SystemLoad|null>;
  scalper?():Promise<unknown>|unknown;
  now?():number;
  log?(message:string):void;
}

const ACTIVE_JOB=new Set(["queued","planning","running","waiting_approval","verifying"]);
const FINISHED_JOB=new Set(["completed","failed","cancelled","budget_exhausted"]);
const ENDED_MISSION=new Set(["completed","cancelled","failed"]);
const line=(v:unknown,n:number)=>String(v??"").split("\n")[0]!.replace(/\s+/g," ").trim().slice(0,n);
const hashOf=(payload:unknown)=>crypto.createHash("sha256").update(JSON.stringify(payload??null)).digest("hex");

export const approvalDigest=(a:Pick<ApprovalRequest,"id"|"missionId"|"tool"|"action"|"payloadHash">)=>
  crypto.createHash("sha256").update([a.id,a.missionId,a.tool,a.action,a.payloadHash].join("\u0000")).digest("hex").slice(0,16);

/**
 * The exact step an approval covers: the payload and plan index stored with it, or (approvals saved by
 * an older version) the planned step whose payload has the approved hash. Never "the first step with
 * the same tool": two terminal steps would be confused.
 */
function stepOf(a:ApprovalRequest,m:MissionLike,jobPayload?:Record<string,unknown>):{payload?:unknown;known:boolean;index:number}{
  const tools=m.tools??[];
  const hashed=tools.findIndex(t=>t.tool===a.tool&&t.action===a.action&&hashOf(t.payload)===a.payloadHash);
  const index=typeof a.planIndex==="number"&&tools[a.planIndex]?.tool===a.tool&&tools[a.planIndex]?.action===a.action?a.planIndex:hashed;
  if(a.payload!==undefined&&hashOf(a.payload)===a.payloadHash)return{payload:a.payload,known:true,index};
  if(jobPayload&&hashOf(jobPayload)===a.payloadHash)return{payload:jobPayload,known:true,index};
  if(hashed>=0)return{payload:tools[hashed]!.payload,known:true,index};
  return{known:false,index};
}
const FIRST_KEYS=["command","task","agent","url","branch","goal","path","message","text"];

export class Companion{
  /** Approvals the owner refused: they never come back, and a late "approve" for them is refused. */
  private readonly denied=new Set<string>();
  constructor(private readonly deps:CompanionDeps){}
  private now(){return(this.deps.now??Date.now)();}

  approvals():CompanionApproval[]{
    const jobs=this.deps.jobs();
    const out:CompanionApproval[]=[];
    for(const a of this.deps.approvals.list()){
      if(Date.parse(a.expiresAt)<=this.now()||this.deps.approvals.isApproved(a.id)||this.denied.has(a.id))continue;
      const m=this.deps.mission(a.missionId);
      if(!m||ENDED_MISSION.has(String(m.status)))continue;
      const owner=jobs.find(j=>j.waiting?.approvalId===a.id);
      if(owner&&FINISHED_JOB.has(owner.status))continue;
      const job=owner?.status==="waiting_approval"?owner:undefined;
      const step=stepOf(a,m,job?.waiting?.payload);
      const shown=step.known?describeInput(step.payload,FIRST_KEYS):{text:line(a.reason,300),full:false};
      out.push({id:a.id,kind:"layanx",digest:approvalDigest(a),tool:a.tool,action:a.action,
        title:line(job?job.goal:m.goal,90)||a.tool,detail:shown.text,full:shown.full,
        projectId:m.projectId??"default",...(job?{jobId:job.id}:{}),expiresAt:a.expiresAt});
    }
    for(const p of this.deps.hub.pending())out.push({id:p.id,kind:"agent",digest:p.digest,tool:p.tool,title:`${p.agent==="claude"?"Claude Code":"Codex"} · ${p.project||"?"}`,detail:p.detail,full:p.full,agent:p.agent,createdAt:p.createdAt,expiresAt:p.expiresAt});
    return out;
  }

  jobs():CompanionJob[]{
    const cutoff=this.now()-30*60_000;
    return this.deps.jobs().filter(j=>ACTIVE_JOB.has(j.status)||(FINISHED_JOB.has(j.status)&&Date.parse(j.updatedAt)>cutoff)).slice(0,8).map(j=>{
      const total=j.milestones.length;const done=j.milestones.filter(m=>m.status==="done").length;
      const m=j.milestones[j.current];
      return{id:j.id,projectId:j.projectId,goal:line(j.goal,120),status:j.status,...(m&&ACTIVE_JOB.has(j.status)?{milestone:{index:j.current+1,total,title:line(m.title,80)}}:{}),
        progress:j.status==="completed"?1:total?Math.round(100*done/total)/100:0,updatedAt:j.updatedAt,...(j.result?{result:line(j.result,200)}:{}),...(j.preview?{preview:j.preview}:{})};
    });
  }

  /** A version of what matters (not the CPU numbers): the long poll answers when it changes. */
  private version(approvals:CompanionApproval[],jobs:CompanionJob[],agents:AgentSession[]):string{
    const key=JSON.stringify([approvals.map(a=>a.id+a.digest),jobs.map(j=>[j.id,j.status,j.milestone?.index,j.progress,j.result]),agents.map(a=>[a.id,a.status,a.lastTool,a.edits])]);
    return crypto.createHash("sha256").update(key).digest("hex").slice(0,12);
  }

  async feed(since?:string,waitMs=0):Promise<CompanionFeed>{
    const end=this.now()+Math.min(Math.max(waitMs,0),30_000);
    let approvals=this.approvals(),jobs=this.jobs(),agents=this.deps.hub.sessions();
    let v=this.version(approvals,jobs,agents);
    while(since&&v===since&&this.now()<end){
      // Wake on a coding-agent event at once; LayanX's own state is checked every second.
      await new Promise<void>(resolve=>{const off=this.deps.hub.onChange(()=>{clearTimeout(t);off();resolve();});const t=setTimeout(()=>{off();resolve();},1000);});
      approvals=this.approvals();jobs=this.jobs();agents=this.deps.hub.sessions();
      v=this.version(approvals,jobs,agents);
    }
    const load=await this.deps.load().catch(()=>null);
    const scalper=this.deps.scalper?await Promise.resolve(this.deps.scalper()).catch(()=>undefined):undefined;
    return{v,at:new Date(this.now()).toISOString(),approvals,jobs,agents,
      pc:load?{cpu:load.cpu.percent,ram:load.memory.percent,...(load.gpu?{gpu:load.gpu.percent,vram:Math.round(100*load.gpu.memoryUsedMB/Math.max(1,load.gpu.memoryTotalMB))}:{})}:null,
      ...(scalper&&(scalper as {running?:boolean}).running?{scalper}:{})};
  }

  /**
   * The owner's decision. approve/deny an item by id + digest. For LayanX's own approvals the work then
   * continues as it always did: a job waiting on it continues by itself; otherwise the one tool or the
   * agent loop resumes (awaited when wait is true, in the background otherwise). Deny stops that work.
   */
  async decide(input:{id:string;digest:string;decision:"approve"|"deny";wait?:boolean}):Promise<{ok:boolean;error?:string;result?:unknown;resumed?:boolean}>{
    const {id,digest,decision}=input;
    if(decision!=="approve"&&decision!=="deny")return{ok:false,error:"bad_decision"};
    if(id.startsWith("ag_")){
      return this.deps.hub.decide(id,digest,decision==="approve"?"allow":"deny")?{ok:true}:{ok:false,error:"not_pending"};
    }
    let a:ApprovalRequest;
    try{a=this.deps.approvals.get(id);}catch{return{ok:false,error:"not_found"};}
    if(approvalDigest(a)!==digest)return{ok:false,error:"changed"};
    const m=this.deps.mission(a.missionId);
    if(!m)return{ok:false,error:"mission_not_found"};
    const job=this.deps.jobs().find(j=>j.waiting?.approvalId===id);
    if(decision==="deny"){
      this.denied.add(id);
      this.deps.approvals.revoke(id);
      if(job)this.deps.cancelJob(job.id);else this.deps.cancelMission(m.id,m.projectId??"default");
      await this.deps.persist(m.id).catch(()=>undefined);
      return{ok:true};
    }
    // Refused once, or the work already ended (refused elsewhere, cancelled, finished): nothing to approve.
    if(this.denied.has(id)||ENDED_MISSION.has(String(m.status))||(job&&FINISHED_JOB.has(job.status)))return{ok:false,error:"not_pending"};
    if(this.deps.approvals.isApproved(id))return{ok:true};
    try{this.deps.approvals.approve(id);}catch(error){return{ok:false,error:error instanceof Error?error.message:"approve_failed"};}
    await this.deps.persist(m.id).catch(()=>undefined);
    if(job)return{ok:true};// the job sees the approval and continues
    const index=stepOf(a,m).index;
    if(index<0)return{ok:true};// approved; whoever asked for it resumes it with its own step
    const quick=(m.goal??"").startsWith("run terminal command")||((m.tools??[]).length===1&&m.tools?.[0]?.reason==="owner quick action");
    const projectId=m.projectId??"default";
    const run=()=>quick?this.deps.resumeTool(projectId,m.tools![0]!.tool,m.tools![0]!.payload??{},{missionId:m.id,approvalId:id}):this.deps.resumeAgent(m.id,projectId,{[index]:id});
    if(input.wait)return{ok:true,resumed:true,result:await run()};
    void run().catch(error=>this.deps.log?.(`companion: resuming ${m.id} failed: ${error instanceof Error?error.message:error}`));
    return{ok:true,resumed:true};
  }
}
