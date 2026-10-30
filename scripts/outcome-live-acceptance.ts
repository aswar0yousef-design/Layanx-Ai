/**
 * On-device, real-model acceptance test. Unlike the CI fixture, this invokes
 * the installed Ollama model and LayanX agent gateway to create a fresh app.
 * It NEVER publishes, trades, emails, or reuses an existing project directory.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {resolveDataPaths} from "../src/platform/paths.js";

const id="acceptance-"+randomUUID().slice(0,8);
const parent=path.join(resolveDataPaths().dataDir,"outcome-runs");
fs.mkdirSync(parent,{recursive:true,mode:0o700});
const root=path.join(parent,new Date().toISOString().replace(/[:.]/g,"-")+"-"+id);
const projects=path.join(root,"projects");
const store=path.join(root,"store");
fs.mkdirSync(projects,{recursive:true,mode:0o700});
fs.mkdirSync(store,{recursive:true,mode:0o700});

// Deliberately isolate this proof from store, email, trading, ads, and cloud.
process.env.LAYANX_WORKSPACE_ROOT=projects;
process.env.LAYANX_STORE_DIR=store;
process.env.LAYANX_RUNTIME_STORAGE_PATH=path.join(store,"runtime.json");
process.env.LAYANX_LESSONS_FILE=path.join(store,"lessons.json");
process.env.LAYANX_PLAYBOOKS_DIR=path.join(store,"playbooks");
process.env.LAYANX_TRUST_FILE=path.join(root,"trust.json");
process.env.LAYANX_ISOLATION_FILE=path.join(root,"isolation.json");
process.env.LAYANX_SECRET_VAULT_PATH=path.join(store,"secrets.vault");
process.env.LAYANX_AI_MODE="local";
process.env.LAYANX_CAPABILITIES="coding";
process.env.LAYANX_FREE_POOL_ENABLED="false";
process.env.OPENAI_ENABLED="false";
process.env.ANTHROPIC_ENABLED="false";
process.env.GEMINI_ENABLED="false";
process.env.MT5_AUTO_START="false";
process.env.LAYANX_OPEN_BROWSER="off";

const {setTrust}=await import("../src/autonomy/trust.js");
const {setIsolation}=await import("../src/autonomy/sandbox.js");
const {createRuntime,runtimeHealth}=await import("../src/runtime.js");
const {Supervisor}=await import("../src/autonomy/supervisor.js");
const {coreSupervisorDeps}=await import("../src/autonomy/runtime-deps.js");
setTrust(process.env.LAYANX_TRUST_FILE,id,"trusted"); // only this disposable project
setIsolation(process.env.LAYANX_ISOLATION_FILE,id,"no-scripts");

const reportFile=path.join(root,"acceptance-result.json");
const write=(result:Record<string,unknown>)=>{
  fs.writeFileSync(reportFile,JSON.stringify({at:new Date().toISOString(),id,workspace:path.join(projects,id),...result},null,2),{mode:0o600});
};
const runtime=createRuntime({storagePath:process.env.LAYANX_RUNTIME_STORAGE_PATH});
const health=await runtimeHealth(runtime);
const ollama=health.providers.find(p=>p.provider==="ollama");
if(!ollama?.available){
  const reason="Local Ollama is unavailable. Start Ollama and install the configured model, then run again.";
  write({ok:false,stage:"preflight",reason});
  console.error(JSON.stringify({ok:false,reason,reportFile},null,2));
  process.exitCode=2;
}else{
  const supervisor=new Supervisor(coreSupervisorDeps(runtime.core),{file:path.join(store,"supervisor-jobs.json"),pollMs:500});
  try{
    const goal=[
      "Create a working Node.js ESM HTTP task-list application in this project folder only.",
      "Do not use external packages or any cloud, publishing, payment, messaging, or trading tools.",
      "Create package.json with scripts test (node --test) and build (node --check src/server.mjs).",
      "Create src/server.mjs that exports createServer and responds to GET /health with {ok:true},",
      "POST /tasks with JSON title, and GET /tasks with the list of stored tasks.",
      "Create tests/tasks.test.mjs using node:test, covering the real HTTP health, add and list flows.",
      "Run project.run install, test and build; fix failures. Do not stop at only writing code."
    ].join(" ");
    const job=supervisor.create(goal,id,{maxMinutes:20,maxRounds:30,openWhenDone:false});
    const deadline=Date.now()+21*60_000;
    const terminal=new Set(["completed","failed","cancelled","budget_exhausted","waiting_approval"]);
    while(!terminal.has(supervisor.get(job.id)?.status??"")&&Date.now()<deadline){
      await new Promise(resolve=>setTimeout(resolve,750));
    }
    const finished=supervisor.get(job.id)!;
    const report=finished.outcome;
    const machineRefs=new Set(report?.evidence.filter(e=>e.passed).map(e=>e.reference)??[]);
    const app=path.join(projects,id);
    const pkgFile=path.join(app,"package.json");
    const hasProject=fs.existsSync(path.join(app,"src","server.mjs"))
      &&fs.existsSync(path.join(app,"tests","tasks.test.mjs"))
      &&fs.existsSync(pkgFile);
    const ok=finished.status==="completed"&&report?.status==="verified"
      &&machineRefs.has("project.run:test")&&machineRefs.has("project.run:build")&&hasProject;
    const result={
      ok,
      stage:"real-ollama-agent->generated-app->real-project-run->outcome-verification",
      status:finished.status,
      model:process.env.OLLAMA_MODEL??"configured Ollama default",
      hasProject,missionCount:finished.milestones.flatMap(m=>m.missions).length,
      checkRefs:[...machineRefs],
      acceptanceCriteria:report?.acceptanceCriteria??[],
      blockers:report?.blockers??(ok?[]:["Job did not produce a verified outcome."]),
      outcomeFile:path.join(app,".layanx","outcomes",job.id+".json"),
      jobId:job.id,
      lastLog:finished.log.slice(-12)
    };
    write(result);
    console.log(JSON.stringify({reportFile,workspace:app,...result},null,2));
    if(!ok)process.exitCode=1;
  }catch(error){
    write({ok:false,stage:"runtime",error:error instanceof Error?error.message:String(error)});
    console.error("Live acceptance failed; inspect "+reportFile, error);
    process.exitCode=1;
  }finally{
    supervisor.stop();
  }
}
