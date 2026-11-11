import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {safeChildEnv} from "./safe-env.js";

/**
 * LayanX looks at the machine it runs on and decides what it should download and how it should work there.
 * The same build runs on a laptop with no graphics card and on a workstation with 24 GB of video memory: each gets
 * the models it can actually run, settings that suit it, and a fresh plan when the hardware changes.
 * Nothing is downloaded here without the owner's say: the plan lists what is missing, and pulling follows the
 * owner's choice (ask once, automatic, or never). Downloads come only from the local Ollama service.
 */
export interface HardwareProfile{os:string;cpuModel:string;cpuCores:number;ramGB:number;gpuName:string;vramGB:number;diskFreeGB:number;modelsDir:string}
export type HardwareTier="light"|"standard"|"strong"|"workstation";
export type ModelRole="builder"|"reviewer"|"fast"|"vision"|"embedding"|"trial";
/** quality orders models for the same job; measured means it passed LayanX's own acceptance runs, not just a benchmark elsewhere. */
export interface CatalogModel{name:string;sizeGB:number;roles:Array<Exclude<ModelRole,"trial">>;quality:number;measured:boolean;note?:string}
export interface PlannedModel{role:ModelRole;name:string;sizeGB:number;placement:"gpu"|"mixed"|"cpu";installed:boolean;why:string}
export interface SkippedModel{name:string;why:string}
export interface HardwareSettings{parallelModels:number;requestTimeoutSec:number;reviewers:number;taskResearch:"on"|"local";numCtxCap:number}
export interface HardwarePlan{fingerprint:string;tier:HardwareTier;profile:HardwareProfile;models:PlannedModel[];skipped:SkippedModel[];toPull:string[];pullGB:number;settings:HardwareSettings;advice:string[]}

/**
 * Sizes are what Ollama reports for these tags; a model that is installed is judged by its real size instead.
 * The owner can replace the list with LAYANX_MODEL_CATALOG (a JSON file of the same shape).
 */
export const DEFAULT_CATALOG:CatalogModel[]=[
  {name:"gpt-oss:20b",sizeGB:13,roles:["builder","reviewer"],quality:80,measured:true,note:"passed 5/5 task apps and 18/18 build types on this project"},
  {name:"qwen3.8:27b",sizeGB:17,roles:["reviewer","builder"],quality:85,measured:false,note:"too slow unless it fits in video memory"},
  {name:"qwen3-coder:30b",sizeGB:19,roles:["builder","reviewer"],quality:84,measured:false},
  {name:"gemma4:12b",sizeGB:8,roles:["reviewer","vision"],quality:65,measured:false},
  {name:"qwen3.5:9b",sizeGB:6.6,roles:["builder","fast","reviewer"],quality:55,measured:false},
  {name:"qwen3.5:4b",sizeGB:3.3,roles:["fast","builder"],quality:40,measured:false},
  {name:"llama3.2:3b",sizeGB:2,roles:["fast"],quality:25,measured:false},
  {name:"qwen3-embedding:0.6b",sizeGB:0.64,roles:["embedding"],quality:50,measured:false}
];
const DISK_RESERVE_GB=15;
const round=(n:number,step=1)=>Math.round(n/step)*step;

