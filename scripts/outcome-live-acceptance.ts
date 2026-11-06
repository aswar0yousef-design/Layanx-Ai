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
process.env.LAYANX_DATA_DIR=root;
process.env.LAYANX_DATABASE_URL="";
process.env.DATABASE_URL="";
process.env.LAYANX_BUSINESS_STORAGE_PATH=path.join(store,"business.json");
process.env.LAYANX_MEDIA_STORAGE_PATH=path.join(store,"media.json");
process.env.LAYANX_CREATOR_OUTPUT_DIR=path.join(store,"creator");
process.env.LAYANX_QURAN_OUTPUT_DIR=path.join(store,"quran");
process.env.LAYANX_FREE_POOL_CONFIG=path.join(store,"free-providers.json");
process.env.LAYANX_GOOGLE_INVOICE_REGISTRY=path.join(store,"google-invoices.json");
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

// CLI acceptance must discover local models just like the Windows host.
// Without this, it silently runs the general 3B fallback even when an
// installed coding model is available. Respect owner-pinned model/routing.
if(process.env.OLLAMA_ENABLED!=="false"){
  const {discoverOllama,buildModelPlan,currentMachine,recommendNumCtx,rankModels}=await import("../src/providers/ollama-discovery.js");
  const discovered=await discoverOllama(process.env.OLLAMA_BASE_URL,{timeoutMs:3000});
  if(discovered.reachable&&discovered.models.length){
    const machine=currentMachine();
    const pinned=process.env.OLLAMA_MODEL?{planning:process.env.OLLAMA_MODEL}:{};
    const plan=buildModelPlan(discovered,machine,pinned);
    // This is an inexpensive end-to-end *acceptance probe*, not a quality
    // benchmark. The general ranking favours huge 20B/27B models even on a
    // 6 GiB GPU, causing minutes of silent CPU/RAM offloading before any tool
    // runs. When the owner has NOT explicitly pinned OLLAMA_MODEL, pick an
    // installed <=5B planning model that fits in VRAM. Coding remains routed
    // to the separately discovered specialised coding model.
    if(!process.env.OLLAMA_MODEL){
      const gpu=machine.gpuVramBytes??0;
      const fast=rankModels(discovered.models,"planning",machine,discovered.loaded).find(model=>
        model.paramsB>0&&model.paramsB<=5&&
        (!gpu||!model.sizeBytes||model.sizeBytes<=gpu*0.8));
      if(fast){
        plan.assignments.planning=fast.name;
        console.log("Live acceptance: selected smaller local planning model "+fast.name+
          " (override with OLLAMA_MODEL if preferred)");
      }
    }
    // Honour an installed pin; if the named model is unavailable, use the
    // discovery fallback exactly as the local host does.
    if(plan.assignments.planning)
      process.env.OLLAMA_MODEL=plan.assignments.planning;
    for(const warning of plan.warnings)console.warn("Ollama routing: "+warning);
    if(!process.env.LAYANX_OLLAMA_MODEL_PLAN)
      process.env.LAYANX_OLLAMA_MODEL_PLAN=JSON.stringify(plan.assignments);
    if(!process.env.LAYANX_OLLAMA_CONTEXT){
      const context:Record<string,number>={};
      for(const name of new Set(Object.values(plan.assignments).filter((name):name is string=>Boolean(name)))){
        const profile=discovered.models.find(m=>m.name===name);
        if(profile)context[name]=recommendNumCtx(profile,machine);
      }
      process.env.LAYANX_OLLAMA_CONTEXT=JSON.stringify(context);
    }
    if(!process.env.LAYANX_OLLAMA_THINKING_MODELS)
      process.env.LAYANX_OLLAMA_THINKING_MODELS=discovered.models.filter(m=>m.capabilities.includes("thinking")).map(m=>m.name).join(",");
    console.log("Ollama model routing: "+JSON.stringify({
      main:process.env.OLLAMA_MODEL,coding:plan.assignments.coding,
      planning:plan.assignments.planning,available:discovered.models.map(m=>m.name)
    }));
  }
}

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
      "Create src/server.mjs that exports createServer and responds to GET /health with JSON {ok:true}.",
      "GET / must render a usable bilingual Arabic/English HTML task UI with add and delete controls.",
      "POST /tasks accepts JSON {title} and returns {id,title}; GET /tasks returns {tasks:[{id,title}]}.",
      "DELETE /tasks/:id removes the requested task. Save changes durably to the file in environment variable LAYANX_TASKS_FILE.",
      "Tasks must survive server restarts, including deletions. Never write outside this disposable project.",
      "Create tests/tasks.test.mjs using node:test, covering health, creation, listing, deletion and restart persistence.",
      "Run project.run install, test and build; fix failures. Do not stop at only writing code."
    ].join(" ");
    // The live exercise must pass both behavioral probes and strict filesystem-backed
    // acceptance; a successful model response or a claimed test is never enough.
    const requiredAcceptance=[
      {id:"task-tests",description:"Generated task tests pass",required:true,checkId:"test" as const,artifact:"tests/tasks.test.mjs"},
      {id:"server-build",description:"Generated HTTP server passes build",required:true,checkId:"build" as const,artifact:"src/server.mjs"},
      {id:"task-behavior",description:"Independent HTTP and restart probe passes",required:true,
        checkId:"independent:task-app-http-v1" as const,artifact:"src/server.mjs"}
    ];
    const job=supervisor.create(goal,id,{maxMinutes:20,maxRounds:30,openWhenDone:false,
      acceptanceProfile:"task-app-http-v1",requiredAcceptance});
    const deadline=Date.now()+21*60_000;
    const terminal=new Set(["completed","failed","cancelled","budget_exhausted","waiting_approval"]);
    let lastProgressAt=Date.now();
    while(!terminal.has(supervisor.get(job.id)?.status??"")&&Date.now()<deadline){
      await new Promise(resolve=>setTimeout(resolve,750));
      if(Date.now()-lastProgressAt>=30000){
        const current=supervisor.get(job.id);
        const milestone=current?.milestones[current.current];
        console.log("Live acceptance progress: "+JSON.stringify({
          elapsedMinutes:Math.round((Date.now()-(deadline-21*60_000))/60000*10)/10,
          status:current?.status??"unknown",
          milestone:milestone?.title??null,
          attempt:milestone?.attempts??0,
          completedMilestones:current?.milestones.filter(m=>m.status==="done").length??0,
          totalMilestones:current?.milestones.length??0
        }));
        lastProgressAt=Date.now();
      }
    }
    const finished=supervisor.get(job.id)!;
    const report=finished.outcome;
    const machineRefs=new Set(report?.evidence.filter(e=>e.passed).map(e=>e.reference)??[]);
    const app=path.join(projects,id);
    const pkgFile=path.join(app,"package.json");
    const artifactStatus=Object.fromEntries(["package.json","src/server.mjs","tests/tasks.test.mjs"].map(name=>{
      const full=path.join(app,name);
      return[name,fs.existsSync(full)?{exists:true,bytes:fs.statSync(full).size}:{exists:false,bytes:0}];
    }));
    const hasProject=Object.values(artifactStatus).every(file=>file.exists&&file.bytes>0);
    const deliveryFile=path.join(app,".layanx","deliveries",job.id+".json");
    const deliveryGuide=path.join(app,".layanx","deliveries",job.id+".md");
    const hasDelivery=Boolean(finished.delivery&&fs.existsSync(deliveryFile)&&fs.existsSync(deliveryGuide));
    const acceptanceIds=requiredAcceptance.map(r=>r.id);
    const accepted=acceptanceIds.every(id=>report?.evidence.some(e=>
      e.name==="acceptance:"+id&&e.passed&&e.reference.startsWith("project-artifact:")));
    const {verifyTaskApp}=await import("../src/autonomy/task-app-verifier.js");
    const independent=hasProject?await verifyTaskApp(app):{ok:false,checks:[],blockers:["Generated application files missing."],verificationScope:"real-http-and-restart" as const};
    const ok=finished.status==="completed"&&report?.status==="verified"
      &&machineRefs.has("project.run:test")&&machineRefs.has("project.run:build")
      &&machineRefs.has("independent:http:task-app")&&hasProject&&hasDelivery&&accepted
      &&finished.behavior?.ok===true&&independent.ok;
    const result={
      ok,
      stage:"real-ollama-agent->generated-app->real-project-run->outcome-verification",
      status:finished.status,
      model:process.env.OLLAMA_MODEL?.trim()||"llama3.2:3b (default)",
      modelRouting:process.env.LAYANX_OLLAMA_MODEL_PLAN??null,
      hasProject,hasDelivery,accepted,acceptanceIds,artifactStatus,
      failureReason:finished.result??null,
      deliveryFile,deliveryGuide,missionCount:finished.milestones.flatMap(m=>m.missions).length,
      milestoneFailures:finished.milestones.filter(m=>m.status==="failed"||Boolean(m.notes))
        .map(m=>({title:m.title,kind:m.kind,status:m.status,attempts:m.attempts,
          reason:m.notes?.slice(0,3000)??null,missionIds:m.missions})),
      checkRefs:[...machineRefs],
      independentBehavior:independent,
      acceptanceCriteria:report?.acceptanceCriteria??[],
      blockers:[...(report?.blockers??(ok?[]:["Job did not produce a verified outcome."])),...independent.blockers],
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
