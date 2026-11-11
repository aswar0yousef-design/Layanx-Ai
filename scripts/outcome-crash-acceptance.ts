/**
 * Kills the LayanX process (no goodbye, like a power cut) while a real tool is running, starts it again, and checks from
 * the outside that the work was not repeated. The tool appends one line to a file each time it starts, so a replay shows.
 *
 *   npx tsx scripts/outcome-crash-acceptance.ts
 */
import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {spawn,spawnSync} from "node:child_process";
import {resolveDataPaths} from "../src/platform/paths.js";

const role=process.argv[2]??"parent",rootArg=process.argv[3]??"";
const env=(root:string)=>{const store=path.join(root,"store");return{
  LAYANX_WORKSPACE_ROOT:path.join(root,"projects"),LAYANX_STORE_DIR:store,LAYANX_DATA_DIR:root,LAYANX_DATABASE_URL:"",DATABASE_URL:"",
  LAYANX_RUNTIME_STORAGE_PATH:path.join(store,"runtime.json"),LAYANX_BUSINESS_STORAGE_PATH:path.join(store,"business.json"),
  LAYANX_LESSONS_FILE:path.join(store,"lessons.json"),LAYANX_PLAYBOOKS_DIR:path.join(store,"playbooks"),
  LAYANX_TRUST_FILE:path.join(root,"trust.json"),LAYANX_ISOLATION_FILE:path.join(root,"isolation.json"),
  LAYANX_SECRET_VAULT_PATH:path.join(store,"secrets.vault"),LAYANX_FREE_POOL_CONFIG:path.join(store,"free-providers.json"),
  LAYANX_DEFAULT_TRUST:"trusted",LAYANX_DEFAULT_ISOLATION:"no-scripts",LAYANX_AI_MODE:"local",LAYANX_CAPABILITIES:"coding",LAYANX_FREE_POOL_ENABLED:"false",
  OPENAI_ENABLED:"false",ANTHROPIC_ENABLED:"false",GEMINI_ENABLED:"false",MT5_AUTO_START:"false",LAYANX_OPEN_BROWSER:"off"};};
const fixedPlan=JSON.stringify({acceptance:["tests pass"],milestones:[{title:"Check the project",goal:"Run the tests",kind:"code"}],checks:{test:true,build:false,install:false,security:false,browser:null}});
const say=(value:unknown)=>{process.stdout.write("RESULT "+JSON.stringify(value)+"\n");};

async function boot(root:string){
  Object.assign(process.env,env(root));
  const {createRuntime,restoreRuntime}=await import("../src/runtime.js");
  const {coreSupervisorDeps,runSingleTool}=await import("../src/autonomy/runtime-deps.js");
  const {Supervisor}=await import("../src/autonomy/supervisor.js");
  const runtime=createRuntime({storagePath:process.env.LAYANX_RUNTIME_STORAGE_PATH}) as any;
  await restoreRuntime(runtime);
  const supervisor=new Supervisor({...coreSupervisorDeps(runtime.core),think:async()=>fixedPlan,runAgent:async()=>{
    // The "agent" changes the project; from then on its test command hangs, so the kill lands in the milestone.
    fs.writeFileSync(path.join(process.env.LAYANX_WORKSPACE_ROOT!,"crash-job","hang.flag"),"1");return{completed:true,missionId:"none"};}},{pollMs:200,file:path.join(process.env.LAYANX_STORE_DIR!,"supervisor-jobs.json")});
  return{core:runtime.core,supervisor,runSingleTool};
}

