import fs from "node:fs";
import path from "node:path";
import {spawn,type ChildProcess} from "node:child_process";
import {settingRefusal} from "./improvement-cycle.js";
import {safeChildEnv} from "../platform/safe-env.js";

/**
 * Runs one measured improvement experiment in the background: the same outside benchmark before and after, written to the
 * real ledger. It never starts while real work is running, because the benchmark and the work would share one graphics card.
 */
export interface ImprovementRunnerOptions{ledgerFile:string;logFile:string;busy:()=>boolean;cwd?:string;launch?:(args:string[],logFd:number)=>ChildProcess;now?:()=>Date}
export interface ImprovementStart{cases?:string[];runs?:number;setting?:string}

export class ImprovementRunner{
  private child?:ChildProcess;
  private startedAt?:string;
  private lastExit?:{at:string;code:number|null};
  private timer?:NodeJS.Timeout;
  private lastDay?:string;
  private readonly now:()=>Date;
  constructor(private readonly options:ImprovementRunnerOptions){this.now=options.now??(()=>new Date());}
  status(){return{running:Boolean(this.child),startedAt:this.startedAt,lastExit:this.lastExit,schedule:this.timer?this.time:undefined};}
  private time?:string;
  start(input:ImprovementStart={}){
    if(this.child)throw new Error("improvement_already_running");
    if(this.options.busy())throw new Error("improvement_waits_for_running_work");
    const cases=input.cases?.length?input.cases:["csv","wordcount"],runs=input.runs??3;
    if(!cases.every(id=>/^[a-z]+$/.test(id)))throw new Error("improvement_invalid_case");
    if(!Number.isInteger(runs)||runs<1||runs>5)throw new Error("improvement_invalid_runs");
    const args=["scripts/outcome-improve-acceptance.ts","--ledger",this.options.ledgerFile,"--cases",cases.join(","),"--runs",String(runs)];
    if(input.setting){
      const at=input.setting.indexOf("=");
      const refused=at>0?settingRefusal({[input.setting.slice(0,at)]:input.setting.slice(at+1)}):"The setting must be KEY=VALUE.";
      if(refused)throw new Error(refused);
      args.push("--setting",input.setting);
    }
    fs.mkdirSync(path.dirname(this.options.logFile),{recursive:true});
    const logFd=fs.openSync(this.options.logFile,"a");
    const launch=this.options.launch??((list,fd)=>spawn(process.execPath,[...process.execArgv,...list],{cwd:this.options.cwd??process.cwd(),windowsHide:true,stdio:["ignore",fd,fd],env:safeChildEnv({allowPrefixes:["OLLAMA_","LAYANX_OLLAMA_","LAYANX_GPU_"],allow:["LAYANX_REVIEW_MODEL","LAYANX_CODER_MODEL"]})}));
    const child=launch(args,logFd);
    this.child=child;this.startedAt=this.now().toISOString();
    const finished=(code:number|null)=>{if(this.child!==child)return;this.child=undefined;this.lastExit={at:this.now().toISOString(),code};try{fs.closeSync(logFd);}catch{}};
    child.once("error",()=>finished(-1));
    child.once("exit",code=>finished(code));
    return this.status();
  }
  /** A day of learning: new skills first, then one measured experiment on the settings. */
  startDaily(storeDir:string){
    if(this.child)throw new Error("improvement_already_running");
    if(this.options.busy())throw new Error("improvement_waits_for_running_work");
    fs.mkdirSync(path.dirname(this.options.logFile),{recursive:true});
    const logFd=fs.openSync(this.options.logFile,"a");
    const args=["scripts/skills-daily.ts","--store",storeDir,"--ledger",this.options.ledgerFile];
    const launch=this.options.launch??((list,fd)=>spawn(process.execPath,[...process.execArgv,...list],{cwd:this.options.cwd??process.cwd(),windowsHide:true,stdio:["ignore",fd,fd],env:safeChildEnv({allowPrefixes:["OLLAMA_","LAYANX_OLLAMA_","LAYANX_GPU_"],allow:["LAYANX_REVIEW_MODEL","LAYANX_CODER_MODEL","LAYANX_DATA_DIR"]})}));
    const child=launch(args,logFd);
    this.child=child;this.startedAt=this.now().toISOString();
    const finished=(code:number|null)=>{if(this.child!==child)return;this.child=undefined;this.lastExit={at:this.now().toISOString(),code};try{fs.closeSync(logFd);}catch{}};
    child.once("error",()=>finished(-1));
    child.once("exit",code=>finished(code));
    return this.status();
  }
  /** Once a day at HH:MM, only if nothing else is running. A skipped day is simply skipped. */
  schedule(time:string|undefined,everyMs=60_000,run:()=>unknown=()=>this.start()){
    if(!time||!/^\d\d:\d\d$/.test(time))return;
    this.time=time;
    this.timer=setInterval(()=>{
      const now=this.now(),day=now.toDateString(),clock=`${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
      if(clock!==time||this.lastDay===day)return;
      this.lastDay=day;
      try{run();}catch{/* busy today */}
    },everyMs);
    this.timer.unref?.();
  }
  stopSchedule(){if(this.timer)clearInterval(this.timer);this.timer=undefined;}
}
