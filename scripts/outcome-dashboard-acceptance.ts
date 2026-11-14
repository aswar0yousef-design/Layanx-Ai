/**
 * Dashboard acceptance. Sends one real chat message asking for a professional dashboard to POST /v1/assistant/turn on a
 * disposable runtime, waits for the supervisor job, then judges the project itself (not LayanX's word):
 *   npm install / npm test / npm run build in a copy, then a real browser on the built page at 1280px and 375px,
 *   in English and Arabic: no page errors, no horizontal page scroll, the owner's domain words visible, the kit's
 *   sample companies replaced, screenshots kept for a human look.
 * Trust is raised only inside this disposable run; the product default stays "supervised".
 *   npx tsx scripts/outcome-dashboard-acceptance.ts
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {resolveDataPaths} from "../src/platform/paths.js";

const id="dash-"+randomUUID().slice(0,8);
const root=path.join(resolveDataPaths().dataDir,"outcome-runs",new Date().toISOString().replace(/[:.]/g,"-")+"-"+id);
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

const message="ابن لي لوحة تحكم احترافية لمتجر ملابس: مبيعات اليوم، الطلبات وحالتها، المنتجات الأكثر مبيعاً، والعملاء، بالعربية والإنجليزية";
const DOMAIN_EN=/orders?/i,DOMAIN_AR=/الطلبات|طلبات/;
const KIT_SAMPLES=/Northwind Freight|Helix Labs|Saha Clinics|Pixel Forge/;

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
  const body={at:new Date().toISOString(),message,root,...result};
  fs.writeFileSync(path.join(root,"dashboard-result.json"),JSON.stringify(body,null,2),{mode:0o600});
  console.log(JSON.stringify(body,null,2));
  process.exit(body.ok===true?0:1);
};

const startedAt=Date.now();
const first=await say(message);
console.log("first reply:",JSON.stringify(first).slice(0,500));
if(!first.job)finish({ok:false,stage:"routing",first});
const terminal=new Set(["completed","failed","cancelled","budget_exhausted","waiting_approval"]);
let job:any,lastAt="";
while(Date.now()-startedAt<45*60_000){
  await new Promise(resolve=>setTimeout(resolve,20_000));
  job=await jobOf(first.job.id);
  for(const l of (job?.log??[]).filter((x:any)=>x.at>lastAt))console.log("job:",String(l.msg).slice(0,300));
  lastAt=(job?.log??[]).at(-1)?.at??lastAt;
  if(terminal.has(job?.status))break;
}
const workspace=path.join(projects,first.job.projectId);

// ---------------------------------------------------------------- the independent judge
const judgeDir=path.join(root,"judge");
fs.cpSync(workspace,judgeDir,{recursive:true,filter:src=>!/[\\/](node_modules|dist|\.git)([\\/]|$)/.test(src)});
const npm=(args:string[])=>{const r=spawnSync(process.platform==="win32"?"npm.cmd":"npm",args,{cwd:judgeDir,encoding:"utf8",shell:process.platform==="win32",windowsHide:true,timeout:10*60_000});return{ok:r.status===0,tail:(r.stdout+r.stderr).slice(-1500)};};
const usedKit=fs.existsSync(path.join(judgeDir,"KIT.md"))&&fs.existsSync(path.join(judgeDir,"src","components","Shell.jsx"));
const install=fs.existsSync(path.join(judgeDir,"package.json"))?npm(["install","--no-audit","--no-fund"]):{ok:false,tail:"no package.json"};
const test=install.ok?npm(["test"]):{ok:false,tail:"skipped"};
const build=install.ok?npm(["run","build"]):{ok:false,tail:"skipped"};
const source=(()=>{try{return ["src/data.js","src/i18n.js"].map(f=>fs.readFileSync(path.join(judgeDir,f),"utf8")).join("\n");}catch{return"";}})();
const browser:any={};
if(build.ok){
  const dist=path.join(judgeDir,"dist");
  const mime:Record<string,string>={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".svg":"image/svg+xml"};
  const server=http.createServer((req,res)=>{let p=decodeURIComponent(new URL(req.url??"/","http://x").pathname);if(p==="/")p="/index.html";const f=path.join(dist,p);
    if(!f.startsWith(dist)||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404);res.end();return;}res.writeHead(200,{"content-type":mime[path.extname(f)]??"application/octet-stream"});res.end(fs.readFileSync(f));});
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",()=>r()));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/`;
  const pw:any=await import("playwright-core");const chromium=pw.chromium??pw.default?.chromium;
  const b=await chromium.launch({headless:true,channel:"msedge"}).catch(()=>chromium.launch({headless:true,channel:"chrome"}));
  for(const lang of ["en","ar"])for(const [name,viewport] of [["desktop",{width:1280,height:860}],["phone",{width:375,height:812}]] as const){
    const context=await b.newContext({viewport});
    await context.addInitScript((l:string)=>{try{localStorage.setItem("dash.lang",l);}catch{}},lang);
    const page=await context.newPage();const errors:string[]=[];
    page.on("pageerror",(e:Error)=>errors.push(e.message));page.on("console",(m:any)=>{if(m.type()==="error"&&!/fonts\.g/.test(m.text()))errors.push(m.text());});
    await page.goto(base,{waitUntil:"networkidle"}).catch(()=>page.goto(base,{waitUntil:"load"}));
    await page.waitForTimeout(1500);
    const m=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,dir:document.documentElement.dir,text:document.body.innerText.slice(0,4000)}));
    const shot=path.join(root,`shot-${lang}-${name}.png`);await page.screenshot({path:shot,fullPage:false});
    browser[`${lang}-${name}`]={errors,overflow:m.sw>m.cw+1,dir:m.dir,domain:(lang==="en"?DOMAIN_EN:DOMAIN_AR).test(m.text),shot};
    await context.close();
  }
  await b.close();server.close();
}
const views=Object.values(browser) as any[];
const pageOk=views.length===4&&views.every(v=>!v.errors.length&&!v.overflow&&v.domain)&&browser["ar-desktop"]?.dir==="rtl";
const tailored=Boolean(source)&&!KIT_SAMPLES.test(source);
const completed=job?.status==="completed";
const ok=completed&&usedKit&&install.ok&&test.ok&&build.ok&&pageOk&&tailored;
finish({ok,falseSuccess:completed&&!ok,jobStatus:job?.status,jobResult:String(job?.result??"").slice(0,800),minutes:Math.round((Date.now()-startedAt)/6000)/10,
  projectId:first.job.projectId,usedKit,tailored,install:install.ok?"ok":install.tail,test:test.ok?"ok":test.tail,build:build.ok?"ok":build.tail,browser,
  milestones:(job?.milestones??[]).map((m:any)=>`${m.status} ${m.attempts}x ${m.title}`)});
