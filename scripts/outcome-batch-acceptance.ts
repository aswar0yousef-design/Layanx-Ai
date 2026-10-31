/**
 * Real, sequential Ollama project-delivery acceptance runs with independent
 * post-handoff checksum verification. Executed only by an owner on a local machine.
 * Not a sandbox: use a disposable test machine without production credentials.
 */
import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import {resolveDataPaths} from "../src/platform/paths.js";
import {verifyDeliveryManifest,type DeliveryVerification} from "../src/autonomy/delivery.js";
import {evaluateLocalAcceptance,summarizeLocalAcceptance,
  type LocalAcceptanceObserved,type LocalAcceptanceRecord} from "../src/autonomy/release-batch.js";

const args=process.argv.slice(2);
const runArg=args.find(x=>x.startsWith("--runs="))?.slice("--runs=".length)
  ??(args.indexOf("--runs")>=0?args[args.indexOf("--runs")+1]:undefined)
  ??"1";
const runs=Number(runArg);
if(!Number.isInteger(runs)||runs<1||runs>5){
  console.error("Use npm run acceptance:batch:local -- --runs 1 (or 2 through 5)");
  process.exitCode=2;
}else{
  const dir=path.join(resolveDataPaths().dataDir,"outcome-runs");
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const stamp=new Date().toISOString().replace(/[:.]/g,"-");
  const resultFile=path.join(dir,"batch-"+stamp+".json");
  const records:LocalAcceptanceRecord[]=[];
  const snapshot=()=>new Set(fs.readdirSync(dir,{withFileTypes:true}).filter(f=>f.isDirectory()).map(f=>f.name));
  const safeJSON=(file:string):LocalAcceptanceObserved|null=>{
    try{
      const value:unknown=JSON.parse(fs.readFileSync(file,"utf8"));
      return value&&typeof value==="object"&&!Array.isArray(value)?value as LocalAcceptanceObserved:null;
    }catch{return null;}
  };
  const runOne=async(index:number):Promise<LocalAcceptanceRecord>=>{
    const before=snapshot();
    const logFile=path.join(dir,"batch-"+stamp+"-run-"+index+".log");
    const log=fs.openSync(logFile,"w",0o600);
    let timeout=false;
    const exitCode=await new Promise<number|null>(resolve=>{
      const child=spawn(process.execPath,["node_modules/tsx/dist/cli.mjs","scripts/outcome-live-acceptance.ts"],{
        cwd:process.cwd(),env:process.env,windowsHide:true,stdio:["ignore","pipe","pipe"]
      });
      let settled=false;
      const done=(code:number|null)=>{
        if(settled)return;settled=true;clearTimeout(timer);resolve(code);
      };
      const timer=setTimeout(()=>{timeout=true;child.kill("SIGKILL");},26*60_000);
      child.stdout?.on("data",(chunk:Buffer)=>{try{fs.writeSync(log,chunk);}catch{}});
      child.stderr?.on("data",(chunk:Buffer)=>{try{fs.writeSync(log,chunk);}catch{}});
      child.on("error",e=>{try{fs.writeSync(log,String(e));}catch{}done(null);});
      child.on("close",code=>done(code));
    });
    fs.closeSync(log);
    const additions=fs.readdirSync(dir,{withFileTypes:true})
      .filter(f=>f.isDirectory()&&!before.has(f.name)).map(f=>path.join(dir,f.name));
    const runFolder=additions.length===1?additions[0]!:"";
    const observed=runFolder?safeJSON(path.join(runFolder,"acceptance-result.json")):null;
    const id=observed?.id;
    const workspace=(runFolder&&typeof id==="string"&&/^acceptance-[a-f0-9]{8}$/.test(id))
      ?path.join(runFolder,"projects",id):"";
    let integrity:DeliveryVerification|null=null;
    if(workspace&&observed?.jobId&&fs.existsSync(workspace)){
      try{integrity=verifyDeliveryManifest(workspace,observed.jobId);}catch{}
    }
    const evaluation=evaluateLocalAcceptance(observed,integrity,workspace);
    if(additions.length!==1)evaluation.blockers.push("Expected exactly one new isolated run folder; observed "+additions.length);
    if(timeout)evaluation.blockers.push("The live run exceeded its 26-minute timeout");
    if(exitCode!==0)evaluation.blockers.push("Live acceptance exited unsuccessfully (code "+exitCode+")");
    evaluation.ok=evaluation.blockers.length===0;
    return {runFolder,workspace,exitCode,observed,integrity,evaluation};
  };
  for(let index=1;index<=runs;index++){
    process.stdout.write("LayanX local acceptance "+index+"/"+runs+" — running a real Ollama job\n");
    const result=await runOne(index);
    records.push(result);
    process.stdout.write(JSON.stringify({run:index,pass:result.evaluation.ok,
      fileCount:result.evaluation.filesVerified,behaviorChecks:result.evaluation.independentChecksPassed,
      blockers:result.evaluation.blockers,runFolder:result.runFolder})+"\n");
  }
  const summary=summarizeLocalAcceptance(records,runs);
  fs.writeFileSync(resultFile,JSON.stringify({at:new Date().toISOString(),model:process.env.OLLAMA_MODEL??"configured local Ollama model",
    ...summary,records},null,2),{mode:0o600});
  console.log(JSON.stringify({reportFile:resultFile,...summary},null,2));
  if(!summary.ok)process.exitCode=1;
}
