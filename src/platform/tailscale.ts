import {execFile} from "node:child_process";
import {existsSync} from "node:fs";
import {safeChildEnv} from "./safe-env.js";

/**
 * Tailscale lets the phone reach this PC from anywhere over an encrypted private
 * network, without opening any port to the internet. `tailscale serve` adds a
 * trusted HTTPS address (https://<pc>.<tailnet>.ts.net) that proxies to LayanX.
 */
export interface TailscaleInfo{installed:boolean;running:boolean;dnsName?:string;ips:string[];error?:string}

function cli():string|null{
  const candidates=process.platform==="win32"
    ?[`${process.env.ProgramFiles??"C:\\Program Files"}\\Tailscale\\tailscale.exe`,"tailscale.exe"]
    :["/usr/bin/tailscale","/usr/local/bin/tailscale","/Applications/Tailscale.app/Contents/MacOS/Tailscale","tailscale"];
  for(const c of candidates)if(!c.includes("\\")&&!c.includes("/")||existsSync(c))return c;
  return null;
}

function run(args:string[],timeoutMs=8000):Promise<{code:number|null;stdout:string;stderr:string}>{
  const exe=cli();
  if(!exe)return Promise.resolve({code:null,stdout:"",stderr:"tailscale not found"});
  return new Promise(resolve=>{
    execFile(exe,args,{timeout:timeoutMs,windowsHide:true,env:safeChildEnv(),maxBuffer:2*1024*1024},(error,stdout,stderr)=>{
      const code=(error as NodeJS.ErrnoException|null)?.code;
      if(code==="ENOENT"){resolve({code:null,stdout:"",stderr:"tailscale not found"});return;}
      resolve({code:error?(typeof code==="number"?code:1):0,stdout:String(stdout),stderr:String(stderr)||(error?String(error.message):"")});
    });
  });
}

export async function tailscaleInfo():Promise<TailscaleInfo>{
  const r=await run(["status","--json"]);
  if(r.code===null)return{installed:false,running:false,ips:[]};
  try{
    const data=JSON.parse(r.stdout) as {BackendState?:string;Self?:{DNSName?:string;TailscaleIPs?:string[]}};
    const dns=data.Self?.DNSName?.replace(/\.$/,"");
    return{installed:true,running:data.BackendState==="Running",...(dns?{dnsName:dns}:{}),ips:data.Self?.TailscaleIPs??[]};
  }catch{return{installed:true,running:false,ips:[],error:(r.stderr||r.stdout).slice(0,300)};}
}

/** Publishes LayanX on https://<pc>.<tailnet>.ts.net inside the tailnet only (not the public internet). */
export async function tailscaleServe(port:number):Promise<{ok:boolean;output:string}>{
  const r=await run(["serve","--bg",String(port)],20000);
  return{ok:r.code===0,output:(r.stdout+"\n"+r.stderr).trim().slice(0,1500)};
}

/** 100.64.0.0/10 and fd7a:115c:a1e0::/48 are Tailscale's address ranges. */
export function isTailscaleAddress(address:string|undefined):boolean{
  if(!address)return false;
  const v4=address.replace(/^::ffff:/,"");
  const m=/^100\.(\d{1,3})\./.exec(v4);
  if(m)return Number(m[1])>=64&&Number(m[1])<=127;
  return address.toLowerCase().startsWith("fd7a:115c:a1e0:");
}
