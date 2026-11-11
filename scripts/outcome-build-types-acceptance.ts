/**
 * New projects of other kinds. LayanX builds from the owner's words alone through its supervisor and a real local model.
 * This script then judges from outside, with checks LayanX never sees: real command lines for a program, and a real
 * browser driven by order and label for a page, so the judge does not depend on any name the model chose.
 *
 *   npx tsx scripts/outcome-build-types-acceptance.ts --runs 3 [--case roman]
 */
import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {resolveDataPaths} from "../src/platform/paths.js";

const arg=(name:string)=>{const i=process.argv.indexOf("--"+name);return i>=0?process.argv[i+1]:undefined;};
type Verdict=Array<{check:string;ok:boolean;detail?:string}>;
interface Case{id:string;profile:"node-tool-v1"|"static-site-v1";goal:string;judge(dir:string):Promise<Verdict>}

function program(dir:string,args:string[],input=""){
  const run=spawnSync(process.execPath,[path.join(dir,"src/index.mjs"),...args],{input,encoding:"utf8",windowsHide:true,timeout:15_000});
  return{code:run.status,out:(run.stdout??"").trim(),err:run.stderr??""};
}
const same=(check:string,got:unknown,want:unknown)=>({check,ok:JSON.stringify(got)===JSON.stringify(want),detail:JSON.stringify(got)?.slice(0,200)});
const parsed=(text:string)=>{try{return JSON.parse(text);}catch{return undefined;}};

async function inBrowser(dir:string,drive:(page:any,verdict:Verdict)=>Promise<void>):Promise<Verdict>{
  const {serveStatic}=await import("../src/autonomy/repair-engine.js");
  const served=await serveStatic(dir);
  const pw:any=await import("playwright-core");
  const chromium=pw.chromium??pw.default?.chromium;
  const browser=await chromium.launch({headless:true,channel:"msedge"}).catch(()=>chromium.launch({headless:true,channel:"chrome"}));
  const verdict:Verdict=[];
  try{
    const context=await browser.newContext({viewport:{width:390,height:844}});
    const page=await context.newPage();
    const errors:string[]=[];
    page.on("pageerror",(e:Error)=>errors.push(e.message));
    await page.goto(served.base+"index.html",{waitUntil:"load",timeout:20000});
    await page.waitForTimeout(300);
    await drive(page,verdict).catch((error:Error)=>verdict.push({check:"judge could use the page",ok:false,detail:error.message.split("\n")[0]!.slice(0,300)}));
    verdict.push({check:"no page errors",ok:!errors.length,detail:errors.slice(0,3).join("; ")});
    verdict.push({check:"fits a phone",ok:await page.evaluate("document.documentElement.scrollWidth<=window.innerWidth+2")});
  }finally{await browser.close().catch(()=>undefined);await served.close();}
  return verdict;
}
const body=(page:any)=>page.locator("body").innerText() as Promise<string>;
const buttonNamed=(page:any,name:string)=>page.getByRole("button",{name}).first();

