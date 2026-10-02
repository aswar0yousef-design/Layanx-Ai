import {spawn} from "node:child_process";
import {access,realpath} from "node:fs/promises";
import {constants} from "node:fs";
import {isAbsolute,relative,resolve,sep} from "node:path";

export interface TestRunResult{
  ok:boolean;
  tests:string[];
  passed:string[];
  failed:string[];
  timedOut:boolean;
  exitCode:number|null;
  signal:string|null;
  stdout:string;
  stderr:string;
  durationMs:number;
  error?:string;
}

export interface AutomaticTestRunnerOptions{
  root:string;
  timeoutMs?:number;
  maxOutputChars?:number;
  maxTests?:number;
}

export class AutomaticTestRunner{
  private readonly root:string;
  private readonly timeoutMs:number;
  private readonly maxOutputChars:number;
  private readonly maxTests:number;

  constructor(options:AutomaticTestRunnerOptions){
    this.root=resolve(options.root);
    this.timeoutMs=Math.min(Math.max(Math.floor(options.timeoutMs??120000),1000),600000);
    this.maxOutputChars=Math.min(Math.max(Math.floor(options.maxOutputChars??65536),4096),1048576);
    this.maxTests=Math.min(Math.max(Math.floor(options.maxTests??20),1),50);
  }

  async run(selectedTests:string[]):Promise<TestRunResult>{
    const tests=[...new Set(selectedTests.map(value=>value.trim()).filter(Boolean))].slice(0,this.maxTests);
    if(!tests.length)return this.empty("No tests were selected.");
    const validated:string[]=[];
    try{
      for(const test of tests)validated.push(await this.validateTestPath(test));
    }catch(error){
      return this.empty(error instanceof Error?error.message:"Invalid test path.");
    }

    const command=process.platform==="win32"?"node_modules/.bin/tsx.cmd":"node_modules/.bin/tsx";
    try{
      await access(resolve(this.root,command),constants.X_OK).catch(async()=>access(resolve(this.root,command)));
    }catch{
      return this.empty("Local test runner is unavailable. Install project dependencies first.");
    }

    const started=Date.now();
    return await new Promise<TestRunResult>(resolveResult=>{
      const child=spawn(command,validated,{cwd:this.root,shell:false,windowsHide:true});
      let stdout="";
      let stderr="";
      let timedOut=false;
      let settled=false;
      const append=(target:"stdout"|"stderr",chunk:Buffer|string)=>{
        const text=String(chunk);
        if(target==="stdout")stdout=(stdout+text).slice(-this.maxOutputChars);
        else stderr=(stderr+text).slice(-this.maxOutputChars);
      };
      child.stdout?.on("data",chunk=>append("stdout",chunk));
      child.stderr?.on("data",chunk=>append("stderr",chunk));
      const timer=setTimeout(()=>{
        timedOut=true;
        child.kill("SIGTERM");
        setTimeout(()=>{if(!settled)child.kill("SIGKILL");},2000).unref();
      },this.timeoutMs);
      child.on("error",error=>{
        if(settled)return;
        settled=true;
        clearTimeout(timer);
        resolveResult({ok:false,tests:validated,passed:[],failed:validated,timedOut,exitCode:null,signal:null,stdout,stderr,durationMs:Date.now()-started,error:error.message});
      });
      child.on("close",(exitCode,signal)=>{
        if(settled)return;
        settled=true;
        clearTimeout(timer);
        const ok=!timedOut&&exitCode===0;
        resolveResult({ok,tests:validated,passed:ok?validated:[],failed:ok?[]:validated,timedOut,exitCode,signal,stdout,stderr,durationMs:Date.now()-started,error:ok?undefined:timedOut?"Test execution timed out.":"Selected tests failed."});
      });
    });
  }

  private async validateTestPath(test:string):Promise<string>{
    if(isAbsolute(test))throw new Error("Absolute test paths are not allowed.");
    const normalized=test.replaceAll("\\","/");
    if(normalized.startsWith("../")||normalized.includes("/../")||normalized==="..")throw new Error("Test path escapes the project workspace.");
    if(!/(^|\/)(tests?|__tests__)(\/|$)/i.test(normalized))throw new Error("Only project test paths may be executed.");
    if(!/\.(spec|test)\.(c|m)?tsx?$|\.(spec|test)\.(c|m)?js$/i.test(normalized))throw new Error("Selected path is not a supported test file.");
    const candidate=resolve(this.root,normalized);
    const rootReal=await realpath(this.root);
    const fileReal=await realpath(candidate);
    const rel=relative(rootReal,fileReal);
    if(rel===""||rel.startsWith(".."+sep)||isAbsolute(rel))throw new Error("Test path escapes the project workspace.");
    return rel;
  }

  private empty(error:string):TestRunResult{
    return {ok:false,tests:[],passed:[],failed:[],timedOut:false,exitCode:null,signal:null,stdout:"",stderr:"",durationMs:0,error};
  }
}
