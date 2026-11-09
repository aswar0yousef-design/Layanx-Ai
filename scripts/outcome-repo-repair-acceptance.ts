/**
 * Real-repository repair acceptance. LayanX receives only a user-style bug report for a disposable
 * clone of an existing project; a real browser, owned by this script and not by LayanX, decides.
 * The original repository is never written to, and the clone has no remote.
 *
 *   npm run acceptance:repair:local -- --case first-run-crash --runs 3
 *   npm run acceptance:repair:local -- --case first-run-crash --repo C:\path\to\repo
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {resolveDataPaths} from "../src/platform/paths.js";

interface Check{name:string;ok:boolean;detail?:string}
type Page=any;
interface RepairCase{
  id:string;
  repo:string;
  report:string;
  /** Must fail on the unmodified clone: otherwise the scenario proves nothing. */
  bug:(open:Opener)=>Promise<Check[]>;
  /** Working behaviour that must pass both before and after the repair. */
  keep:(open:Opener)=>Promise<Check[]>;
  maxChangedLines:number;
}
type Opener=(file:string,seed?:Record<string,string>)=>Promise<{page:Page;errors:string[];close:()=>Promise<void>}>;

const savedMedication=JSON.stringify({medications:[{id:"m1",name:"Panadol-X",dose:"500mg",instructions:"after food",start:"2026-01-01",end:"2026-12-31",enabled:true,occurrences:[]}],occurrences:[]});
const noErrors=(name:string,errors:string[]):Check=>({name:name+": no uncaught page errors",ok:!errors.length,detail:errors.join(" | ").slice(0,400)});
const medicationsPageOnFirstVisit=async(open:Opener):Promise<Check[]>=>{
  const s=await open("medications.html");
  try{
    const text=(await s.page.locator("#medications-list").innerText()).trim();
    const cards=await s.page.locator(".medication-card").count();
    return[noErrors("medications first visit",s.errors),{name:"medications first visit: shows an empty message or real cards",ok:text.includes("لا توجد أدوية")||cards>0,detail:text.slice(0,120)}];
  }finally{await s.close();}
};
const savedDataStillRenders=async(open:Opener):Promise<Check[]>=>{
  const s=await open("medications.html",{medicationAppData:savedMedication});
  try{
    const text=await s.page.locator("#medications-list").innerText();
    return[noErrors("saved data",s.errors),{name:"saved medication still appears",ok:text.includes("Panadol-X")&&text.includes("500mg"),detail:text.slice(0,120)}];
  }finally{await s.close();}
};

const MAWID="C:/Users/Ryzen/AllwaaProjects/mawid-dawai";
const CASES:Record<string,RepairCase>={
  "first-run-crash":{
    id:"first-run-crash",repo:MAWID,maxChangedLines:40,
    report:"عندي عطل في هذا المشروع القائم. عند فتح صفحة medications.html لأول مرة في متصفح لم يستخدم التطبيق من قبل، تظهر رسالة خطأ في الكونسول ولا تظهر قائمة الأدوية ولا عبارة «لا توجد أدوية». المطلوب: اكتشف السبب من الكود وأصلحه بأقل تغيير ممكن. لا تعد كتابة المشروع ولا تحذف أي ميزة. البيانات التجريبية اختيارية حسب README ويجب ألا تتسبب في أي خطأ.",
    bug:medicationsPageOnFirstVisit,keep:savedDataStillRenders
  },
  "home-first-run":{
    id:"home-first-run",repo:MAWID,maxChangedLines:40,
    report:"عندي عطل في هذا المشروع القائم. عند فتح الصفحة الرئيسية index.html في متصفح لم يستخدم التطبيق من قبل، يبقى مربع الجرعة القادمة (next-dose) فارغاً تماماً، والمفروض أن يعرض عبارة «لا توجد جرعة قادمة» دون أي خطأ في الكونسول. المطلوب: اكتشف السبب من الكود وأصلحه بأقل تغيير ممكن. لا تعد كتابة المشروع ولا تحذف أي ميزة. قد يكون للعطل أكثر من سبب.",
    bug:async open=>{
      const s=await open("index.html");
      try{
        const text=(await s.page.locator("#next-dose").innerText()).trim();
        return[noErrors("home first visit",s.errors),{name:"home first visit: next dose message is shown",ok:text.includes("لا توجد جرعة قادمة"),detail:text.slice(0,120)}];
      }finally{await s.close();}
    },
    keep:savedDataStillRenders
  }
};