export interface DetectDeps{env?:NodeJS.ProcessEnv;exec?:(file:string,args:string[])=>string;statfs?:(dir:string)=>{bavail:number;bsize:number}}
export function detectHardware(deps:DetectDeps={}):HardwareProfile{
  const env=deps.env??process.env;
  const exec=deps.exec??((file:string,args:string[])=>execFileSync(file,args,{timeout:3000,windowsHide:true,encoding:"utf8",env:safeChildEnv(),stdio:["ignore","pipe","ignore"]}));
  let gpuName="",vramGB=0;
  try{
    // One line per card; the biggest card is the one Ollama will use.
    for(const line of exec("nvidia-smi",["--query-gpu=name,memory.total","--format=csv,noheader,nounits"]).split(/\r?\n/)){
      const [name,mb]=line.split(",").map(part=>part.trim());
      const gb=Number(mb)/1024;
      if(name&&Number.isFinite(gb)&&gb>vramGB){gpuName=name;vramGB=round(gb,0.5);}
    }
  }catch{}
  const override=Number(env.LAYANX_GPU_VRAM_MB);
  if(env.LAYANX_GPU_VRAM_MB?.trim()&&Number.isFinite(override)&&override>=0){vramGB=round(override/1024,0.5);gpuName||="(set by LAYANX_GPU_VRAM_MB)";}
  const modelsDir=env.OLLAMA_MODELS?.trim()||path.join(os.homedir(),".ollama","models");
  let diskFreeGB=0;
  try{
    let dir=modelsDir;while(!fs.existsSync(dir)&&path.dirname(dir)!==dir)dir=path.dirname(dir);
    const stat=(deps.statfs??fs.statfsSync)(dir);
    diskFreeGB=round(stat.bavail*stat.bsize/2**30);
  }catch{}
  const cpus=os.cpus();
  return{os:`${os.platform()} ${os.release()}`,cpuModel:(cpus[0]?.model??"").trim(),cpuCores:cpus.length,ramGB:round(os.totalmem()/2**30),gpuName,vramGB,diskFreeGB,modelsDir};
}

/** Changes only when the hardware does, not when free memory or disk moves. */
export const hardwareFingerprint=(p:Pick<HardwareProfile,"cpuCores"|"ramGB"|"gpuName"|"vramGB">)=>`${p.cpuCores}c|${p.ramGB}gb|${p.gpuName||"no-gpu"}|${p.vramGB}gb`;

export function hardwareTier(p:Pick<HardwareProfile,"ramGB"|"vramGB">):HardwareTier{
  if(p.vramGB>=40||(p.vramGB>=22&&p.ramGB>=96))return"workstation";
  if(p.vramGB>=12||p.ramGB>=64)return"strong";
  if(p.ramGB>=16)return"standard";
  return"light";
}

/** Where a model would run: all on the graphics card is fast, split with system memory works but slowly, too big does not run. */
export function placement(sizeGB:number,p:Pick<HardwareProfile,"ramGB"|"vramGB">):"gpu"|"mixed"|"cpu"|null{
  if(p.vramGB>0&&sizeGB<=p.vramGB*0.9)return"gpu";
  if(sizeGB<=p.ramGB*0.55)return p.vramGB>0?"mixed":"cpu";
  return null;
}

export function loadCatalog(env:NodeJS.ProcessEnv=process.env):CatalogModel[]{
  const file=env.LAYANX_MODEL_CATALOG?.trim();
  if(!file)return DEFAULT_CATALOG;
  try{
    const list=JSON.parse(fs.readFileSync(file,"utf8")) as CatalogModel[];
    if(Array.isArray(list)&&list.every(item=>typeof item?.name==="string"&&typeof item.sizeGB==="number"&&Array.isArray(item.roles)))return list;
  }catch{}
  return DEFAULT_CATALOG;
}

/**
 * Decides, for this machine, which model does which job, what is missing, and how LayanX should pace itself.
 * installed maps model names to their real size in GB.
 */
