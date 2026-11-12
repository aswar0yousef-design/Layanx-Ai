import fs from "node:fs";
import path from "node:path";
import {spawn,execFile,type ChildProcess} from "node:child_process";
import {safeChildEnv} from "../platform/safe-env.js";
import {writeFileAtomic} from "../platform/paths.js";
import {listLessons,recordLesson} from "./learning.js";

/**
 * The owner (2026-11-12): "I want it to develop, learn and train itself in its free time." Learning used to run once a day
 * at 03:00, and a day was skipped whenever the machine was off or busy at that minute. Now, whenever LayanX is idle (no job,
 * no request from the owner, and nobody at the keyboard), it practises: one task from the outside-judged trials (building
 * projects, repairing real bugs, servers), alternating with the daily skill learning. Weak practices come first. Lessons a
 * practice run learns are copied into the main memory, so they help real work. The moment the owner comes back, it stops.
 */
export interface Practice{id:string;args:string[]}
export const PRACTICES:Practice[]=[
  ...["roman","wordcount","csv","tip","counter","landing"].map(c=>({id:"build:"+c,args:["scripts/outcome-build-types-acceptance.ts","--runs","1","--case",c]})),
  ...["store","shipments-api","python-csv"].map(c=>({id:"general:"+c,args:["scripts/outcome-general-build-acceptance.ts","--runs","1","--case",c]})),
  ...["qs-sentinel-delimiter","qs-lowercase-dot","qs-filter-sorted"].map(c=>({id:"real-repo:"+c,args:["scripts/outcome-real-repo-repair-acceptance.ts","--runs","1","--case",c]})),
  ...["pagination","missing-profile","lost-await","two-causes"].map(c=>({id:"repair:"+c,args:["scripts/outcome-node-repair-acceptance.ts","--runs","1","--case",c]}))
  ,...["report","price","order","vague"].map(c=>({id:"store:"+c,args:["scripts/outcome-store-task-acceptance.ts","--runs","1","--case",c]}))
  ,...["draft","publish","nodraft","question"].map(c=>({id:"social:"+c,args:["scripts/outcome-social-task-acceptance.ts","--runs","1","--case",c]}))
  ,...["prepare","invoice","close","report"].map(c=>({id:"shipping:"+c,args:["scripts/outcome-shipping-task-acceptance.ts","--runs","1","--case",c]}))
];
export interface PracticeRecord{at:string;practice:string;ok:boolean|null;passed?:number;runs?:number;minutes:number;stopped?:"owner returned"|"error";lessons?:number;report?:string}
export interface TrainerLedger{records:PracticeRecord[]}
export interface IdleTrainerOptions{
  ledgerFile:string;logFile:string;storeEnv?:NodeJS.ProcessEnv;
  busy:()=>boolean;lastOwnerActivity:()=>number;userIdleMs:()=>Promise<number>;
  /** Something outside LayanX is using the model (a model stays loaded about 5 minutes after its last request). */
  gpuInUse?:()=>Promise<boolean>;
  cwd?:string;now?:()=>number;launch?:(args:string[],logFd:number)=>ChildProcess;
  minIdleMs?:number;gapMs?:number;practices?:Practice[];
}