const arg=(name:string)=>{const i=process.argv.indexOf("--"+name);return i>0?process.argv[i+1]:undefined;};
const selected=CASES[arg("case")??"first-run-crash"];
if(!selected){console.error("Unknown case. Available: "+Object.keys(CASES).join(", "));process.exit(2);}
const repairCase:RepairCase=selected;
const originalRepo=path.resolve(arg("repo")??repairCase.repo);
const git=(cwd:string,...args:string[])=>{
  const r=spawnSync("git",args,{cwd,encoding:"utf8",windowsHide:true,maxBuffer:32*1024*1024});
  if(r.status!==0)throw new Error("git "+args.join(" ")+": "+(r.stderr||r.error?.message));
  return r.stdout;
};

/** Serves the project and opens it in a fresh browser profile. Nothing here comes from LayanX. */
async function createJudge(dir:string){
  const mime:Record<string,string>={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8"};
  const root=path.resolve(dir);
  const server=http.createServer((request,response)=>{
    const pathname=decodeURIComponent(new URL(request.url??"/","http://x").pathname);
    const file=path.resolve(root,"."+pathname);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);response.end();return;}
    response.writeHead(200,{"content-type":mime[path.extname(file)]??"application/octet-stream"});
    response.end(fs.readFileSync(file));
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",()=>resolve()));
  const base="http://127.0.0.1:"+(server.address() as {port:number}).port+"/";
  const pw:any=await import("playwright-core");
  const chromium=pw.chromium??pw.default?.chromium;
  const browser=await chromium.launch({headless:true,channel:"msedge"}).catch(()=>chromium.launch({headless:true,channel:"chrome"}));
  const open:Opener=async(file,seed)=>{
    const context=await browser.newContext();
    if(seed)await context.addInitScript((items:Record<string,string>)=>{for(const[k,v]of Object.entries(items))localStorage.setItem(k,v);},seed);
    const page=await context.newPage();
    const errors:string[]=[];
    page.on("pageerror",(e:Error)=>errors.push(e.message));
    await page.goto(base+file,{waitUntil:"load"});
    await page.waitForTimeout(600);
    return{page,errors,close:()=>context.close()};
  };
  return{open,close:async()=>{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
async function judge(dir:string){
  const j=await createJudge(dir);
  try{
    const guard=async(run:(open:Opener)=>Promise<Check[]>):Promise<Check[]>=>{try{return await run(j.open);}catch(e){return[{name:"browser check could not complete",ok:false,detail:String((e as Error).message).slice(0,300)}];}};
    return{bug:await guard(repairCase.bug),keep:await guard(repairCase.keep)};
  }finally{await j.close();}
}
const allOk=(checks:Check[])=>checks.length>0&&checks.every(c=>c.ok);

/** Everything LayanX changed against the base commit, committed or not, without its own bookkeeping. */
function changeSet(dir:string,base:string){
  git(dir,"add","-A");
  const raw=git(dir,"diff","--cached","--numstat",base,"--",".",":(exclude).layanx");
  const files=raw.trim().split("\n").filter(Boolean).map(line=>{const[added,removed,file]=line.split("\t");return{file:file!,added:Number(added)||0,removed:Number(removed)||0};});
  const deleted=git(dir,"diff","--cached","--name-only","--diff-filter=D",base,"--",".",":(exclude).layanx").trim().split("\n").filter(Boolean);
  return{files,deleted,changedLines:files.reduce((sum,f)=>sum+f.added+f.removed,0),patch:git(dir,"diff","--cached",base,"--",".",":(exclude).layanx").slice(0,20000)};
}

async function runOne(){
  const id="repair-"+randomUUID().slice(0,8);
  const parent=path.join(resolveDataPaths().dataDir,"outcome-runs");
  const root=path.join(parent,new Date().toISOString().replace(/[:.]/g,"-")+"-"+id);
  const projects=path.join(root,"projects"),store=path.join(root,"store"),workspace=path.join(projects,id);
  fs.mkdirSync(store,{recursive:true,mode:0o700});fs.mkdirSync(projects,{recursive:true,mode:0o700});
  const reportFile=path.join(root,"repair-result.json");
  const originalState=()=>git(originalRepo,"rev-parse","HEAD")+git(originalRepo,"status","--porcelain");
  const originalBefore=originalState();
  git(os.tmpdir(),"clone","--quiet","--no-hardlinks",originalRepo,workspace);
  git(workspace,"remote","remove","origin");
  const base=git(workspace,"rev-parse","HEAD").trim();
  const finish=(result:Record<string,unknown>)=>{
    const body={at:new Date().toISOString(),case:repairCase.id,originalRepo,base,workspace,originalUntouched:originalState()===originalBefore,...result};
    fs.writeFileSync(reportFile,JSON.stringify(body,null,2),{mode:0o600});
    console.log(JSON.stringify({reportFile,...body,patch:undefined},null,2));
    console.log("RESULT_FILE="+reportFile);
    process.exitCode=body.ok===true&&body.originalUntouched?0:1;
  };

  const before=await judge(workspace);
  if(allOk(before.bug)||!allOk(before.keep)){
    finish({ok:false,stage:"baseline",reason:allOk(before.bug)?"The bug does not reproduce on the unmodified clone.":"Working behaviour already fails on the unmodified clone.",before});
    return;
  }

  Object.assign(process.env,{
    LAYANX_WORKSPACE_ROOT:projects,LAYANX_STORE_DIR:store,LAYANX_DATA_DIR:root,LAYANX_DATABASE_URL:"",DATABASE_URL:"",
    LAYANX_BUSINESS_STORAGE_PATH:path.join(store,"business.json"),LAYANX_MEDIA_STORAGE_PATH:path.join(store,"media.json"),
    LAYANX_CREATOR_OUTPUT_DIR:path.join(store,"creator"),LAYANX_QURAN_OUTPUT_DIR:path.join(store,"quran"),
    LAYANX_FREE_POOL_CONFIG:path.join(store,"free-providers.json"),LAYANX_GOOGLE_INVOICE_REGISTRY:path.join(store,"google-invoices.json"),
    LAYANX_RUNTIME_STORAGE_PATH:path.join(store,"runtime.json"),LAYANX_LESSONS_FILE:path.join(store,"lessons.json"),
    LAYANX_PLAYBOOKS_DIR:path.join(store,"playbooks"),LAYANX_TRUST_FILE:path.join(root,"trust.json"),
    LAYANX_ISOLATION_FILE:path.join(root,"isolation.json"),LAYANX_SECRET_VAULT_PATH:path.join(store,"secrets.vault"),
    LAYANX_AI_MODE:"local",LAYANX_CAPABILITIES:"coding",LAYANX_FREE_POOL_ENABLED:"false",
    OPENAI_ENABLED:"false",ANTHROPIC_ENABLED:"false",GEMINI_ENABLED:"false",MT5_AUTO_START:"false",LAYANX_OPEN_BROWSER:"off"
  });
  // Planner evals on this PC: gpt-oss:20b 7/9, the default planning route could not answer in time.
  const model=process.env.OLLAMA_MODEL||"gpt-oss:20b";
  process.env.OLLAMA_MODEL=model;
  process.env.LAYANX_OLLAMA_MODEL_PLAN??=JSON.stringify({general:model,planning:model,coding:model,fast:model});

  const {setTrust}=await import("../src/autonomy/trust.js");
  const {setIsolation}=await import("../src/autonomy/sandbox.js");
  const {createRuntime}=await import("../src/runtime.js");
  const {Supervisor}=await import("../src/autonomy/supervisor.js");
  const {coreSupervisorDeps}=await import("../src/autonomy/runtime-deps.js");
  setTrust(process.env.LAYANX_TRUST_FILE,id,"trusted");
  setIsolation(process.env.LAYANX_ISOLATION_FILE,id,"no-scripts");
  const runtime=createRuntime({storagePath:process.env.LAYANX_RUNTIME_STORAGE_PATH});
  const supervisor=new Supervisor(coreSupervisorDeps(runtime.core),{file:path.join(store,"supervisor-jobs.json"),pollMs:500});
  const started=Date.now();
  try{
    const job=supervisor.create(repairCase.report,id,{maxMinutes:25,maxRounds:12,openWhenDone:false,acceptanceProfile:"static-repair-v1"});
    const terminal=new Set(["completed","failed","cancelled","budget_exhausted","waiting_approval"]);
    let seen=0,lastBeat=Date.now();
    while(!terminal.has(supervisor.get(job.id)?.status??"")&&Date.now()-started<26*60_000){
      await new Promise(resolve=>setTimeout(resolve,1000));
      const current=supervisor.get(job.id);
      for(const entry of current?.log.slice(seen)??[])console.log("[job] "+entry.msg.slice(0,300));
      seen=current?.log.length??seen;
      if(Date.now()-lastBeat>=60_000){console.log("[beat] "+Math.round((Date.now()-started)/60000)+" min, status "+current?.status);lastBeat=Date.now();}
    }
    const finished=supervisor.get(job.id)!;
    supervisor.cancel(job.id);
    const after=await judge(workspace);
    const changes=changeSet(workspace,base);
    const fixed=allOk(after.bug),kept=allOk(after.keep);
    const bounded=changes.changedLines>0&&changes.changedLines<=repairCase.maxChangedLines&&!changes.deleted.length;
    const claimed=finished.status==="completed";
    finish({
      ok:fixed&&kept&&bounded&&claimed,
      model,minutes:Math.round((Date.now()-started)/6000)/10,
      jobStatus:finished.status,claimedSuccess:claimed,falseSuccess:claimed&&!(fixed&&kept),
      fixed,kept,bounded,before,after,changes,
      milestones:finished.milestones.map(m=>({title:m.title,kind:m.kind,status:m.status,attempts:m.attempts,notes:m.notes?.slice(0,1500)})),
      checks:finished.checks,result:finished.result?.slice(0,1500),log:finished.log.slice(-25).map(l=>l.msg.slice(0,300))
    });
  }catch(error){finish({ok:false,stage:"runtime",error:String((error as Error).stack??error).slice(0,2000)});}
  finally{supervisor.stop();}
}

if(process.argv.includes("--one")){
  await runOne();
  setTimeout(()=>process.exit(process.exitCode??0),500);
}else{
  const runs=Number(arg("runs")??"1");
  if(!Number.isInteger(runs)||runs<1||runs>10){console.error("--runs must be 1 to 10");process.exit(2);}
  const records:Array<Record<string,unknown>>=[];
  for(let i=1;i<=runs;i++){
    console.log(`\n=== repair run ${i}/${runs}: ${repairCase.id}`);
    const self=process.argv.slice(1).filter(Boolean);
    const child=spawnSync(process.execPath,[...process.execArgv,...self,"--one"],{encoding:"utf8",windowsHide:true,maxBuffer:128*1024*1024,timeout:30*60_000});
    process.stdout.write(child.stdout??"");process.stderr.write(child.stderr??"");
    const file=/RESULT_FILE=(.+)/.exec(child.stdout??"")?.[1]?.trim();
    records.push(file&&fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):{ok:false,stage:"process",exit:child.status,error:child.error?.message});
  }
  const passed=records.filter(r=>r.ok===true).length;
  const summary={case:repairCase.id,runs,passed,falseSuccess:records.filter(r=>r.falseSuccess===true).length,
    results:records.map(r=>({ok:r.ok,stage:r.stage,jobStatus:r.jobStatus,fixed:r.fixed,kept:r.kept,bounded:r.bounded,minutes:r.minutes,workspace:r.workspace}))};
  const out=path.join(resolveDataPaths().dataDir,"outcome-runs","repair-batch-"+new Date().toISOString().replace(/[:.]/g,"-")+".json");
  fs.writeFileSync(out,JSON.stringify({summary,records},null,2),{mode:0o600});
  console.log(JSON.stringify({report:out,summary},null,2));
  process.exitCode=passed===runs?0:1;
}