export function planForHardware(profile:HardwareProfile,installed:Record<string,number>={},catalog:CatalogModel[]=DEFAULT_CATALOG):HardwarePlan{
  const tier=hardwareTier(profile),models:PlannedModel[]=[],skipped:SkippedModel[]=[],advice:string[]=[];
  const sizeOf=(m:CatalogModel)=>installed[m.name]??m.sizeGB;
  const fits=(m:CatalogModel)=>placement(sizeOf(m),profile);
  const byQuality=(role:Exclude<ModelRole,"trial">)=>catalog.filter(m=>m.roles.includes(role)).sort((a,b)=>b.quality-a.quality);
  const add=(role:ModelRole,m:CatalogModel,why:string)=>models.push({role,name:m.name,sizeGB:sizeOf(m),placement:fits(m)!,installed:m.name in installed,why});
  for(const m of catalog)if(!fits(m))skipped.push({name:m.name,why:`needs about ${sizeOf(m)} GB; this machine has ${profile.ramGB} GB memory${profile.vramGB?` and ${profile.vramGB} GB video memory`:" and no usable graphics card"}`});

  // The builder is the best model that was measured on LayanX's own work; a stronger unmeasured one is only a trial.
  const builders=byQuality("builder").filter(fits);
  const builder=builders.find(m=>m.measured)??builders[0];
  if(builder)add("builder",builder,builder.measured?`measured best for building here (${builder.note??"acceptance runs"})`:"the strongest model this machine can hold; not yet measured on LayanX's work");
  else advice.push("No local model is strong enough to build projects on this machine. A cloud model would be needed, which only the owner can approve.");
  for(const trial of builders.filter(m=>m!==builder&&m.quality>(builder?.quality??0)&&fits(m)==="gpu").slice(0,1))add("trial",trial,"stronger on paper; it is measured against the current builder and used only if it does at least as well");

  // A reviewer that spills into system memory timed out on every review here, so a separate reviewer must fit on the card.
  const reviewers=byQuality("reviewer").filter(m=>m!==builder&&fits(m)==="gpu");
  if(reviewers[0])add("reviewer",reviewers[0],"a second, different model that fits in video memory, so it answers in time");
  else if(builder)advice.push(`No second model fits in video memory, so ${builder.name} reviews its own work afresh. A graphics card with more memory would allow an independent reviewer.`);

  // Quick replies want a model on the card; one already installed beats a download of something similar.
  const fast=byQuality("fast").filter(m=>fits(m)&&m!==builder).sort((a,b)=>(fits(a)==="gpu"?0:1)-(fits(b)==="gpu"?0:1)||(a.name in installed?0:1)-(b.name in installed?0:1)||b.quality-a.quality)[0];
  if(fast&&fast!==builder)add("fast",fast,"quick replies and voice, small enough to answer fast");
  const vision=byQuality("vision").find(fits);
  if(vision&&!models.some(m=>m.name===vision.name))add("vision",vision,"reads screenshots and images");
  const embed=byQuality("embedding").find(fits);
  if(embed)add("embedding",embed,"search over memory and documents");

  // Downloads go in order of importance and stop before the disk is full.
  const order:ModelRole[]=["builder","embedding","fast","reviewer","vision","trial"];
  let room=profile.diskFreeGB-DISK_RESERVE_GB,pullGB=0;const toPull:string[]=[];
  for(const role of order)for(const m of models.filter(x=>x.role===role&&!x.installed)){
    if(toPull.includes(m.name))continue;
    if(m.sizeGB>room){skipped.push({name:m.name,why:`not enough free disk: needs ${m.sizeGB} GB and keeps ${DISK_RESERVE_GB} GB spare`});continue;}
    toPull.push(m.name);room-=m.sizeGB;pullGB+=m.sizeGB;
  }
  const kept=new Set([...toPull,...models.filter(m=>m.installed).map(m=>m.name)]);
  const planned=models.filter(m=>kept.has(m.name));

  const b=planned.find(m=>m.role==="builder"),r=planned.find(m=>m.role==="reviewer");
  const settings:HardwareSettings={
    parallelModels:b&&r&&b.placement==="gpu"&&b.sizeGB+r.sizeGB<=profile.vramGB*0.9?2:1,
    // Measured: 180 s suits a model split between card and memory. Shorter is untested, so only CPU-only machines change it (longer).
    requestTimeoutSec:b?.placement==="cpu"?300:180,
    reviewers:Math.min(3,1+new Set(planned.filter(m=>(m.role==="reviewer"||m.role==="trial")&&m.name!==b?.name).map(m=>m.name)).size),
    taskResearch:"on",
    numCtxCap:profile.ramGB>=32?16384:profile.ramGB>=12?8192:4096
  };
  if(tier==="light")advice.push("This is a light machine: projects take longer and very large ones may not finish locally.");
  if(b?.placement==="mixed")advice.push(`${b.name} is split between the graphics card and system memory, so each step takes minutes. A card with at least ${Math.ceil(b.sizeGB/0.9)} GB of video memory would make it several times faster.`);
  if(profile.diskFreeGB&&profile.diskFreeGB<DISK_RESERVE_GB+5)advice.push(`Only ${profile.diskFreeGB} GB of disk is free.`);
  return{fingerprint:hardwareFingerprint(profile),tier,profile,models:planned,skipped,toPull,pullGB:round(pullGB,0.1),settings,advice};
}

