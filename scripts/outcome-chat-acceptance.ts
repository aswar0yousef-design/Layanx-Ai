/**
 * Chat acceptance. Sends one real message to POST /v1/assistant/turn on a running API and waits for the supervisor it
 * must start. This script, not LayanX, then decides: the HTTP probe for a built app, a real browser for a repaired one.
 * Trust is raised only inside this disposable run; the product default stays "supervised".
 *
 *   npx tsx scripts/outcome-chat-acceptance.ts --case build
 *   npx tsx scripts/outcome-chat-acceptance.ts --case repair
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {resolveDataPaths} from "../src/platform/paths.js";

const scenario=process.argv[process.argv.indexOf("--case")+1]==="repair"?"repair":"build";
const id="chat-"+randomUUID().slice(0,8);
const parent=path.join(resolveDataPaths().dataDir,"outcome-runs");
const root=path.join(parent,new Date().toISOString().replace(/[:.]/g,"-")+"-"+id);
const projects=path.join(root,"projects"),store=path.join(root,"store");
fs.mkdirSync(store,{recursive:true,mode:0o700});fs.mkdirSync(projects,{recursive:true,mode:0o700});
Object.assign(process.env,{
  LAYANX_WORKSPACE_ROOT:projects,LAYANX_STORE_DIR:store,LAYANX_DATA_DIR:root,LAYANX_DATABASE_URL:"",DATABASE_URL:"",
  LAYANX_BUSINESS_STORAGE_PATH:path.join(store,"business.json"),LAYANX_MEDIA_STORAGE_PATH:path.join(store,"media.json"),
  LAYANX_CREATOR_OUTPUT_DIR:path.join(store,"creator"),LAYANX_QURAN_OUTPUT_DIR:path.join(store,"quran"),
  LAYANX_FREE_POOL_CONFIG:path.join(store,"free-providers.json"),LAYANX_GOOGLE_INVOICE_REGISTRY:path.join(store,"google-invoices.json"),
  LAYANX_RUNTIME_STORAGE_PATH:path.join(store,"runtime.json"),LAYANX_LESSONS_FILE:path.join(store,"lessons.json"),
  LAYANX_PLAYBOOKS_DIR:path.join(store,"playbooks"),LAYANX_TRUST_FILE:path.join(root,"trust.json"),
  LAYANX_ISOLATION_FILE:path.join(root,"isolation.json"),LAYANX_SECRET_VAULT_PATH:path.join(store,"secrets.vault"),
  LAYANX_DEFAULT_TRUST:"trusted",LAYANX_DEFAULT_ISOLATION:"no-scripts",
  LAYANX_AI_MODE:"local",LAYANX_CAPABILITIES:"coding",LAYANX_FREE_POOL_ENABLED:"false",
  OPENAI_ENABLED:"false",ANTHROPIC_ENABLED:"false",GEMINI_ENABLED:"false",MT5_AUTO_START:"false",LAYANX_OPEN_BROWSER:"off",
  OLLAMA_MODEL:process.env.OLLAMA_MODEL||"gpt-oss:20b"
});
const model=process.env.OLLAMA_MODEL!;
process.env.LAYANX_OLLAMA_MODEL_PLAN??=JSON.stringify({general:model,planning:model,coding:model,fast:model});
const {discoverOllama,buildModelLadders}=await import("../src/providers/ollama-discovery.js");
process.env.LAYANX_OLLAMA_MODEL_LADDER=JSON.stringify(buildModelLadders(await discoverOllama(process.env.OLLAMA_BASE_URL,{timeoutMs:3000})));

const MAWID="C:/Users/Ryzen/AllwaaProjects/mawid-dawai",folder="mawid-chat";
const git=(cwd:string,...args:string[])=>{const r=spawnSync("git",args,{cwd,encoding:"utf8",windowsHide:true,maxBuffer:32*1024*1024});if(r.status!==0)throw new Error("git "+args.join(" ")+": "+r.stderr);return r.stdout;};
const originalState=()=>git(MAWID,"rev-parse","HEAD")+git(MAWID,"status","--porcelain");
const originalBefore=originalState();
if(scenario==="repair"){git(projects,"clone","--quiet","--no-hardlinks",MAWID,folder);git(path.join(projects,folder),"remote","remove","origin");}
const message=scenario==="build"
  ?"ابن لي تطبيق قائمة مهام بالعربية والإنجليزية"
  :`أصلح العطل في مشروع ${folder}: عند فتح الصفحة الرئيسية index.html في متصفح لم يستخدم التطبيق من قبل، يبقى مربع الجرعة القادمة فارغاً، والمفروض أن يعرض عبارة «لا توجد جرعة قادمة» دون أي خطأ. أصلحه بأقل تغيير ولا تحذف أي ميزة. قد يكون للعطل أكثر من سبب.`;

const {createRuntime}=await import("../src/runtime.js");
const {startRuntimeApi}=await import("../src/api-server.js");
const runtime=createRuntime({storagePath:process.env.LAYANX_RUNTIME_STORAGE_PATH}) as any;
const port=await new Promise<number>(resolve=>{const s=http.createServer().listen(0,"127.0.0.1",()=>{const p=(s.address() as {port:number}).port;s.close(()=>resolve(p));});});
startRuntimeApi({core:runtime.core,business:runtime.business,host:"127.0.0.1",port});
await new Promise(resolve=>setTimeout(resolve,500));
const api=`http://127.0.0.1:${port}`;
const say=async(text:string)=>(await fetch(api+"/v1/assistant/turn",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text,lang:"ar"})})).json() as Promise<any>;
const jobOf=async(jobId:string)=>{const result=await (await fetch(api+"/v1/supervisor/jobs")).json() as any;return result.jobs.find((j:any)=>j.id===jobId);};

const finish=(result:Record<string,unknown>)=>{
  const reportFile=path.join(root,"chat-result.json");
  const body={at:new Date().toISOString(),scenario,message,originalUntouched:originalState()===originalBefore,...result};
  fs.writeFileSync(reportFile,JSON.stringify(body,null,2),{mode:0o600});
  console.log(JSON.stringify({reportFile,...body},null,2));
  process.exit(body.ok===true&&body.originalUntouched?0:1);
};

const startedAt=Date.now();
const first=await say(message);
console.log("first reply:",JSON.stringify(first));
if(!first.job)finish({ok:false,stage:"routing",first});
const terminal=new Set(["completed","failed","cancelled","budget_exhausted","waiting_approval"]);
const replies:string[]=[];
let job:any;
while(Date.now()-startedAt<30*60_000){
  await new Promise(resolve=>setTimeout(resolve,20_000));
  job=await jobOf(first.job.id);
  const status=await say("وين وصل المشروع؟");
  if(replies.at(-1)!==status.reply){replies.push(status.reply);console.log("status:",status.reply);}
  if(terminal.has(job?.status))break;
}
const finalReply=(await say("وين وصل المشروع؟")).reply as string;
const workspace=path.join(projects,first.job.projectId);
let independent:any;
if(scenario==="build"){
  const {verifyTaskApp}=await import("../src/autonomy/task-app-verifier.js");
  independent=await verifyTaskApp(workspace);
}else{
  const mime:Record<string,string>={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8"};
  const server=http.createServer((request,response)=>{
    const file=path.join(workspace,decodeURIComponent(new URL(request.url??"/","http://x").pathname));
    if(!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);response.end();return;}
    response.writeHead(200,{"content-type":mime[path.extname(file)]??"application/octet-stream"});response.end(fs.readFileSync(file));
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",()=>resolve()));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/`;
  const pw:any=await import("playwright-core");const chromium=pw.chromium??pw.default?.chromium;
  const browser=await chromium.launch({headless:true,channel:"msedge"}).catch(()=>chromium.launch({headless:true,channel:"chrome"}));
  const open=async(file:string,seed?:Record<string,string>)=>{
    const context=await browser.newContext();
    if(seed)await context.addInitScript((items:Record<string,string>)=>{for(const[k,v]of Object.entries(items))localStorage.setItem(k,v);},seed);
    const page=await context.newPage();const errors:string[]=[];page.on("pageerror",(e:Error)=>errors.push(e.message));
    await page.goto(base+file,{waitUntil:"load"});await page.waitForTimeout(600);
    return{page,errors,context};
  };
  const home=await open("index.html");
  const nextDose=(await home.page.locator("#next-dose").innerText().catch(()=>"")).trim();
  const saved=await open("medications.html",{medicationAppData:JSON.stringify({medications:[{id:"m1",name:"Panadol-X",dose:"500mg",instructions:"after food",start:"2026-01-01",end:"2026-12-31",enabled:true,occurrences:[]}],occurrences:[]})});
  const list=await saved.page.locator("#medications-list").innerText().catch(()=>"");
  independent={ok:nextDose.includes("لا توجد جرعة قادمة")&&!home.errors.length&&list.includes("Panadol-X")&&!saved.errors.length,nextDose,homeErrors:home.errors,savedErrors:saved.errors};
  await browser.close();server.close();
}
const completed=job?.status==="completed";
const replyHonest=completed?/اكتمل المشروع|دون إثبات/.test(finalReply):/لم يكتمل|توقف|بانتظار|قيد العمل/.test(finalReply);
finish({ok:completed&&independent?.ok===true&&replyHonest,falseSuccess:completed&&independent?.ok!==true,jobStatus:job?.status,minutes:Math.round((Date.now()-startedAt)/6000)/10,projectId:first.job.projectId,firstReply:first.reply,statusReplies:replies,finalReply,replyHonest,independent:scenario==="build"?{ok:independent?.ok,blockers:independent?.blockers}:independent,handoffs:job?.modelRun?.handoffs?.length??0,checkpoints:job?.checkpoints?.length??0,result:job?.result});