const CASES:Case[]=[
  {id:"roman",profile:"node-tool-v1",goal:"اصنع برنامج سطر أوامر يحول رقماً إلى أرقام رومانية. يأخذ الرقم وسيطاً واحداً ويطبع الناتج فقط، مثل 1994 يعطي MCMXCIV. إذا كان الرقم خارج المدى من 1 إلى 3999 أو ليس رقماً صحيحاً يطبع رسالة خطأ على stderr ويخرج برمز 1.",
   judge:async dir=>[same("1",program(dir,["1"]).out,"I"),same("4",program(dir,["4"]).out,"IV"),same("3999",program(dir,["3999"]).out,"MMMCMXCIX"),same("2024",program(dir,["2024"]).out,"MMXXIV"),same("0 refused",program(dir,["0"]).code,1),same("abc refused",program(dir,["abc"]).code,1),same("4000 refused",program(dir,["4000"]).code,1)]},
  {id:"wordcount",profile:"node-tool-v1",goal:'Build a command-line program that reads text from standard input and prints one line of JSON with the keys lines, words and chars. chars counts characters, words are separated by any whitespace, and lines is the number of newline characters. Empty input prints {"lines":0,"words":0,"chars":0}.',
   judge:async dir=>[same("two lines",parsed(program(dir,[],"hello world\nفي البيت\n").out),{lines:2,words:4,chars:21}),same("empty",parsed(program(dir,[],"").out),{lines:0,words:0,chars:0}),same("extra spaces",parsed(program(dir,[],"  a   b\t c  ").out)?.words,3),same("exit 0",program(dir,[],"x").code,0)]},
  {id:"csv",profile:"node-tool-v1",goal:'Create a command-line tool that reads CSV from standard input and prints a JSON array of objects, using the first row as the keys. Quoted fields may contain commas and doubled quotes ("" means one "). All values stay strings. Input with only a header prints []. Input that is completely empty exits with code 1.',
   judge:async dir=>[same("basic",parsed(program(dir,[],"a,b\n1,2\n3,4\n").out),[{a:"1",b:"2"},{a:"3",b:"4"}]),same("quoted comma",parsed(program(dir,[],'name,note\n"Ali, Sr.",ok\n').out),[{name:"Ali, Sr.",note:"ok"}]),same("doubled quote",parsed(program(dir,[],'x\n"say ""hi"""\n').out),[{x:'say "hi"'}]),same("header only",parsed(program(dir,[],"a,b\n").out),[]),same("empty fails",program(dir,[],"").code,1)]},
  {id:"tip",profile:"static-site-v1",goal:"اصنع صفحة حاسبة: حقل رقم للمبلغ، ثم حقل رقم لنسبة الإكرامية، وزر مكتوب عليه احسب. عند الضغط يظهر الإجمالي (المبلغ مضافاً إليه النسبة) في الصفحة.",
   judge:dir=>inBrowser(dir,async(page,verdict)=>{
     const inputs=page.locator("input");
     await inputs.nth(0).fill("200");await inputs.nth(1).fill("15");
     await buttonNamed(page,"احسب").click({timeout:5000});await page.waitForTimeout(300);
     verdict.push({check:"200 with 15% shows 230",ok:/230/.test((await body(page)).replace(/[٠-٩]/g,(d:string)=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))),detail:(await body(page)).slice(0,200)});
     await inputs.nth(0).fill("80");await inputs.nth(1).fill("25");
     await buttonNamed(page,"احسب").click({timeout:5000});await page.waitForTimeout(300);
     verdict.push({check:"80 with 25% shows 100",ok:/\b100\b/.test(await body(page)),detail:(await body(page)).slice(0,200)});
   })},
  {id:"counter",profile:"static-site-v1",goal:"اصنع صفحة عداد فيها رقم يبدأ من صفر وثلاثة أزرار مكتوب عليها: زيادة، نقصان، تصفير. يجب أن تبقى القيمة محفوظة بعد إعادة تحميل الصفحة.",
   judge:dir=>inBrowser(dir,async(page,verdict)=>{
     const shown=async()=>[...(await body(page)).matchAll(/-?\d+/g)].map(m=>m[0]);
     for(let i=0;i<3;i++)await buttonNamed(page,"زيادة").click({timeout:5000});
     await buttonNamed(page,"نقصان").click({timeout:5000});await page.waitForTimeout(200);
     verdict.push({check:"three up and one down is 2",ok:(await shown()).includes("2"),detail:(await shown()).join(",")});
     await page.reload({waitUntil:"load"});await page.waitForTimeout(300);
     verdict.push({check:"still 2 after reload",ok:(await shown()).includes("2"),detail:(await shown()).join(",")});
     await buttonNamed(page,"تصفير").click({timeout:5000});await page.waitForTimeout(200);
     verdict.push({check:"reset shows 0",ok:(await shown()).includes("0")&&!(await shown()).includes("2"),detail:(await shown()).join(",")});
   })},
  {id:"landing",profile:"static-site-v1",goal:"اصنع موقع صفحة واحدة لمقهى اسمه «قهوة الوادي». فيها قائمة بثلاثة أصناف بأسعارها: قهوة عربية 8 ريال، شاي 5 ريال، كيك 12 ريال. وفيها نموذج حجز بحقل الاسم وحقل الجوال وزر مكتوب عليه احجز. عند الضغط مع تعبئة الحقلين تظهر رسالة «تم استلام طلبك»، وإذا كان الاسم فارغاً تظهر رسالة «الاسم مطلوب» ولا تظهر رسالة الاستلام.",
   judge:dir=>inBrowser(dir,async(page,verdict)=>{
     const text=await body(page);
     verdict.push({check:"name and menu shown",ok:/قهوة الوادي/.test(text)&&/قهوة عربية/.test(text)&&/شاي/.test(text)&&/كيك/.test(text)&&/12/.test(text),detail:text.slice(0,200)});
     const inputs=page.locator("input");
     await inputs.nth(1).fill("0500000000");
     await buttonNamed(page,"احجز").click({timeout:5000});await page.waitForTimeout(300);
     verdict.push({check:"empty name refused",ok:/الاسم مطلوب/.test(await body(page))&&!/تم استلام طلبك/.test(await body(page)),detail:(await body(page)).slice(-120)});
     await inputs.nth(0).fill("سارة");
     await buttonNamed(page,"احجز").click({timeout:5000});await page.waitForTimeout(300);
     verdict.push({check:"booking confirmed",ok:/تم استلام طلبك/.test(await body(page)),detail:(await body(page)).slice(-120)});
   })}
];