/** What LayanX remembers about the machine: the last fingerprint, the plan, and which downloads the owner allowed. */
export interface HardwareState{fingerprint:string;checkedAt:string;plan:HardwarePlan;approvedPulls:string[];measuredAt?:string}
export const hardwareStateFile=(store:string)=>path.join(store,"hardware.json");
export function readHardwareState(store:string):HardwareState|null{
  try{return JSON.parse(fs.readFileSync(hardwareStateFile(store),"utf8")) as HardwareState;}catch{return null;}
}
/**
 * Checks the machine and compares it with last time. A changed machine means a new plan and that the models must be
 * measured again before the new choices are trusted. Approvals carry over only for models that are still in the plan.
 */
export function checkHardware(store:string,profile:HardwareProfile,installed:Record<string,number>,catalog?:CatalogModel[],now=new Date()):{state:HardwareState;changed:boolean;previous?:string}{
  const before=readHardwareState(store),plan=planForHardware(profile,installed,catalog);
  const changed=!before||before.fingerprint!==plan.fingerprint;
  const state:HardwareState={fingerprint:plan.fingerprint,checkedAt:now.toISOString(),plan,approvedPulls:(before?.approvedPulls??[]).filter(name=>plan.toPull.includes(name)),...(!changed&&before?.measuredAt?{measuredAt:before.measuredAt}:{})};
  fs.mkdirSync(store,{recursive:true});
  fs.writeFileSync(hardwareStateFile(store),JSON.stringify(state,null,2));
  return{state,changed,...(before&&changed?{previous:before.fingerprint}:{})};
}
export function approvePulls(store:string,names:string[]):HardwareState{
  const state=readHardwareState(store);
  if(!state)throw new Error("hardware_not_checked");
  const unknown=names.filter(name=>!state.plan.toPull.includes(name));
  if(unknown.length)throw new Error("not_in_plan: "+unknown.join(", "));
  state.approvedPulls=[...new Set([...state.approvedPulls,...names])];
  fs.writeFileSync(hardwareStateFile(store),JSON.stringify(state,null,2));
  return state;
}

/** ask (default): only what the owner approved; auto: everything in the plan; off: nothing. */
export type PullMode="ask"|"auto"|"off";
export const pullMode=(env:NodeJS.ProcessEnv=process.env):PullMode=>{const v=env.LAYANX_MODEL_PULL?.trim().toLowerCase();return v==="auto"||v==="off"?v:"ask";};
export type PullFn=(name:string)=>Promise<void>;
export function ollamaPull(baseUrl="http://127.0.0.1:11434",timeoutMs=3*60*60_000):PullFn{
  return async name=>{
    const res=await fetch(baseUrl.replace(/\/+$/,"")+"/api/pull",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({model:name,stream:false}),signal:AbortSignal.timeout(timeoutMs)});
    const text=await res.text();
    if(!res.ok)throw new Error(`pull ${name}: HTTP ${res.status} ${text.slice(0,200)}`);
    const status=(()=>{try{return(JSON.parse(text) as {status?:string;error?:string});}catch{return{};}})();
    if(status.error)throw new Error(`pull ${name}: ${status.error}`);
  };
}
export async function pullPlanned(state:HardwareState,mode:PullMode,pull:PullFn):Promise<{pulled:string[];waiting:string[];failed:Array<{name:string;error:string}>}>{
  const allowed=mode==="off"?[]:mode==="auto"?state.plan.toPull:state.plan.toPull.filter(name=>state.approvedPulls.includes(name));
  const pulled:string[]=[],failed:Array<{name:string;error:string}>=[];
  for(const name of allowed){
    try{await pull(name);pulled.push(name);}catch(error){failed.push({name,error:(error as Error).message.slice(0,300)});}
  }
  return{pulled,failed,waiting:state.plan.toPull.filter(name=>!allowed.includes(name))};
}

