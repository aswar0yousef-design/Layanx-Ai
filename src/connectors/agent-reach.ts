import {spawn} from "node:child_process";
import type {ToolRequest} from "../core/types.js";

type RunnerResult={stdout:string;stderr:string;code:number|null};
type Runner=(command:string,args:string[],timeoutMs:number)=>Promise<RunnerResult>;

const MAX_INPUT=4000;
const MAX_OUTPUT=200_000;
const DEFAULT_TIMEOUT=30_000;
const CHANNELS=new Set([
  "web","exa_search","github","youtube","rss","twitter","reddit","facebook","instagram",
  "xiaohongshu","bilibili","v2ex","linkedin","xueqiu","xiaoyuzhou"
]);
const OPERATIONS=new Set(["read","search","user_posts","hot","detail","transcribe"]);

function runProcess(command:string,args:string[],timeoutMs=DEFAULT_TIMEOUT):Promise<RunnerResult>{
  return new Promise(resolve=>{
    const child=spawn(command,args,{shell:false,windowsHide:true,timeout:timeoutMs,env:{
      ...process.env,
      PYTHONIOENCODING:"utf-8",
      PYTHONUTF8:"1"
    }});
    let stdout="",stderr="";
    child.stdout.on("data",chunk=>{
      if(stdout.length<MAX_OUTPUT)stdout+=String(chunk).slice(0,MAX_OUTPUT-stdout.length);
    });
    child.stderr.on("data",chunk=>{
      if(stderr.length<MAX_OUTPUT)stderr+=String(chunk).slice(0,MAX_OUTPUT-stderr.length);
    });
    child.on("error",error=>resolve({stdout,stderr:String(error),code:null}));
    child.on("close",code=>resolve({stdout,stderr,code}));
  });
}

function input(request:ToolRequest):Record<string,unknown>{
  return request.payload&&typeof request.payload==="object"&&!Array.isArray(request.payload)
    ?request.payload as Record<string,unknown>:{};
}
function text(value:unknown,name:string,max=MAX_INPUT):string{
  if(typeof value!=="string"||value.trim().length===0||value.length>max)
    throw new Error(name+" must be a non-empty string of at most "+max+" characters.");
  return value.trim();
}
function jsonOutput(stdout:string):unknown{
  const raw=stdout.trim();
  if(!raw)return null;
  try{return JSON.parse(raw);}catch{return{raw};}
}
function command():string{
  return process.env.LAYANX_AGENT_REACH_COMMAND?.trim()||"agent-reach";
}

export function createAgentReachAdapter(options:{runner?:Runner;command?:string}={}){
  const execute=options.runner??runProcess;
  const executable=options.command??command();
  return {
    async execute(request:ToolRequest):Promise<unknown>{
      const p=input(request);
      if(request.action==="agent reach status"){
        const result=await execute(executable,["doctor","--json"],DEFAULT_TIMEOUT);
        return {installed:result.code!==null&&result.code===0,json:jsonOutput(result.stdout),stderr:result.stderr.trim()||undefined,exitCode:result.code};
      }
      if(request.action==="agent reach channels"){
        const result=await execute(executable,["channels","--json"],DEFAULT_TIMEOUT);
        if(result.code!==0)throw new Error(result.stderr.trim()||"Agent Reach channels command failed.");
        return jsonOutput(result.stdout);
      }
      if(request.action==="agent reach update check"){
        const result=await execute(executable,["check-update","--json"],DEFAULT_TIMEOUT);
        if(result.code!==0)throw new Error(result.stderr.trim()||"Agent Reach update check failed.");
        return jsonOutput(result.stdout);
      }
      if(request.action==="agent reach setup"){
        const system=Boolean(p.system);
        const args=["install","--env","auto",system?"--system":"--safe"];
        if(p.dryRun===true&&!system)args.push("--dry-run");
        if(typeof p.channels==="string"&&p.channels.trim()){
          const requested=p.channels.split(",").map(v=>v.trim()).filter(Boolean);
          const invalid=requested.filter(v=>v!=="all"&&!CHANNELS.has(v));
          if(invalid.length)throw new Error("Unsupported Agent Reach channel(s): "+invalid.join(", "));
          args.push("--channels",requested.join(","));
        }
        const result=await execute(executable,args,120_000);
        if(result.code!==0)throw new Error(result.stderr.trim()||"Agent Reach setup failed.");
        return {system,stdout:result.stdout.trim(),stderr:result.stderr.trim()||undefined};
      }
      if(request.action==="agent reach collect"){
        const channel=text(p.channel,"channel",64).toLowerCase();
        const operation=text(p.operation,"operation",64).toLowerCase();
        const value=text(p.input,"input");
        const limit=typeof p.limit==="number"&&Number.isInteger(p.limit)?Math.min(Math.max(p.limit,1),20):5;
        if(!CHANNELS.has(channel))throw new Error("Unsupported Agent Reach channel.");
        if(!OPERATIONS.has(operation))throw new Error("Unsupported Agent Reach operation.");
        const args=["collect","--channel",channel,"--operation",operation,"--input",value,"--limit",String(limit),"--json"];
        const result=await execute(executable,args,60_000);
        if(result.code!==0)throw new Error(result.stderr.trim()||"Agent Reach collection failed.");
        return jsonOutput(result.stdout);
      }
      throw new Error("Unsupported Agent Reach action.");
    }
  };
}

export const agentReachSupportedChannels=[...CHANNELS];
