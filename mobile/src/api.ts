export type MissionEvent={id:string;missionId:string;projectId:string;timestamp:string;type:string;actor:string;tool?:string;action?:string;stepIndex?:number;message?:string};
export class LayanXApi{
  constructor(private baseUrl:string,private token:string){}
  private async request<T>(path:string,init?:RequestInit):Promise<T>{
    const r=await fetch(this.baseUrl.replace(/\/$/,"")+path,{...init,headers:{Accept:"application/json",Authorization:`Bearer ${this.token}`,"Content-Type":"application/json",...(init?.headers??{})}});
    const t=await r.text();let d:any={};try{d=t?JSON.parse(t):{}}catch{d={raw:t}};if(!r.ok)throw new Error(d?.message??`HTTP ${r.status}`);return d as T;
  }
  session(projectId:string,missionId?:string){const q=new URLSearchParams({projectId});if(missionId)q.set("missionId",missionId);return this.request<Record<string,unknown>>(`/v1/control-center/session?${q}`)}
  events(projectId:string,missionId:string,after?:string){const q=new URLSearchParams({projectId});if(after)q.set("after",after);return this.request<{ok:true;missionId:string;projectId:string;events:MissionEvent[]}>(`/v1/missions/${encodeURIComponent(missionId)}/events?${q}`)}
  cancel(projectId:string,missionId:string){return this.request(`/v1/control-center/missions/${encodeURIComponent(missionId)}/cancel`,{method:"POST",body:JSON.stringify({projectId})})}
  business(){return this.request<any>("/v1/business")}
  analytics(){return this.request<any>("/v1/business/analytics")}
  ads(){return this.request<any>("/v1/ads")}
  oauthConnections(){return this.request<any>("/v1/oauth/connections")}
  oauthConnect(provider:string,accountId="default"){return this.request<any>("/v1/oauth/connect",{method:"POST",body:JSON.stringify({provider,accountId})})}
  oauthDiscover(id:string){return this.request<any>(`/v1/oauth/${encodeURIComponent(id)}/discover`)}
  oauthBind(id:string,input:{platform:string;externalId:string;name:string}){return this.request<any>(`/v1/oauth/${encodeURIComponent(id)}/bind`,{method:"POST",body:JSON.stringify(input)})}
}