export async function installedModels(baseUrl="http://127.0.0.1:11434"):Promise<Record<string,number>>{
  try{
    const res=await fetch(baseUrl.replace(/\/+$/,"")+"/api/tags",{signal:AbortSignal.timeout(4000)});
    const data=await res.json() as {models?:Array<{name?:string;size?:number}>};
    return Object.fromEntries((data.models??[]).filter(m=>m.name).map(m=>[m.name!,Math.round((m.size??0)/2**30*10)/10]));
  }catch{return{};}
}
/**
 * What runs at every start: look at the machine, keep the plan current, apply the settings the owner has not set, and
 * download only what the owner's choice allows, in the background so the start is not held up.
 */
export async function startupHardwareCheck(input:{store:string;env:NodeJS.ProcessEnv;log:(level:"info"|"warn",message:string)=>void;pull?:PullFn}):Promise<{state:HardwareState;changed:boolean}>{
  const base=input.env.OLLAMA_BASE_URL?.trim()||"http://127.0.0.1:11434";
  const {state,changed,previous}=checkHardware(input.store,detectHardware({env:input.env}),await installedModels(base),loadCatalog(input.env));
  const plan=state.plan;
  input.log("info",`machine class ${plan.tier}: builder ${plan.models.find(m=>m.role==="builder")?.name??"none"}, reviewer ${plan.models.find(m=>m.role==="reviewer")?.name??"the builder afresh"}`);
  if(changed&&previous)input.log("warn",`the hardware changed (${previous} -> ${plan.fingerprint}); the model plan was rebuilt and should be measured again before it is trusted`);
  // Never shorter than the measured default; slower machines get longer.
  if(!input.env.OLLAMA_TIMEOUT_MS?.trim()&&plan.settings.requestTimeoutSec>180)input.env.OLLAMA_TIMEOUT_MS=String(plan.settings.requestTimeoutSec*1000);
  if(!input.env.LAYANX_REVIEW_MODEL?.trim()){const reviewer=plan.models.find(m=>m.role==="reviewer"&&m.installed);if(reviewer)input.env.LAYANX_REVIEW_MODEL=reviewer.name;}
  for(const note of plan.advice)input.log("info","hardware: "+note);
  if(plan.toPull.length){
    const mode=pullMode(input.env);
    input.log("info",`suggested models to download: ${plan.toPull.join(", ")} (about ${plan.pullGB} GB); download mode: ${mode}`);
    void pullPlanned(state,mode,input.pull??ollamaPull(base)).then(result=>{
      if(result.pulled.length)input.log("info","downloaded: "+result.pulled.join(", "));
      for(const failure of result.failed)input.log("warn",`could not download ${failure.name}: ${failure.error}`);
    });
  }
  return{state,changed};
}

/** Plain text for the doctor and the setup page. */
export function describePlan(plan:HardwarePlan):string{
  const p=plan.profile,lines=[
    `Machine: ${p.cpuCores} cores, ${p.ramGB} GB memory, ${p.gpuName?`${p.gpuName} ${p.vramGB} GB`:"no NVIDIA graphics card"}, ${p.diskFreeGB} GB free disk. Class: ${plan.tier}.`,
    ...plan.models.map(m=>`  ${m.role.padEnd(9)} ${m.name} (${m.sizeGB} GB, ${m.placement}${m.installed?"":", not installed"}): ${m.why}`),
    ...(plan.toPull.length?[`To download: ${plan.toPull.join(", ")} (about ${plan.pullGB} GB).`]:["Nothing to download."]),
    ...plan.skipped.map(s=>`  skipped ${s.name}: ${s.why}`),
    `Settings: ${plan.settings.parallelModels} model(s) at once, ${plan.settings.requestTimeoutSec} s per request, up to ${plan.settings.reviewers} reviewer(s), context up to ${plan.settings.numCtxCap} tokens.`,
    ...plan.advice.map(a=>"Note: "+a)
  ];
  return lines.join("\n");
}
