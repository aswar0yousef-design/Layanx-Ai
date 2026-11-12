/**
 * The general build path: requests that name a store, a server or Python go there (voice/project-intent.ts newProjectKind),
 * not to the measured test-first paths. LayanX builds from the owner's words through its supervisor and a real local model;
 * this script judges from outside with checks LayanX never sees: a real browser, real HTTP calls, real files.
 *
 *   npx tsx scripts/outcome-general-build-acceptance.ts --runs 1 [--case store]
 */
import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {spawn,spawnSync} from "node:child_process";
import {resolveDataPaths} from "../src/platform/paths.js";

const arg=(name:string)=>{const i=process.argv.indexOf("--"+name);return i>=0?process.argv[i+1]:undefined;};
type Verdict=Array<{check:string;ok:boolean;detail?:string}>;
interface Case{id:string;goal:string;judge(dir:string):Promise<Verdict>}
const num=(text:string)=>{const m=/(\d+(?:[.,]\d+)?)/.exec(text.replace(/[٠-٩]/g,d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));return m?Number(m[1]!.replace(",",".")):NaN;};

async function storeJudge(dir:string):Promise<Verdict>{
  const verdict:Verdict=[];
  const file=path.join(dir,"index.html");
  if(!fs.existsSync(file))return[{check:"index.html exists",ok:false}];
  const {serveStatic}=await import("../src/autonomy/repair-engine.js");
  const served=await serveStatic(dir);
  const pw:any=await import("playwright-core");
  const chromium=pw.chromium??pw.default?.chromium;
  const browser=await chromium.launch({headless:true,channel:"msedge"}).catch(()=>chromium.launch({headless:true,channel:"chrome"}));
  try{
    const page=await browser.newPage();const errors:string[]=[];page.on("pageerror",(e:Error)=>errors.push(e.message));
    await page.goto(served.base+"index.html",{waitUntil:"load"});await page.waitForTimeout(300);
    const buttons=page.getByRole("button",{name:/أضف\s*(?:إلى|الى|ل)\s*السلة/});
    const count=await buttons.count();
    verdict.push({check:"at least 3 add-to-cart buttons",ok:count>=3,detail:String(count)});
    if(count>=2){
      // Each product's price: the first number in the smallest block around its button that holds a number.
      const priceOf=async(i:number)=>num(await buttons.nth(i).evaluate((b:Element)=>{let e:Element|null=b.parentElement;while(e&&!/\d/.test((e as HTMLElement).innerText.replace(b.textContent??"","")))e=e.parentElement;return e?(e as HTMLElement).innerText.replace(b.textContent??"",""):"";}));
      const p1=await priceOf(0),p2=await priceOf(1);
      verdict.push({check:"each product shows a price",ok:p1>0&&p2>0,detail:`${p1}, ${p2}`});
      await buttons.nth(0).click();await buttons.nth(1).click();await buttons.nth(0).click();await page.waitForTimeout(300);
      const text:string=await page.locator("body").innerText();
      const total=2*p1+p2,shown=[...text.matchAll(/\d+(?:[.,]\d+)?/g)].map(m=>Number(m[0].replace(",",".")));
      verdict.push({check:"cart total after adding 2 + 1",ok:shown.some(n=>Math.abs(n-total)<0.01),detail:`expected ${total}`});
      // Diacritics removed first: the page LayanX built wrote "السلّة" (with shadda) and the first judge missed it.
      const plain=text.replace(/[ً-ْـ]/g,"");
      verdict.push({check:"cart shows 3 items",ok:/(?:^|\D)3\s*(?:قطع|قطعة|منتجات|عناصر|items?|pcs)|(?:عدد|count|items?)[^\d]{0,20}3(?:\D|$)/i.test(plain),detail:plain.slice(0,200).replace(/\s+/g," ")});
    }
    verdict.push({check:"no page errors",ok:!errors.length,detail:errors.slice(0,2).join("; ")});
  }finally{await browser.close();await served.close?.();}
  return verdict;
}

