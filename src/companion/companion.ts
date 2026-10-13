import crypto from "node:crypto";
import type {ApprovalRequest} from "../security/approval.js";
import type {SupervisorJob} from "../autonomy/supervisor.js";
import type {SystemLoad} from "../platform/system-load.js";
import type {AgentHookHub,AgentSession} from "./agent-hooks.js";

/**
 * What the phone, the screen-top island and the dashboard all watch: approvals waiting for the owner
 * (LayanX's own and coding agents' prompts), autonomous jobs and their progress, coding-agent sessions,
 * and how busy the PC is. Decisions go through decide() whoever makes them, so there is one path.
 *
 * Every item carries a digest of exactly what is being approved; a decision must quote it, so an
 * answer given on an older view can never apply to a different request.
 */
export interface CompanionApproval{
  id:string;kind:"layanx"|"agent";digest:string;tool:string;action?:string;title:string;detail:string;
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
const line=(v:unknown,n:number)=>String(v??"").split("\n")[0]!.replace(/\s+/g," ").trim().slice(0,n);

export const approvalDigest=(a:Pick<ApprovalRequest,"id"|"missionId"|"tool"|"action"|"payloadHash">)=>
  crypto.createHash("sha256").update([a.id,a.missionId,a.tool,a.action,a.payloadHash].join("\u0000")).digest("hex").slice(0,16);

function payloadSummary(p:Record<string,unknown>|undefined):string{
  if(!p)return"";
  const pick=p.command??p.task??p.agent??p.url??p.branch??p.goal??p.path;
  if(pick!==undefined)return line(Array.isArray(pick)?pick.join(" "):pick,300);
  try{return line(JSON.stringify(p),300);}catch{return"";}
}

export class Companion{
  constructor(private readonly deps:CompanionDeps){}
  private now(){return(this.deps.now??Date.now)();}

  approvals():CompanionApproval[]{
    const jobs=this.deps.jobs();
    const out:CompanionApproval[]=[];
    for(const a of this.deps.approvals.list()){
      if(Date.parse(a.expiresAt)<=this.now()||this.deps.approvals.isApproved(a.id))continue;
      const m=this.deps.mission(a.missionId);
      if(!m||["completed","cancelled","failed"].includes(String(m.status)))continue;
      const job=jobs.find(j=>j.waiting?.approvalId===a.id&&j.status==="waiting_approval");
      const planned=m.tools?.find(t=>t.tool===a.tool&&t.action===a.action);
      out.push({id:a.id,kind:"layanx",digest:approvalDigest(a),tool:a.tool,action:a.action,
        title:line(job?job.goal:m.goal,90)||a.tool,detail:payloadSummary(job?.waiting?.payload??planned?.payload)||line(a.reason,300),
        projectId:m.projectId??"default",...(job?{jobId:job.id}:{}),expiresAt:a.expiresAt});
    }
    for(const p of this.deps.hub.pending())out.push({id:p.id,kind:"agent",digest:p.digest,tool:p.tool,title:`${p.agent==="claude"?"Claude Code":"Codex"} · ${p.project||"?"}`,detail:p.detail,agent:p.agent,createdAt:p.createdAt,expiresAt:p.expiresAt});
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
    if(this.deps.approvals.isApproved(id)&&decision==="approve")return{ok:true};
    const job=this.deps.jobs().find(j=>j.waiting?.approvalId===id);
    if(decision==="deny"){
      this.deps.approvals.revoke(id);
      if(job)this.deps.cancelJob(job.id);else this.deps.cancelMission(m.id,m.projectId??"default");
      await this.deps.persist(m.id).catch(()=>undefined);
      return{ok:true};
    }
    try{this.deps.approvals.approve(id);}catch(error){return{ok:false,error:error instanceof Error?error.message:"approve_failed"};}
    await this.deps.persist(m.id).catch(()=>undefined);
    if(job)return{ok:true};// the job sees the approval and continues
    const index=(m.tools??[]).findIndex(t=>t.tool===a.tool&&t.action===a.action);
    if(index<0)return{ok:true};
    const quick=(m.goal??"").startsWith("run terminal command")||((m.tools??[]).length===1&&m.tools?.[0]?.reason==="owner quick action");
    const projectId=m.projectId??"default";
    const run=()=>quick?this.deps.resumeTool(projectId,m.tools![0]!.tool,m.tools![0]!.payload??{},{missionId:m.id,approvalId:id}):this.deps.resumeAgent(m.id,projectId,{[index]:id});
    if(input.wait)return{ok:true,resumed:true,result:await run()};
    void run().catch(error=>this.deps.log?.(`companion: resuming ${m.id} failed: ${error instanceof Error?error.message:error}`));
    return{ok:true,resumed:true};
  }
}
