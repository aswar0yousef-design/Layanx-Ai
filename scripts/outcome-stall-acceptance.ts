/**
 * Stall acceptance on real parts: the real runtime and tool path, a real child process that never exits, and a real HTTP
 * endpoint that never answers. This script, not LayanX, then decides: is the process gone, how soon did the job end, and
 * was anything repeated. The limits are shortened only inside this disposable run.
 *
 *   npx tsx scripts/outcome-stall-acceptance.ts
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {resolveDataPaths} from "../src/platform/paths.js";

const id="stall-"+randomUUID().slice(0,8);
const parent=path.join(resolveDataPaths().dataDir,"outcome-runs");
const root=path.join(parent,new Date().toISOString().replace(/[:.]/g,"-")+"-"+id);
const projects=path.join(root,"projects"),store=path.join(root,"store");
fs.mkdirSync(store,{recursive:true,mode:0o700});fs.mkdirSync(projects,{recursive:true,mode:0o700});
const hung=http.createServer(()=>undefined);
await new Promise<void>(resolve=>hung.listen(0,"127.0.0.1",()=>resolve()));
const ACTION_MS=15_000,MODEL_MS=8_000;
Object.assign(process.env,{
  LAYANX_WORKSPACE_ROOT:projects,LAYANX_STORE_DIR:store,LAYANX_DATA_DIR:root,LAYANX_DATABASE_URL:"",DATABASE_URL:"",
  LAYANX_RUNTIME_STORAGE_PATH:path.join(store,"runtime.json"),LAYANX_BUSINESS_STORAGE_PATH:path.join(store,"business.json"),
  LAYANX_LESSONS_FILE:path.join(store,"lessons.json"),LAYANX_PLAYBOOKS_DIR:path.join(store,"playbooks"),
  LAYANX_TRUST_FILE:path.join(root,"trust.json"),LAYANX_ISOLATION_FILE:path.join(root,"isolation.json"),
  LAYANX_SECRET_VAULT_PATH:path.join(store,"secrets.vault"),LAYANX_FREE_POOL_CONFIG:path.join(store,"free-providers.json"),
  LAYANX_DEFAULT_TRUST:"trusted",LAYANX_DEFAULT_ISOLATION:"no-scripts",LAYANX_AI_MODE:"local",LAYANX_CAPABILITIES:"coding",LAYANX_FREE_POOL_ENABLED:"false",
  OPENAI_ENABLED:"false",ANTHROPIC_ENABLED:"false",GEMINI_ENABLED:"false",MT5_AUTO_START:"false",LAYANX_OPEN_BROWSER:"off",
  LAYANX_STALL_ACTION_MS:String(ACTION_MS),LAYANX_STALL_MODEL_MS:String(MODEL_MS),
  OLLAMA_BASE_URL:`http://127.0.0.1:${(hung.address() as {port:number}).port}`,OLLAMA_MODEL:"never-answers:1",
  LAYANX_OLLAMA_MODEL_PLAN:JSON.stringify({general:"never-answers:1",planning:"never-answers:1",coding:"never-answers:1",fast:"never-answers:1"}),
  LAYANX_OLLAMA_MODEL_LADDER:""
});
const {createRuntime}=await import("../src/runtime.js");
const {coreSupervisorDeps}=await import("../src/autonomy/runtime-deps.js");
const {Supervisor}=await import("../src/autonomy/supervisor.js");
const runtime=createRuntime({storagePath:process.env.LAYANX_RUNTIME_STORAGE_PATH}) as any;
const real=coreSupervisorDeps(runtime.core);
const settled=async(job:any,limitMs:number)=>{const began=Date.now();while(Date.now()-began<limitMs&&["planning","running","verifying","queued"].includes(job.status))await new Promise(r=>setTimeout(r,200));return Math.round((Date.now()-began)/100)/10;};
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};

// 1. A real test command that never exits, reached through the real tool path.
const toolProject=path.join(projects,"hanging-tests");
fs.mkdirSync(toolProject,{recursive:true});
fs.writeFileSync(path.join(toolProject,"hang.js"),`require("fs").appendFileSync("starts.log",process.pid+"\\n");setInterval(()=>{},1000);`);
fs.writeFileSync(path.join(toolProject,"package.json"),JSON.stringify({name:"hanging-tests",version:"1.0.0",scripts:{test:"node hang.js"}}));
const fixedPlan=JSON.stringify({acceptance:["tests pass"],milestones:[{title:"Check the project",goal:"Run the tests",kind:"code"}],checks:{test:true,build:false,install:false,security:false,browser:null}});
const toolSupervisor=new Supervisor({...real,think:async()=>fixedPlan,runAgent:async()=>({completed:true,missionId:"none"})},{pollMs:200});
const toolJob=toolSupervisor.create("Run the project's tests","hanging-tests",{maxMinutes:60});
const toolSeconds=await settled(toolJob,120_000);
await new Promise(r=>setTimeout(r,4000));
const starts=fs.existsSync(path.join(toolProject,"starts.log"))?fs.readFileSync(path.join(toolProject,"starts.log"),"utf8").trim().split("\n").filter(Boolean).map(Number):[];
const tool={status:toolJob.status,stall:toolJob.stall,result:toolJob.result,seconds:toolSeconds,started:starts.length,processStillAlive:starts.some(alive),hold:toolJob.recoveryHold?.kind};
const toolOk=tool.status==="failed"&&tool.stall?.kind==="action"&&/project\.run/.test(tool.stall.what)&&tool.hold==="stalled-operation"&&tool.seconds<ACTION_MS/1000+30&&tool.started===1&&!tool.processStillAlive;

// 2. The real model path against an endpoint that accepts the connection and never answers.
fs.mkdirSync(path.join(projects,"silent-model"),{recursive:true});
const modelSupervisor=new Supervisor(real,{pollMs:200});
const modelJob=modelSupervisor.create("Plan something with a model that never answers","silent-model",{maxMinutes:60});
const modelSeconds=await settled(modelJob,150_000);
const log=modelJob.log.map((l:any)=>l.msg);
const modelResult={status:modelJob.status,seconds:modelSeconds,result:modelJob.result,stall:modelJob.stall,log:log.slice(-8)};
const modelOk=modelResult.status!=="completed"&&!["planning","running","verifying","queued"].includes(modelResult.status)&&/timed out|made no progress/i.test(log.join("\n")+String(modelResult.result));

const report={at:new Date().toISOString(),ok:toolOk&&modelOk,limits:{actionSeconds:ACTION_MS/1000,modelSeconds:MODEL_MS/1000},toolOk,tool,modelOk,model:modelResult};
const file=path.join(root,"stall-result.json");
fs.writeFileSync(file,JSON.stringify(report,null,2),{mode:0o600});
console.log(JSON.stringify({file,...report},null,2));
process.exit(report.ok?0:1);