async function apiJudge(dir:string):Promise<Verdict>{
  const entry=path.join(dir,"src","server.mjs");
  if(!fs.existsSync(entry))return[{check:"src/server.mjs exists",ok:false}];
  const port=41000+Math.floor(Math.random()*900);
  const child=spawn(process.execPath,[entry],{cwd:dir,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:"ignore"});
  const verdict:Verdict=[];
  const call=async(method:string,url:string,body?:unknown)=>{const r=await fetch(`http://127.0.0.1:${port}${url}`,{method,headers:{"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000)});const t=await r.text();let j:any;try{j=JSON.parse(t);}catch{j=undefined;}return{status:r.status,json:j};};
  try{
    let up=false;for(let i=0;i<40&&!up;i++){try{await fetch(`http://127.0.0.1:${port}/shipments`,{signal:AbortSignal.timeout(500)});up=true;}catch{await new Promise(r=>setTimeout(r,250));}}
    verdict.push({check:"server starts on PORT",ok:up});
    if(!up)return verdict;
    const made=await call("POST","/shipments",{tracking:"YE-1001",city:"عدن"});
    const shipment=made.json?.shipment??made.json;
    verdict.push({check:"POST returns the shipment with id and status new",ok:made.status<300&&shipment?.id!==undefined&&shipment?.status==="new"&&shipment?.tracking==="YE-1001",detail:JSON.stringify(made.json)?.slice(0,200)});
    await call("POST","/shipments",{tracking:"YE-1002",city:"صنعاء"});
    const all=await call("GET","/shipments");
    const list=Array.isArray(all.json)?all.json:all.json?.shipments;
    verdict.push({check:"GET lists both shipments",ok:Array.isArray(list)&&list.length===2&&list.some((s:any)=>s.city==="صنعاء"),detail:JSON.stringify(all.json)?.slice(0,200)});
    const changed=await call("PATCH",`/shipments/${shipment?.id}`,{status:"delivered"});
    const after=await call("GET","/shipments");
    const again=(Array.isArray(after.json)?after.json:after.json?.shipments)??[];
    // Found by tracking number, as the request words it (a list without ids was first judged a failure, 2026-11-12).
    verdict.push({check:"PATCH changes the status",ok:changed.status<300&&again.some((s:any)=>s.tracking==="YE-1001"&&s.status==="delivered")&&!again.some((s:any)=>s.tracking==="YE-1002"&&s.status==="delivered"),detail:JSON.stringify(after.json)?.slice(0,200)});
    const missing=await call("PATCH","/shipments/does-not-exist",{status:"x"});
    verdict.push({check:"unknown shipment is 404",ok:missing.status===404,detail:String(missing.status)});
  }catch(error){verdict.push({check:"HTTP calls work",ok:false,detail:(error as Error).message.slice(0,200)});}
  finally{child.kill();}
  return verdict;
}

async function pythonJudge(dir:string):Promise<Verdict>{
  const script=path.join(dir,"sum_column.py");
  if(!fs.existsSync(script))return[{check:"sum_column.py exists",ok:false}];
  const tmp=fs.mkdtempSync(path.join(dir,"..","judge-"));
  const csv=(name:string,text:string)=>{const f=path.join(tmp,name);fs.writeFileSync(f,text);return f;};
  const run=(...a:string[])=>spawnSync("python",[script,...a],{encoding:"utf8",windowsHide:true,timeout:15000});
  const verdict:Verdict=[];
  const a=run(csv("a.csv","name,amount,city\nx,10,Aden\ny,20.5,Sanaa\nz,30,Taiz\n"),"amount");
  verdict.push({check:"sums a column",ok:a.status===0&&Math.abs(Number(a.stdout.trim())-60.5)<1e-9,detail:(a.stdout+a.stderr).slice(0,200)});
  const b=run(csv("b.csv","qty,price\n1,2\n3,4\n"),"price");
  verdict.push({check:"picks the named column",ok:b.status===0&&Math.abs(Number(b.stdout.trim())-6)<1e-9,detail:(b.stdout+b.stderr).slice(0,200)});
  const c=run(csv("c.csv","qty,price\n1,2\n"),"missing");
  verdict.push({check:"a missing column is an error",ok:c.status!==0,detail:String(c.status)});
  fs.rmSync(tmp,{recursive:true,force:true});
  return verdict;
}

const CASES:Case[]=[
  {id:"store",judge:storeJudge,goal:"ابن لي صفحة متجر عطور في ملف index.html: تعرض 3 عطور على الأقل، لكل عطر اسم وسعر بالريال وزر «أضف إلى السلة». في الصفحة سلة تعرض عدد القطع والمجموع بالريال، وتتحدث فوراً عند كل إضافة."},
  {id:"shipments-api",judge:apiJudge,goal:"اعمل لي خادم Node لإدارة الشحنات في الملف src/server.mjs بدون مكتبات خارجية، يعمل على المنفذ من متغير البيئة PORT. POST /shipments يستقبل JSON فيه tracking وcity ويرجع الشحنة ومعها id وstatus يساوي \"new\". GET /shipments يرجع مصفوفة كل الشحنات. PATCH /shipments/:id يغيّر status ويرجع 404 إذا لم توجد الشحنة."},
  {id:"python-csv",judge:pythonJudge,goal:"اكتب لي سكربت بايثون اسمه sum_column.py: يأخذ مسار ملف CSV واسم عمود، ويطبع مجموع ذلك العمود كرقم فقط. السطر الأول في الملف أسماء الأعمدة. إذا لم يوجد العمود يطبع رسالة خطأ ويخرج برمز غير صفر."}
];

async function runOne(selected:Case){
  const id="general-"+selected.id+"-"+randomUUID().slice(0,6);
  const parent=path.join(resolveDataPaths().dataDir,"outcome-runs");
  const root=path.join(parent,new Date().toISOString().replace(/[:.]/g,"-")+"-"+id);
  const projects=path.join(root,"projects"),store=path.join(root,"store"),workspace=path.join(projects,id);
  fs.mkdirSync(store,{recursive:true,mode:0o700});fs.mkdirSync(workspace,{recursive:true,mode:0o700});
  Object.assign(process.env,{
    LAYANX_WORKSPACE_ROOT:projects,LAYANX_STORE_DIR:store,LAYANX_DATA_DIR:root,LAYANX_DATABASE_URL:"",DATABASE_URL:"",
    LAYANX_BUSINESS_STORAGE_PATH:path.join(store,"business.json"),LAYANX_RUNTIME_STORAGE_PATH:path.join(store,"runtime.json"),
    LAYANX_LESSONS_FILE:path.join(store,"lessons.json"),LAYANX_PLAYBOOKS_DIR:path.join(store,"playbooks"),LAYANX_TRUST_FILE:path.join(root,"trust.json"),
    LAYANX_ISOLATION_FILE:path.join(root,"isolation.json"),LAYANX_SECRET_VAULT_PATH:path.join(store,"secrets.vault"),LAYANX_FREE_POOL_CONFIG:path.join(store,"free-providers.json"),
    LAYANX_AI_MODE:"local",LAYANX_CAPABILITIES:"coding",LAYANX_FREE_POOL_ENABLED:"false",OPENAI_ENABLED:"false",ANTHROPIC_ENABLED:"false",GEMINI_ENABLED:"false",MT5_AUTO_START:"false",LAYANX_OPEN_BROWSER:"off",
    OLLAMA_MODEL:process.env.OLLAMA_MODEL||"gpt-oss:20b"
  });
  const model=process.env.OLLAMA_MODEL!;
  process.env.LAYANX_OLLAMA_MODEL_PLAN??=JSON.stringify({general:model,planning:model,coding:model,fast:model});
  const {discoverOllama,buildModelLadders}=await import("../src/providers/ollama-discovery.js");
  process.env.LAYANX_OLLAMA_MODEL_LADDER=JSON.stringify(buildModelLadders(await discoverOllama(process.env.OLLAMA_BASE_URL,{timeoutMs:3000})));
  const {setTrust}=await import("../src/autonomy/trust.js");
  const {setIsolation}=await import("../src/autonomy/sandbox.js");
  const {createRuntime}=await import("../src/runtime.js");
  const {Supervisor}=await import("../src/autonomy/supervisor.js");
  const {coreSupervisorDeps}=await import("../src/autonomy/runtime-deps.js");
  const {newProjectKind}=await import("../src/voice/project-intent.js");
  setTrust(process.env.LAYANX_TRUST_FILE,id,"trusted");setIsolation(process.env.LAYANX_ISOLATION_FILE,id,"no-scripts");
  const runtime=createRuntime({storagePath:process.env.LAYANX_RUNTIME_STORAGE_PATH});
  const supervisor=new Supervisor(coreSupervisorDeps(runtime.core),{file:path.join(store,"supervisor-jobs.json"),pollMs:500});
  const started=Date.now();
  // Exactly what the chat does for a "general" request: no acceptance profile.
  const kind=newProjectKind(selected.goal);
  const {HTTP_API_PROFILE,NODE_TOOL_PROFILE,STATIC_SITE_PROFILE}=await import("../src/autonomy/project-build.js");
  const profile=kind==="static-site"?STATIC_SITE_PROFILE:kind==="node-tool"?NODE_TOOL_PROFILE:kind==="http-api"?HTTP_API_PROFILE:kind==="task-app"?"task-app-http-v1":undefined;
  const job=supervisor.create(selected.goal,id,{maxMinutes:25,maxRounds:14,openWhenDone:false,...(profile?{acceptanceProfile:profile as never}:{})});
  let seen=0;
  while(["planning","running","verifying","queued"].includes(job.status)&&Date.now()-started<26*60_000){
    await new Promise(r=>setTimeout(r,1000));
    for(const entry of job.log.slice(seen))console.error("[job] "+entry.msg.slice(0,240));
    seen=job.log.length;
  }
  supervisor.stop();
  const verdict:Verdict=await selected.judge(workspace).catch((error:Error)=>[{check:"judge ran",ok:false,detail:error.message.slice(0,300)}]);
  const works=verdict.length>0&&verdict.every(v=>v.ok),claimed=job.status==="completed";
  const record={case:selected.id,kind,profile:profile??"general",ok:works&&claimed,falseSuccess:claimed&&!works,jobStatus:job.status,minutes:Math.round((Date.now()-started)/6000)/10,works,claimed,
    verdict,milestones:job.milestones.map((m:any)=>({title:m.title,kind:m.kind,status:m.status,attempts:m.attempts})),handoffs:job.modelRun?.handoffs.length??0,
    files:fs.readdirSync(workspace,{recursive:true}).map(String).filter(f=>!/node_modules|\.git[\\/]|\.layanx/.test(f)).slice(0,30),
    result:job.result?.slice(0,800),log:job.log.slice(-16).map((l:any)=>l.msg.slice(0,260)),workspace};
  const file=path.join(root,"general-result.json");
  fs.writeFileSync(file,JSON.stringify(record,null,2),{mode:0o600});
  console.log("RESULT_FILE="+file);
}

// Check a judge on a folder (used to prove each judge passes a correct solution before LayanX is measured).
if(process.argv.includes("--judge")){
  const c=CASES.find(x=>x.id===arg("judge"))!;
  const v=await c.judge(path.resolve(process.argv[process.argv.indexOf("--judge")+2]!));
  console.log(JSON.stringify(v,null,1));process.exit(v.every(x=>x.ok)?0:1);
}
if(process.argv.includes("--one")){
  await runOne(CASES.find(c=>c.id===arg("one"))!);
  process.exit(0);
}
const runs=Number(arg("runs")??"1"),only=arg("case");
const records:any[]=[];
for(const selected of CASES.filter(c=>!only||c.id===only))for(let i=1;i<=runs;i++){
  console.log(`=== ${selected.id} run ${i}/${runs}`);
  const child=spawnSync(process.execPath,[...process.execArgv,process.argv[1]!,"--one",selected.id],{encoding:"utf8",windowsHide:true,timeout:32*60_000,maxBuffer:128*1024*1024});
  const file=/RESULT_FILE=(.+)/.exec(child.stdout??"")?.[1]?.trim();
  const record=file&&fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):{case:selected.id,ok:false,stage:"process",exit:child.status,stderr:(child.stderr??"").slice(-1500)};
  records.push(record);
  console.log(JSON.stringify({case:record.case,kind:record.kind,profile:record.profile,ok:record.ok,status:record.jobStatus,works:record.works,falseSuccess:record.falseSuccess,minutes:record.minutes,failed:record.verdict?.filter((v:any)=>!v.ok),result:record.ok?undefined:record.result?.slice(0,300),stderr:record.stderr}));
}
const summary={runs:records.length,passed:records.filter(r=>r.ok).length,falseSuccess:records.filter(r=>r.falseSuccess).length,byCase:Object.fromEntries(CASES.filter(c=>!only||c.id===only).map(c=>[c.id,`${records.filter(r=>r.case===c.id&&r.ok).length}/${records.filter(r=>r.case===c.id).length}`]))};
const out=path.join(resolveDataPaths().dataDir,"outcome-runs","general-build-batch-"+new Date().toISOString().replace(/[:.]/g,"-")+".json");
fs.writeFileSync(out,JSON.stringify({summary,records},null,2),{mode:0o600});
console.log(JSON.stringify({report:out,summary},null,2));
process.exit(summary.passed===summary.runs?0:1);
