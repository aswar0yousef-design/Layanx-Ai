import {LayanXNative} from "../modules/layanx-native";
import {isIpAddress} from "./pairing";

export type DeviceIdentity={deviceId:string;name:string;platform:string;apiVersion:string};
export type MissionEvent={id:string;missionId:string;projectId:string;timestamp:string;type:string;actor:string;tool?:string;action?:string;stepIndex?:number;message?:string};
export type Approval={id:string;missionId:string;projectId?:string;goal?:string;tool?:string;action?:string;permission?:string;reason?:string;approved?:boolean;rejected?:boolean;pending?:boolean;
  /** What the phone showed: sent back with the decision so the PC applies it to exactly this request. */
  digest?:string;jobId?:string};
export type FeedJob={id:string;projectId:string;goal:string;status:string;stage:string;done:number;total:number;result?:string;preview?:string;updatedAt:string};
export type Feed={ok:true;cursor:string;at:string;approvals:Approval[];jobs:FeedJob[];
  scalper:{running:boolean;tradesToday?:number;dailyPnl?:number;consecutiveLosses?:number;lastAction?:string;demo?:boolean}|null;
  load?:{cpu:{percent:number;cores:number;model:string};memory:{totalBytes:number;usedBytes:number;percent:number};gpu:{name:string;percent:number;memoryUsedMB:number;memoryTotalMB:number}|null}};
export type MissionSummary={id:string;goal:string;status:string;createdAt?:string};
export type Job={id:string;goal:string;status:string;milestones:Array<{title:string;status:string}>;current:number;result?:string;waiting?:{approvalId:string}};
export type PairResult={ok:true;deviceId:string;deviceToken:string;installId:string};
export type AssistantReply={ok:boolean;lang:"ar"|"en";intent:string;reply:string;missionId?:string;task?:{completed:boolean;paused:boolean;reason?:string}};
/**
 * One HTTP call to the PC. On Android it goes through the native module: https only, and an
 * IP address (home Wi-Fi, Tailscale) must present the certificate pinned from the QR code.
 * Elsewhere (iOS, Expo Go) plain fetch, which only works with real certificates (*.ts.net).
 */
async function call(base:string,pin:string|null,token:string|null,method:string,path:string,body:string|null,timeoutMs:number):Promise<{status:number;text:string}>{
  const url=base.replace(/\/$/,"");
  if(!url.startsWith("https://"))throw new Error("عنوان غير آمن. اربط الهاتف من جديد بمسح رمز QR.");
  if(LayanXNative){
    try{const r=await LayanXNative.request(url,pin,token,method,path,body,timeoutMs);return{status:r.status,text:r.body};}
    catch(e){throw new Error(e instanceof Error?e.message:"تعذر الوصول إلى "+url);}
  }
  if(isIpAddress(url))throw new Error("هذا العنوان يحتاج تطبيق Android (الشهادة المثبتة).");
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const r=await fetch(url+path,{method,signal:controller.signal,headers:{Accept:"application/json",...(token?{Authorization:`Bearer ${token}`}:{}),...(body!==null?{"Content-Type":"application/json"}:{})},...(body!==null?{body}:{})});
    return{status:r.status,text:await r.text()};
  }catch(e){throw new Error(controller.signal.aborted?"Timed out reaching "+url:(e instanceof Error?e.message:"Network error"));}
  finally{clearTimeout(timer);}
}
function parse(t:string):any{try{return t?JSON.parse(t):{}}catch{return{raw:t}}}