if(role==="baseline-run"){
  const {supervisor}=await boot(rootArg);
  supervisor.create("Run the project's tests","crash-base",{maxMinutes:60});
  setInterval(()=>undefined,1000);
}else if(role==="baseline-after"){
  const {supervisor}=await boot(rootArg);
  supervisor.start();
  await new Promise(r=>setTimeout(r,6000));
  say({status:supervisor.list()[0]!.status});
  process.exit(0);
}else if(role==="supervisor-run"){
  const {supervisor}=await boot(rootArg);
  supervisor.create("Run the project's tests","crash-job",{maxMinutes:60});
  setInterval(()=>undefined,1000);
}else if(role==="supervisor-after"){
  const {supervisor,core}=await boot(rootArg);
  const reaped=core.audit.list().filter((e:any)=>e.action==="runs.reaped").map((e:any)=>e.metadata);
  supervisor.start();
  await new Promise(r=>setTimeout(r,6000));
  const job=supervisor.list()[0]!;
  let resumeRefused="";try{supervisor.resume(job.id);}catch(error){resumeRefused=(error as Error).message;}
  say({status:job.status,hold:job.recoveryHold?.kind,result:job.result,milestone:job.milestones[0]?.status,resumeRefused,reaped});
  process.exit(0);
}else if(role==="tool-run"){
  const {core,runSingleTool}=await boot(rootArg);
  void runSingleTool(core,"crash-tool","project.run",{task:"test"});
  setInterval(()=>undefined,1000);
}else if(role==="tool-after"){
  const {core}=await boot(rootArg);
  const mission=core.missions.list().find((m:any)=>m.projectId==="crash-tool"&&m.tools?.length);
  let attempt:any="no mission restored";
  if(mission){try{attempt=await Promise.race([core.executeMissionTool(mission.id,"crash-tool",0,mission.tools[0].payload,undefined,"core"),new Promise(r=>setTimeout(()=>r("still running after 12 s"),12_000))]);}catch(error){attempt={threw:(error as Error).message};}}
  say({missionStatus:mission?.status,missionFound:Boolean(mission),attempt:typeof attempt==="string"?attempt:{ok:attempt?.ok,error:attempt?.error,threw:attempt?.threw,recoverable:attempt?.recoverable}});
  process.exit(0);
}else{
  const id="crash-"+randomUUID().slice(0,8);
  const parent=path.join(resolveDataPaths().dataDir,"outcome-runs");
  const root=path.join(parent,new Date().toISOString().replace(/[:.]/g,"-")+"-"+id);
  fs.mkdirSync(path.join(root,"store"),{recursive:true,mode:0o700});
  const self=path.resolve(process.argv[1]!),tsx=path.resolve("node_modules/tsx/dist/cli.mjs");
  const project=(name:string)=>{const dir=path.join(root,"projects",name);fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,"hang.js"),`const fs=require("fs");if(fs.existsSync("hang.flag")){fs.appendFileSync("starts.log",process.pid+"\\n");setInterval(()=>{},1000);}`);
    fs.writeFileSync(path.join(dir,"package.json"),JSON.stringify({name,version:"1.0.0",scripts:{test:"node hang.js"}}));return dir;};
  const starts=(dir:string)=>{const f=path.join(dir,"starts.log");return fs.existsSync(f)?fs.readFileSync(f,"utf8").trim().split("\n").filter(Boolean).map(Number):[];};
  const after=(mode:string)=>{const r=spawnSync(process.execPath,[tsx,self,mode,root],{encoding:"utf8",windowsHide:true,timeout:120_000,maxBuffer:32*1024*1024});
    const line=r.stdout.split("\n").find(x=>x.startsWith("RESULT "));return line?JSON.parse(line.slice(7)):{crashed:true,status:r.status,stderr:r.stderr.slice(-600)};};
  const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
  async function scenario(name:string,dir:string,run:string,post:string){
    // Started with --import so that this pid is LayanX itself and not a launcher in front of it.
    const child=spawn(process.execPath,["--import","tsx",self,run,root],{windowsHide:true,stdio:"ignore"});
    const began=Date.now();
    while(!starts(dir).length&&Date.now()-began<120_000)await new Promise(r=>setTimeout(r,200));
    const startedBeforeKill=starts(dir).length;
    await new Promise(r=>setTimeout(r,6000));
    // Only LayanX ends, as in a power cut of the app: the tool's own processes are left as they are.
    spawnSync("taskkill",["/f","/pid",String(child.pid)],{windowsHide:true});
    await new Promise(r=>setTimeout(r,800));
    const leftBehind=starts(dir).filter(alive);
    const firstProcess=starts(dir)[0]!;
    const result=after(post);
    const oldProcessAliveAfterRestart=alive(firstProcess);
    await new Promise(r=>setTimeout(r,1500));
    const total=starts(dir).length;
    for(const pid of starts(dir))spawnSync("taskkill",["/f","/t","/pid",String(pid)],{windowsHide:true});
    return{name,startedBeforeKill,leftBehindAfterKill:leftBehind.length,oldProcessAliveAfterRestart,startsAfterRestart:total,result};
  }
  const flagged=(name:string)=>{const dir=project(name);fs.writeFileSync(path.join(dir,"hang.flag"),"1");return dir;};
  const job=await scenario("supervisor job killed while its milestone's test command runs",project("crash-job"),"supervisor-run","supervisor-after");
  const tool=await scenario("tool killed mid-run, then the same step requested again",flagged("crash-tool"),"tool-run","tool-after");
  // A baseline only reads the project, so running it again is allowed; the old copy must not be left running beside it.
  const baseline=await scenario("killed during the read-only baseline: the old run is stopped",flagged("crash-base"),"baseline-run","baseline-after");
  const jobOk=job.startedBeforeKill===1&&job.startsAfterRestart===1&&!job.oldProcessAliveAfterRestart&&job.result.status==="failed"&&job.result.hold==="interrupted-milestone"&&job.result.resumeRefused==="recovery_reconciliation_required";
  const toolOk=tool.startedBeforeKill===1&&tool.startsAfterRestart===1&&!tool.oldProcessAliveAfterRestart&&tool.result.missionFound===true&&tool.result.missionStatus==="blocked"&&tool.result.attempt?.ok===false&&/Interrupted by a restart/.test(tool.result.attempt?.error??"");
  const baselineOk=baseline.startedBeforeKill===1&&!baseline.oldProcessAliveAfterRestart;
  const report={at:new Date().toISOString(),ok:jobOk&&toolOk&&baselineOk,jobOk,job,toolOk,tool,baselineOk,baseline};
  const file=path.join(root,"crash-result.json");
  fs.writeFileSync(file,JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify({file,...report},null,2));
  process.exit(report.ok?0:1);
}
