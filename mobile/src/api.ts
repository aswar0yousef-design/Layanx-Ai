export type DeviceIdentity={deviceId:string;name:string;platform:string;apiVersion:string};
export type MissionEvent={id:string;missionId:string;projectId:string;timestamp:string;type:string;actor:string;tool?:string;action?:string;stepIndex?:number;message?:string};
export type Approval={id:string;missionId:string;tool?:string;action?:string;permission?:string;reason?:string;approved?:boolean};
export type MissionSummary={id:string;goal:string;status:string;createdAt?:string};
export type Job={id:string;goal:string;status:string;milestones:Array<{title:string;status:string}>;current:number;result?:string;waiting?:{approvalId:string}};
export type PairResult={ok:true;deviceId:string;deviceToken:string;installId:string};
export type AssistantReply={ok:boolean;lang:"ar"|"en";intent:string;reply:string;missionId?:string;task?:{completed:boolean;paused:boolean;reason?:string}};
export class LayanXApi{
  constructor(private baseUrl:string,private token:string){}
  /** Exchange the 8-character code shown on the computer for a device token that only works with that computer. */
  static async pair(baseUrl:string,code:string,deviceName:string):Promise<PairResult>{
    const r=await fetch(baseUrl.replace(/\/$/,"")+"/v1/pair/complete",{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify({code,deviceName})});
    const t=await r.text();let d:any={};try{d=t?JSON.parse(t):{}}catch{d={raw:t}};
    if(!r.ok||!d.deviceToken)throw new Error(d?.message??`Pairing failed (HTTP ${r.status})`);
    return d as PairResult;
  }
  get url(){return this.baseUrl}
  /** Same device token, another address of the same computer (home Wi-Fi, Tailscale, tunnel). */
  withBase(url:string){return new LayanXApi(url,this.token)}
  private async request<T>(path:string,init?:RequestInit,timeoutMs=20000):Promise<T>{
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
    let r:Response;
    try{r=await fetch(this.baseUrl.replace(/\/$/,"")+path,{...init,signal:controller.signal,headers:{Accept:"application/json",Authorization:`Bearer ${this.token}`,"Content-Type":"application/json",...(init?.headers??{})}});}
    catch(e){throw new Error(controller.signal.aborted?"Timed out reaching "+this.baseUrl:(e instanceof Error?e.message:"Network error"));}
    finally{clearTimeout(timer);}
    const t=await r.text();let d:any={};try{d=t?JSON.parse(t):{}}catch{d={raw:t}};if(!r.ok)throw new Error(d?.message??`HTTP ${r.status}`);return d as T;
  }
  identity(timeoutMs?:number){return this.request<{ok:true;device:DeviceIdentity}>("/v1/device/identity",undefined,timeoutMs)}
  whoami(){return this.request<{deviceId:string;name:string;installId:string;addresses?:string[]}>("/v1/device/whoami")}
  approvals(projectId:string){return this.request<{ok:true;approvals:Approval[]}>(`/v1/approvals?projectId=${encodeURIComponent(projectId)}`)}
  decide(id:string,action:"approve"|"revoke",projectId:string){return this.request<{ok:true;approval:Approval}>(`/v1/approvals/${encodeURIComponent(id)}/${action}?projectId=${encodeURIComponent(projectId)}`,{method:"POST",body:"{}"})}
  missions(projectId:string){return this.request<{ok:true;missions:MissionSummary[]}>(`/v1/missions?projectId=${encodeURIComponent(projectId)}`)}
  mission(id:string,projectId:string){return this.request<{ok:true;mission:{id:string;tools?:Array<{tool:string;action:string}>}}>(`/v1/missions/${encodeURIComponent(id)}?projectId=${encodeURIComponent(projectId)}`)}
  resume(id:string,projectId:string,approvalIds:Record<number,string>){return this.request<any>(`/v1/missions/${encodeURIComponent(id)}/agent-loop`,{method:"POST",body:JSON.stringify({projectId,maxSteps:10,agentId:"core",approvalIds})},120000)}
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