/** Which practice next: never tried first, then the ones failing most, then the least recently practised. */
export function nextPractice(records:PracticeRecord[],practices:Practice[]=PRACTICES):Practice{
  const stats=(id:string)=>{const done=records.filter(r=>r.practice===id&&r.ok!==null);return{tried:done.length,fails:done.filter(r=>!r.ok).length,last:Math.max(0,...records.filter(r=>r.practice===id).map(r=>Date.parse(r.at)))};};
  return[...practices].sort((a,b)=>{const x=stats(a.id),y=stats(b.id);
    if((x.tried===0)!==(y.tried===0))return x.tried===0?-1:1;
    const rx=x.tried?x.fails/x.tried:0,ry=y.tried?y.fails/y.tried:0;
    if(rx!==ry)return ry-rx;
    return x.last-y.last;})[0]!;
}
/** The trial's final summary line: {"report":"...","summary":{"runs":n,"passed":m,...}}. */
export function practiceOutcome(output:string):{passed:number;runs:number;report?:string}|null{
  const at=output.lastIndexOf('"summary"');if(at<0)return null;
  const start=output.lastIndexOf("{",output.lastIndexOf('"report"',at)>=0?output.lastIndexOf('"report"',at):at);
  try{const o=JSON.parse(output.slice(start,output.indexOf("\n}",at)+2));return{passed:Number(o.summary.passed),runs:Number(o.summary.runs),...(o.report?{report:o.report}:{})};}catch{return null;}
}
/** Lessons the practice run learned in its own store go into the main memory (scoped to practice, matched by error and words). */
export function harvestLessons(report:string,env:NodeJS.ProcessEnv=process.env):number{
  let records:Array<{workspace?:string}>=[];
  try{records=(JSON.parse(fs.readFileSync(report,"utf8")) as {records?:Array<{workspace?:string}>}).records??[];}catch{return 0;}
  let added=0;const before=new Set(listLessons(env).map(l=>l.signature??l.text));
  for(const r of records){
    if(!r.workspace)continue;
    const file=path.join(path.dirname(path.dirname(r.workspace)),"store","lessons.json");
    let lessons:Array<{stack:string;kind:"fix"|"pitfall";signature?:string;trigger:string;text:string;tags?:string[]}>=[];
    try{lessons=JSON.parse(fs.readFileSync(file,"utf8"));}catch{continue;}
    for(const l of lessons){
      if(before.has(l.signature??l.text))continue;
      recordLesson({projectId:"practice",stack:l.stack,kind:l.kind,...(l.signature?{signature:l.signature}:{}),trigger:l.trigger,text:l.text,tags:[...(l.tags??[]),"practice"]},env);
      before.add(l.signature??l.text);added++;
    }
  }
  return added;
}
/** Seconds since the last keyboard or mouse input on Windows; elsewhere unknown (treated as present, so nothing starts). */
/** True while Ollama has a model loaded: someone used it in the last few minutes, so practice would compete with them. */
export async function ollamaInUse(base=(process.env.OLLAMA_BASE_URL??"http://127.0.0.1:11434").replace(/\/$/,"")):Promise<boolean>{
  const r=await fetch(base+"/api/ps",{signal:AbortSignal.timeout(3000)});
  return((await r.json()) as {models?:unknown[]}).models?.length?true:false;
}
export function windowsUserIdleMs():Promise<number>{
  if(process.platform!=="win32")return Promise.resolve(0);
  const script="Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class LxIdle{[StructLayout(LayoutKind.Sequential)]struct L{public uint s;public uint t;}[DllImport(\"user32.dll\")]static extern bool GetLastInputInfo(ref L l);public static uint Ms(){L l=new L();l.s=8;GetLastInputInfo(ref l);return (uint)Environment.TickCount-l.t;}}';[LxIdle]::Ms()";
  return new Promise(resolve=>execFile("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{windowsHide:true,timeout:8000},(error,stdout)=>resolve(error?0:Number(String(stdout).trim())||0)));
}

export class IdleTrainer{
  private child?:ChildProcess;private current?:{practice:Practice;started:number;output:string};
  private timer?:NodeJS.Timeout;
  private readonly now:()=>number;
  constructor(private readonly o:IdleTrainerOptions){this.now=o.now??Date.now;}
  ledger():TrainerLedger{try{const d=JSON.parse(fs.readFileSync(this.o.ledgerFile,"utf8"));return{records:Array.isArray(d.records)?d.records:[]};}catch{return{records:[]};}}
  private save(record:PracticeRecord){const l=this.ledger();l.records=[...l.records,record].slice(-300);fs.mkdirSync(path.dirname(this.o.ledgerFile),{recursive:true});writeFileAtomic(this.o.ledgerFile,JSON.stringify(l,null,2));}
  status(){
    const records=this.ledger().records,done=records.filter(r=>r.ok!==null);
    const rate=(list:PracticeRecord[])=>list.length?Math.round(100*list.filter(r=>r.ok).length/list.length):null;
    return{training:this.current?{practice:this.current.practice.id,since:new Date(this.current.started).toISOString()}:null,enabled:(process.env.LAYANX_IDLE_TRAINING??"on")!=="off",
      practised:done.length,successRate:rate(done),recentRate:rate(done.slice(-10)),earlierRate:rate(done.slice(-20,-10)),lessonsLearned:records.reduce((n,r)=>n+(r.lessons??0),0),recent:records.slice(-8).reverse()};
  }
  /** One check: start when idle long enough, stop when the owner is back. */
  async tick():Promise<"started"|"stopped"|"waiting"|"training"|"off">{
    if((process.env.LAYANX_IDLE_TRAINING??"on")==="off")return"off";
    const minIdle=this.o.minIdleMs??15*60_000;
    const ownerAway=this.now()-this.o.lastOwnerActivity();
    if(this.child){
      // Back at the keyboard or sent something: the GPU is theirs again.
      if(ownerAway<minIdle||(await this.o.userIdleMs())<60_000){this.stop("owner returned");return"stopped";}
      return"training";
    }
    if(this.o.busy()||ownerAway<minIdle)return"waiting";
    const last=this.ledger().records.at(-1);
    if(last&&this.now()-Date.parse(last.at)<(this.o.gapMs??10*60_000))return"waiting";
    if((await this.o.userIdleMs())<minIdle)return"waiting";
    if(this.o.gpuInUse&&await this.o.gpuInUse().catch(()=>true))return"waiting";
    this.begin(nextPractice(this.ledger().records,this.o.practices));
    return"started";
  }
  private begin(practice:Practice){
    fs.mkdirSync(path.dirname(this.o.logFile),{recursive:true});
    const logFd=fs.openSync(this.o.logFile,"a");
    fs.writeSync(logFd,`\n=== ${new Date(this.now()).toISOString()} practice ${practice.id}\n`);
    const launch=this.o.launch??((args,fd)=>spawn(process.execPath,[...process.execArgv,...args],{cwd:this.o.cwd??process.cwd(),windowsHide:true,stdio:["ignore","pipe",fd],env:safeChildEnv({allowPrefixes:["OLLAMA_","LAYANX_OLLAMA_","LAYANX_GPU_"]})}));
    const child=launch(practice.args,logFd);
    this.child=child;this.current={practice,started:this.now(),output:""};
    child.stdout?.on("data",d=>{if(this.current){this.current.output=(this.current.output+String(d)).slice(-200_000);}try{fs.writeSync(logFd,String(d));}catch{}});
    child.once("exit",()=>{
      if(this.child!==child)return;
      const cur=this.current!;this.child=undefined;this.current=undefined;try{fs.closeSync(logFd);}catch{}
      const outcome=practiceOutcome(cur.output);
      const lessons=outcome?.report?harvestLessons(outcome.report,this.o.storeEnv):0;
      this.save({at:new Date(cur.started).toISOString(),practice:cur.practice.id,ok:outcome?outcome.passed===outcome.runs&&outcome.runs>0:null,...(outcome?{passed:outcome.passed,runs:outcome.runs,...(outcome.report?{report:outcome.report}:{})}:{stopped:"error" as const}),minutes:Math.round((this.now()-cur.started)/6000)/10,lessons});
    });
  }
  stop(reason:"owner returned"|"error"="owner returned"){
    const child=this.child,cur=this.current;if(!child||!cur)return;
    this.child=undefined;this.current=undefined;
    try{if(process.platform==="win32"&&child.pid)execFile("taskkill",["/PID",String(child.pid),"/T","/F"],{windowsHide:true},()=>undefined);else child.kill();}catch{}
    this.save({at:new Date(cur.started).toISOString(),practice:cur.practice.id,ok:null,minutes:Math.round((this.now()-cur.started)/6000)/10,stopped:reason});
  }
  schedule(everyMs=60_000){this.timer=setInterval(()=>{void this.tick().catch(()=>undefined);},everyMs);this.timer.unref?.();}
  stopSchedule(){if(this.timer)clearInterval(this.timer);this.timer=undefined;this.stop();}
}
