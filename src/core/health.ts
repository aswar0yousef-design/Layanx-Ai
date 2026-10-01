export type HealthStatus="healthy"|"degraded"|"critical";
export interface HealthCheck{name:string;status:HealthStatus;message:string;timestamp:string;}
export class SystemHealth{
 check(input:{providers:number;healthyProviders:number;agents:number;missionFailures:number}):HealthCheck[]{
  const now=new Date().toISOString();
  const providerStatus=input.providers===0?"critical":input.healthyProviders===0?"critical":input.healthyProviders<input.providers?"degraded":"healthy";
  return[
   {name:"providers",status:providerStatus,message:`${input.healthyProviders}/${input.providers} providers healthy.`,timestamp:now},
   {name:"agents",status:input.agents>0?"healthy":"critical",message:`${input.agents} agents registered.`,timestamp:now},
   {name:"missions",status:input.missionFailures>0?"degraded":"healthy",message:`${input.missionFailures} mission failures observed.`,timestamp:now}
  ];
 }
}
