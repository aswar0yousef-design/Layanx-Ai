export interface SandboxPolicy{maxRuntimeMs:number;maxMemoryMb:number;maxDiskMb:number;networkHosts:string[];allowedPaths:string[];allowChildProcesses:boolean;}
export interface SandboxJob{id:string;skillId:string;command:string;policy:SandboxPolicy;}
export class SandboxPolicyEngine{
 validate(job:SandboxJob){
  if(job.policy.maxRuntimeMs<=0||job.policy.maxMemoryMb<=0||job.policy.maxDiskMb<=0)return{allowed:false,reason:"Invalid resource limits."};
  if(job.policy.allowChildProcesses)return{allowed:false,reason:"Child processes are disabled by default."};
  if(job.policy.networkHosts.includes("*"))return{allowed:false,reason:"Unrestricted network is not allowed."};
  return{allowed:true,reason:"Sandbox policy accepted."};
 }
}
