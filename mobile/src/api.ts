import {LayanxNative,type LinkedDevice} from "../modules/layanx-native";

export type {LinkedDevice};
export type MissionSummary={id:string;goal:string;status:string;createdAt?:string};
export type Job={id:string;goal:string;status:string;milestones:Array<{title:string;status:string}>;current:number;result?:string;waiting?:{approvalId:string}};
export type AssistantReply={ok:boolean;lang:"ar"|"en";intent:string;reply:string;missionId?:string;task?:{completed:boolean;paused:boolean;reason?:string}};
/** One item that waits for the owner: LayanX's own approvals and Claude Code / Codex permission prompts. */
export type CompanionApproval={id:string;kind:"layanx"|"agent";digest:string;tool:string;action?:string;title:string;detail:string;projectId?:string;agent?:string;jobId?:string;expiresAt?:string};
export type CompanionJob={id:string;projectId:string;goal:string;status:string;milestone?:{index:number;total:number;title:string};progress:number;updatedAt:string;result?:string};
export type AgentSession={id:string;agent:"claude"|"codex";project:string;status:"working"|"waiting"|"idle"|"ended";lastTool?:string;lastDetail?:string;prompt?:string;edits:number;updatedAt:string};
export type CompanionFeed={ok:true;v:string;at:string;approvals:CompanionApproval[];jobs:CompanionJob[];agents:AgentSession[];pc:{cpu:number;ram:number;gpu?:number;vram?:number}|null};

export class LinkError extends Error{constructor(message:string,readonly code?:string){super(message);}}

const native=()=>{if(!LayanxNative)throw new LinkError("هذا الإصدار من التطبيق يعمل على أندرويد فقط.");return LayanxNative;};

/** Pairs with the computer in a scanned (or pasted) layanx://pair link. */
export async function pairWithLink(link:string,phoneName:string):Promise<LinkedDevice>{
  try{return await native().pair(link.trim(),phoneName);}catch(e){throw new LinkError(e instanceof Error?e.message:"فشل الربط",(e as {code?:string}).code);}
}

/**
 * Every request goes through the encrypted link (the native module holds the keys and tries each
 * address of the PC: home Wi-Fi, Tailscale, tunnel). Answers are JSON.
 */
export class LayanXApi{
  constructor(readonly device:LinkedDevice){}
  private async request<T>(method:string,path:string,body?:unknown,timeoutMs=20000):Promise<T>{
    let r;
    try{r=await native().request({deviceId:this.device.id,method,path,...(body!==undefined?{body:JSON.stringify(body),bodyType:"application/json"}:{}),timeoutMs});}
    catch(e){throw new LinkError(e instanceof Error?e.message:"Network error",(e as {code?:string}).code);}
    let d:any={};try{d=r.body&&!r.base64?JSON.parse(r.body):{};}catch{d={raw:r.body};}
    if(r.status<200||r.status>=300)throw new LinkError(d?.message??d?.error??`HTTP ${r.status}`);
    return d as T;
  }
  private get<T>(path:string,timeoutMs?:number){return this.request<T>("GET",path,undefined,timeoutMs);}
  private post<T>(path:string,body:unknown={},timeoutMs?:number){return this.request<T>("POST",path,body,timeoutMs);}

  whoami(){return this.get<{deviceId:string;name:string;installId:string;computer?:string;addresses?:string[]}>("/v1/device/whoami",8000)}
  /** Waits up to `wait` seconds for something to change after version `since`. */
  feed(since?:string,wait=0){return this.get<CompanionFeed>(`/v1/companion/feed?wait=${wait}${since?"&since="+encodeURIComponent(since):""}`,(wait+20)*1000)}
  decide(item:CompanionApproval,decision:"approve"|"deny"){return this.post<{ok:boolean;error?:string;resumed?:boolean}>("/v1/companion/decide",{id:item.id,digest:item.digest,decision})}
  missions(projectId:string){return this.get<{ok:true;missions:MissionSummary[]}>(`/v1/missions?projectId=${encodeURIComponent(projectId)}`)}
  run(goal:string,projectId:string,model="auto"){return this.post<any>("/v1/agent/gateway",{goal,projectId,maxSteps:10,model},180000)}
  createJob(goal:string,projectId:string){return this.post<{ok:true;job:Job}>("/v1/supervisor/jobs",{goal,projectId})}
  jobs(projectId:string){return this.get<{ok:true;jobs:Job[]}>(`/v1/supervisor/jobs?projectId=${encodeURIComponent(projectId)}`)}
  cancelJob(id:string){return this.post<any>(`/v1/supervisor/jobs/${encodeURIComponent(id)}/cancel`)}
  liveStart(){return this.post<any>("/v1/computer/live/start")}
  liveStop(){return this.post<any>("/v1/computer/live/stop")}
  liveFrame(){return this.get<{ok:true;frame?:{mimeType:string;base64:string}}>("/v1/computer/live/frame",15000)}
  assistant(text:string,projectId:string){return this.post<AssistantReply>("/v1/assistant/turn",{text,projectId,lang:"auto"},180000)}
  business(){return this.get<any>("/v1/business")}
  ads(){return this.get<any>("/v1/ads")}
  /** A recorded WAV clip (base64) to text, on the PC's speech-to-text. */
  async transcribe(wavBase64:string):Promise<string>{
    let r;
    try{r=await native().request({deviceId:this.device.id,method:"POST",path:"/v1/voice/transcribe",body:wavBase64,bodyType:"audio/wav",base64:true,timeoutMs:120000});}
    catch(e){throw new LinkError(e instanceof Error?e.message:"Network error",(e as {code?:string}).code);}
    let d:any={};try{d=r.body?JSON.parse(r.body):{};}catch{}
    if(r.status!==200||typeof d.text!=="string")throw new LinkError(d?.error??`HTTP ${r.status}`);
    return d.text;
  }
}