async function runOne(selected:Case){
  const id="build-"+selected.id+"-"+randomUUID().slice(0,6);
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
  setTrust(process.env.LAYANX_TRUST_FILE,id,"trusted");setIsolation(process.env.LAYANX_ISOLATION_FILE,id,"no-scripts");
  const runtime=createRuntime({storagePath:process.env.LAYANX_RUNTIME_STORAGE_PATH});
  const supervisor=new Supervisor(coreSupervisorDeps(runtime.core),{file:path.join(store,"supervisor-jobs.json"),pollMs:500});
  const started=Date.now();
  const job=supervisor.create(selected.goal,id,{maxMinutes:25,maxRounds:14,openWhenDone:false,acceptanceProfile:selected.profile});
  while(["planning","running","verifying","queued"].includes(job.status)&&Date.now()-started<26*60_000)await new Promise(r=>setTimeout(r,1000));
  supervisor.stop();
  const verdict:Verdict=await selected.judge(workspace).catch((error:Error)=>[{check:"judge ran",ok:false,detail:error.message.slice(0,300)}]);
  const works=verdict.length>0&&verdict.every(v=>v.ok),claimed=job.status==="completed";
  const patches=job.log.filter((l:any)=>/^Patch from/.test(l.msg)).length,undone=job.log.filter((l:any)=>/^Patch undone/.test(l.msg)).length;
  const record={case:selected.id,profile:selected.profile,ok:works&&claimed,falseSuccess:claimed&&!works,jobStatus:job.status,minutes:Math.round((Date.now()-started)/6000)/10,works,claimed,patches,undone,attempts:job.milestones.map((m:any)=>m.attempts),handoffs:job.modelRun?.handoffs.length??0,failed:verdict.filter(v=>!v.ok),result:job.result?.slice(0,700),log:job.log.slice(-12).map((l:any)=>l.msg.slice(0,260)),workspace};
  const file=path.join(root,"build-result.json");
  fs.writeFileSync(file,JSON.stringify(record,null,2),{mode:0o600});
  console.log("RESULT_FILE="+file);
}

if(process.argv.includes("--one")){
  await runOne(CASES.find(c=>c.id===arg("one"))!);
  process.exit(0);
}
const runs=Number(arg("runs")??"1"),only=arg("case");
const records:any[]=[];
for(const selected of CASES.filter(c=>!only||c.id===only))for(let i=1;i<=runs;i++){
  const child=spawnSync(process.execPath,[...process.execArgv,process.argv[1]!,"--one",selected.id],{encoding:"utf8",windowsHide:true,timeout:30*60_000,maxBuffer:128*1024*1024});
  const file=/RESULT_FILE=(.+)/.exec(child.stdout??"")?.[1]?.trim();
  const record=file&&fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):{case:selected.id,ok:false,stage:"process",exit:child.status,stderr:(child.stderr??"").slice(-800)};
  records.push(record);
  console.log(JSON.stringify({case:record.case,ok:record.ok,status:record.jobStatus,works:record.works,falseSuccess:record.falseSuccess,attempts:record.attempts,patches:record.patches,handoffs:record.handoffs,minutes:record.minutes,failed:record.ok?undefined:record.failed,result:record.ok?undefined:record.result,stderr:record.stderr}));
}
const summary={runs:records.length,passed:records.filter(r=>r.ok).length,falseSuccess:records.filter(r=>r.falseSuccess).length,patches:records.reduce((n,r)=>n+(r.patches??0),0),byCase:Object.fromEntries(CASES.map(c=>[c.id,`${records.filter(r=>r.case===c.id&&r.ok).length}/${records.filter(r=>r.case===c.id).length}`]))};
const out=path.join(resolveDataPaths().dataDir,"outcome-runs","build-types-batch-"+new Date().toISOString().replace(/[:.]/g,"-")+".json");
fs.writeFileSync(out,JSON.stringify({summary,records},null,2),{mode:0o600});
console.log(JSON.stringify({report:out,summary},null,2));
process.exit(summary.passed===summary.runs?0:1);
