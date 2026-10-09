import os from "node:os";
import {execFile} from "node:child_process";
import {safeChildEnv} from "./safe-env.js";

/**
 * How busy this PC is, for the dashboard: CPU, RAM, the NVIDIA GPU (through nvidia-smi, which ships with
 * the driver) and the Ollama models loaded right now (GET /api/ps) with how much of each sits on the GPU.
 */
export interface GpuLoad{name:string;percent:number;memoryUsedMB:number;memoryTotalMB:number}
export interface LoadedModel{name:string;sizeBytes:number;vramBytes:number;expiresAt?:string}
export interface SystemLoad{at:string;cpu:{percent:number;cores:number;model:string};memory:{totalBytes:number;usedBytes:number;percent:number};gpu:GpuLoad|null;models:LoadedModel[];ollama:boolean}

type CpuSample={idle:number;total:number;at:number};
export function cpuSample(cpus:os.CpuInfo[]=os.cpus()):CpuSample{
  let idle=0,total=0;
  for(const c of cpus){const t=c.times;idle+=t.idle;total+=t.user+t.nice+t.sys+t.irq+t.idle;}
  return{idle,total,at:Date.now()};
}
/** Busy share of CPU time between two samples, 0-100. */
export function cpuPercentBetween(a:CpuSample,b:CpuSample):number{
  const total=b.total-a.total,idle=b.idle-a.idle;
  if(total<=0)return 0;
  return Math.max(0,Math.min(100,Math.round((1-idle/total)*100)));
}
/** One line of `nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits`. */
export function parseNvidiaSmi(text:string):GpuLoad|null{
  const line=text.split(/\r?\n/).map(l=>l.trim()).find(Boolean);
  if(!line)return null;
  const parts=line.split(",").map(p=>p.trim());
  if(parts.length<4)return null;
  const [name,util,used,total]=parts as [string,string,string,string];
  const n=(v:string)=>Number.parseFloat(v);
  if(![util,used,total].every(v=>Number.isFinite(n(v))))return null;
  return{name,percent:Math.round(n(util)),memoryUsedMB:Math.round(n(used)),memoryTotalMB:Math.round(n(total))};
}

let lastCpu:CpuSample|null=null;
let gpuCache:{at:number;value:GpuLoad|null;failed:boolean}|null=null;

function queryGpu():Promise<GpuLoad|null>{
  // No NVIDIA card (or no driver): asked again only once a minute.
  if(gpuCache&&Date.now()-gpuCache.at<(gpuCache.failed?60_000:2000))return Promise.resolve(gpuCache.value);
  return new Promise(resolve=>execFile("nvidia-smi",["--query-gpu=name,utilization.gpu,memory.used,memory.total","--format=csv,noheader,nounits"],
    {timeout:2500,windowsHide:true,encoding:"utf8",env:safeChildEnv()},(err,stdout)=>{
      const value=err?null:parseNvidiaSmi(String(stdout));
      gpuCache={at:Date.now(),value,failed:!value};resolve(value);
    }));
}
async function loadedModels(env:NodeJS.ProcessEnv):Promise<{ok:boolean;models:LoadedModel[]}>{
  const base=(env.OLLAMA_BASE_URL?.trim()||"http://127.0.0.1:11434").replace(/\/+$/,"");
  try{
    const r=await fetch(base+"/api/ps",{signal:AbortSignal.timeout(1200)});
    if(!r.ok)return{ok:false,models:[]};
    const d=await r.json() as {models?:Array<{name?:string;model?:string;size?:number;size_vram?:number;expires_at?:string}>};
    return{ok:true,models:(d.models??[]).map(m=>({name:String(m.name??m.model??"?"),sizeBytes:Number(m.size)||0,vramBytes:Number(m.size_vram)||0,...(m.expires_at?{expiresAt:m.expires_at}:{})}))};
  }catch{return{ok:false,models:[]};}
}

export async function systemLoad(env:NodeJS.ProcessEnv=process.env):Promise<SystemLoad>{
  // CPU busy share since the previous call (the dashboard asks every few seconds); a short sample the first time.
  let before=lastCpu;
  if(!before||Date.now()-before.at<300||Date.now()-before.at>60_000){before=cpuSample();await new Promise(r=>setTimeout(r,300));}
  const nowSample=cpuSample();lastCpu=nowSample;
  const cpus=os.cpus();
  const total=os.totalmem(),free=os.freemem();
  const [gpu,ollama]=await Promise.all([queryGpu(),loadedModels(env)]);
  return{at:new Date().toISOString(),
    cpu:{percent:cpuPercentBetween(before,nowSample),cores:cpus.length,model:(cpus[0]?.model??"").replace(/\s+/g," ").trim()},
    memory:{totalBytes:total,usedBytes:total-free,percent:total?Math.round((total-free)/total*100):0},
    gpu,models:ollama.models,ollama:ollama.ok};
}