export class LayanXApi{
  constructor(private baseUrl:string,private token:string,private pin:string|null=null){}
  /** Exchange the code from the computer (typed, or in the QR code) for a device token that only works with that computer. */
  static async pair(baseUrl:string,code:string,deviceName:string,pin:string|null=null):Promise<PairResult>{
    const r=await call(baseUrl,pin,null,"POST","/v1/pair/complete",JSON.stringify({code,deviceName}),15000);
    const d=parse(r.text);
    if(r.status!==200||!d.deviceToken)throw new Error(d?.message??`Pairing failed (HTTP ${r.status})`);
    return d as PairResult;
  }
  get url(){return this.baseUrl}
  /** Same device token, another address of the same computer (home Wi-Fi, Tailscale, tunnel). */
  withBase(url:string){return new LayanXApi(url,this.token,this.pin)}
  private async request<T>(path:string,init?:{method?:string;body?:string},timeoutMs=20000):Promise<T>{
    const r=await call(this.baseUrl,this.pin,this.token,init?.method??"GET",path,init?.body??null,timeoutMs);
    const d=parse(r.text);if(r.status<200||r.status>=300)throw Object.assign(new Error(d?.message??`HTTP ${r.status}`),{status:r.status});return d as T;
  }
  identity(timeoutMs?:number){return this.request<{ok:true;device:DeviceIdentity}>("/v1/device/identity",undefined,timeoutMs)}
  whoami(){return this.request<{deviceId:string;name:string;installId:string;addresses?:string[]}>("/v1/device/whoami")}
  approvals(projectId:string){return this.request<{ok:true;approvals:Approval[]}>(`/v1/approvals?projectId=${encodeURIComponent(projectId)}`)}
  /** Without the native fingerprint screen (iOS, Expo Go): still bound to the digest, and the PC continues by itself. */
  decide(a:Approval,action:"approve"|"revoke"){return this.request<{ok:true;approval:Approval;continuing:string|null}>(`/v1/approvals/${encodeURIComponent(a.id)}/${action}?projectId=${encodeURIComponent(a.projectId??"default")}`,{method:"POST",body:JSON.stringify({digest:a.digest,resume:action==="approve"})})}
  /** Approvals in every project, running jobs, the auto-scalper and the PC's load, in one call. */
  feed(){return this.request<Feed>("/v1/companion/feed")}
  openJobSite(id:string){return this.request<{ok:boolean;url?:string;needsApproval?:boolean}>(`/v1/supervisor/jobs/${encodeURIComponent(id)}/open`,{method:"POST",body:"{}"},60000)}
  missions(projectId:string){return this.request<{ok:true;missions:MissionSummary[]}>(`/v1/missions?projectId=${encodeURIComponent(projectId)}`)}
  run(goal:string,projectId:string,model="auto"){return this.request<any>("/v1/agent/gateway",{method:"POST",body:JSON.stringify({goal,projectId,maxSteps:10,model})},180000)}
  createJob(goal:string,projectId:string){return this.request<{ok:true;job:Job}>("/v1/supervisor/jobs",{method:"POST",body:JSON.stringify({goal,projectId})})}
  jobs(projectId:string){return this.request<{ok:true;jobs:Job[]}>(`/v1/supervisor/jobs?projectId=${encodeURIComponent(projectId)}`)}
  cancelJob(id:string){return this.request<any>(`/v1/supervisor/jobs/${encodeURIComponent(id)}/cancel`,{method:"POST",body:"{}"})}
  liveStatus(){return this.request<{enabled?:boolean}>("/v1/computer/live/status")}
  liveStart(){return this.request<any>("/v1/computer/live/start",{method:"POST",body:"{}"})}
  liveStop(){return this.request<any>("/v1/computer/live/stop",{method:"POST",body:"{}"})}
  liveFrame(){return this.request<{ok:true;frame?:{mimeType:string;base64:string}}>("/v1/computer/live/frame",undefined,15000)}
  health(){return this.request<{ok:boolean}>("/v1/health")}
  assistant(text:string,projectId:string){return this.request<AssistantReply>("/v1/assistant/turn",{method:"POST",body:JSON.stringify({text,projectId,lang:"auto"})})}
  report(projectId:string){return this.request<{ok:true;report:{text:{ar:string;en:string}}}>(`/v1/assistant/report?projectId=${encodeURIComponent(projectId)}`)}
  session(projectId:string,missionId?:string){const q=new URLSearchParams({projectId});if(missionId)q.set("missionId",missionId);return this.request<Record<string,unknown>>(`/v1/control-center/session?${q}`)}
  events(projectId:string,missionId:string,after?:string){const q=new URLSearchParams({projectId});if(after)q.set("after",after);return this.request<{ok:true;missionId:string;projectId:string;events:MissionEvent[]}>(`/v1/missions/${encodeURIComponent(missionId)}/events?${q}`)}
  cancel(projectId:string,missionId:string){return this.request(`/v1/control-center/missions/${encodeURIComponent(missionId)}/cancel`,{method:"POST",body:JSON.stringify({projectId})})}
  business(){return this.request<any>("/v1/business")}
  analytics(){return this.request<any>("/v1/business/analytics")}
  ads(){return this.request<any>("/v1/ads")}
  oauthConnections(){return this.request<any>("/v1/oauth/connections")}
  oauthConnect(provider:string,accountId="default"){return this.request<any>("/v1/oauth/connect",{method:"POST",body:JSON.stringify({provider,accountId})})}
  oauthDiscover(id:string){return this.request<any>(`/v1/oauth/${encodeURIComponent(id)}/discover`)}
  oauthDiscoverAds(id:string){return this.request<any>(`/v1/oauth/${encodeURIComponent(id)}/discover-ads`)}
  oauthBind(id:string,input:{platform:string;externalId:string;name:string}){return this.request<any>(`/v1/oauth/${encodeURIComponent(id)}/bind`,{method:"POST",body:JSON.stringify(input)})}
}