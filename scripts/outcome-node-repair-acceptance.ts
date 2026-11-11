/**
 * Node repair acceptance. Each case is a small real project with a real bug and its own failing test. LayanX must fix it
 * through its supervisor with a real local model. This script then judges with checks LayanX never sees: hidden tests
 * kept outside the project, the visible tests unchanged, and a limit on how much changed.
 *
 *   npx tsx scripts/outcome-node-repair-acceptance.ts --runs 3 [--case pagination]
 */
import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {resolveDataPaths} from "../src/platform/paths.js";

const arg=(name:string)=>{const i=process.argv.indexOf("--"+name);return i>=0?process.argv[i+1]:undefined;};
interface Case{id:string;report:string;files:Record<string,string>;hidden:string}
const pkg=JSON.stringify({name:"app",version:"1.0.0",type:"module",scripts:{test:"node --test"}});
const CASES:Case[]=[
  {id:"pagination",report:"الصفحة الثانية من القائمة تكرر آخر عنصر من الصفحة الأولى. أصلح العطل بأقل تغيير.",
   files:{"package.json":pkg,"src/paginate.js":`export function paginate(items,page,size){\n  const start=(page-1)*size-(page>1?1:0);\n  return items.slice(start,start+size);\n}\nexport function pageCount(items,size){\n  return Math.ceil(items.length/size);\n}\n`,
     "test/paginate.test.js":`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {paginate,pageCount} from '../src/paginate.js';\nconst items=[1,2,3,4,5];\ntest('first page',()=>assert.deepEqual(paginate(items,1,2),[1,2]));\ntest('second page does not repeat',()=>assert.deepEqual(paginate(items,2,2),[3,4]));\ntest('page count',()=>assert.equal(pageCount(items,2),3));\n`},
   hidden:`assert.deepEqual(m.paginate([1,2,3,4,5,6,7],3,3),[7]);assert.deepEqual(m.paginate(['a','b','c','d'],2,1),['b']);assert.deepEqual(m.paginate([1,2],1,5),[1,2]);assert.equal(m.pageCount([1,2,3,4],2),2);`},
  {id:"missing-profile",report:"The app crashes with a TypeError when a customer has no profile. It should use the name 'Guest' for them. Fix it with the smallest change.",
   files:{"package.json":pkg,"src/customers.js":`export function displayName(customer){\n  return customer.profile.name.trim();\n}\nexport function greetAll(customers){\n  return customers.map(c=>'Hello '+displayName(c));\n}\n`,
     "test/customers.test.js":`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {displayName,greetAll} from '../src/customers.js';\ntest('uses the profile name',()=>assert.equal(displayName({profile:{name:' Sara '}}),'Sara'));\ntest('guest when there is no profile',()=>assert.equal(displayName({}),'Guest'));\ntest('greets everyone',()=>assert.deepEqual(greetAll([{profile:{name:'A'}},{}]),['Hello A','Hello Guest']));\n`},
   hidden:`assert.equal(m.displayName({profile:{name:' Omar'}}),'Omar');assert.equal(m.displayName({profile:undefined}),'Guest');assert.equal(m.displayName({profile:null}),'Guest');assert.deepEqual(m.greetAll([{}]),['Hello Guest']);`},
  {id:"lost-await",report:"حفظ الطلب لا يظهر عند قراءته مباشرة بعد الحفظ. أصلح السبب بأقل تغيير.",
   files:{"package.json":pkg,"src/store.js":`const rows=new Map();\nconst delay=()=>new Promise(r=>setTimeout(r,5));\nexport async function put(id,value){\n  await delay();\n  rows.set(id,value);\n}\nexport async function get(id){\n  return rows.get(id);\n}\n`,
     "src/orders.js":`import {put,get} from './store.js';\nexport async function saveOrder(order){\n  put(order.id,{...order,saved:true});\n  return order.id;\n}\nexport async function loadOrder(id){\n  return get(id);\n}\n`,
     "test/orders.test.js":`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {saveOrder,loadOrder} from '../src/orders.js';\ntest('a saved order can be read at once',async()=>{const id=await saveOrder({id:'a',total:5});assert.deepEqual(await loadOrder(id),{id:'a',total:5,saved:true});});\ntest('unknown order',async()=>assert.equal(await loadOrder('none'),undefined));\n`},
   hidden:`const m2=await import(new URL('src/orders.js',root).href);await m2.saveOrder({id:'h',total:1});assert.equal((await m2.loadOrder('h')).total,1);assert.equal((await m2.loadOrder('h')).saved,true);`},
  {id:"two-causes",report:"حساب إجمالي الفاتورة خاطئ: الخصم لا يطبق، والضريبة تحسب بطريقة خاطئة. قد يكون للعطل أكثر من سبب. أصلحه بأقل تغيير.",
   files:{"package.json":pkg,"src/invoice.js":`export function discounted(total,percent){\n  return total-percent;\n}\nexport function withTax(amount,rate){\n  return amount+rate;\n}\nexport function invoiceTotal(lines,percent,rate){\n  const sum=lines.reduce((a,l)=>a+l.price*l.qty,0);\n  return withTax(discounted(sum,percent),rate);\n}\n`,
     "test/invoice.test.js":`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {discounted,withTax,invoiceTotal} from '../src/invoice.js';\ntest('discount is a percentage',()=>assert.equal(discounted(200,10),180));\ntest('tax is a percentage',()=>assert.equal(withTax(100,15),115));\ntest('invoice total',()=>assert.equal(invoiceTotal([{price:50,qty:2},{price:100,qty:1}],10,0),180));\n`},
   hidden:`assert.equal(m.discounted(50,50),25);assert.equal(m.withTax(200,5),210);assert.equal(m.invoiceTotal([{price:10,qty:10}],0,10),110);assert.equal(m.invoiceTotal([{price:100,qty:2}],50,10),110);`}
];
const MODULES:Record<string,string>={pagination:"src/paginate.js","missing-profile":"src/customers.js","lost-await":"src/store.js","two-causes":"src/invoice.js"};
const git=(cwd:string,...args:string[])=>{const r=spawnSync("git",["-c","user.name=harness","-c","user.email=h@local.invalid",...args],{cwd,encoding:"utf8",windowsHide:true});if(r.status!==0)throw new Error("git "+args.join(" ")+": "+r.stderr);return r.stdout;};

async function runOne(selected:Case){
  const id="node-"+selected.id+"-"+randomUUID().slice(0,6);
  const parent=path.join(resolveDataPaths().dataDir,"outcome-runs");
  const root=path.join(parent,new Date().toISOString().replace(/[:.]/g,"-")+"-"+id);
  const projects=path.join(root,"projects"),store=path.join(root,"store"),workspace=path.join(projects,id);
  fs.mkdirSync(store,{recursive:true,mode:0o700});fs.mkdirSync(workspace,{recursive:true,mode:0o700});
  for(const[file,text]of Object.entries(selected.files)){fs.mkdirSync(path.dirname(path.join(workspace,file)),{recursive:true});fs.writeFileSync(path.join(workspace,file),text);}
  git(workspace,"init","-q");git(workspace,"add","-A");git(workspace,"commit","-q","-m","base");
  const base=git(workspace,"rev-parse","HEAD").trim();
  const npmTest=()=>spawnSync(process.execPath,["--test"],{cwd:workspace,encoding:"utf8",windowsHide:true,timeout:60_000});
  const visibleBefore=npmTest().status;
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
  const job=supervisor.create(selected.report,id,{maxMinutes:25,maxRounds:12,openWhenDone:false,acceptanceProfile:"node-repair-v1"});
  while(["planning","running","verifying","queued"].includes(job.status)&&Date.now()-started<26*60_000)await new Promise(r=>setTimeout(r,1000));
  supervisor.stop();
  // Hidden tests live outside the project.
  const hiddenFile=path.join(root,"hidden.mjs");
  fs.writeFileSync(hiddenFile,`import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';const root=pathToFileURL(${JSON.stringify(workspace+path.sep)});const m=await import(new URL(${JSON.stringify(MODULES[selected.id]!)},root).href);${selected.hidden}console.log('hidden ok');`);
  const hidden=spawnSync(process.execPath,[hiddenFile],{encoding:"utf8",windowsHide:true,timeout:30_000});
  const visibleAfter=npmTest();
  git(workspace,"add","-A");
  const changed=git(workspace,"diff","--cached","--numstat",base,"--",".",":(exclude).layanx").trim().split("\n").filter(Boolean).map(line=>line.split("\t"));
  const lines=changed.reduce((sum,row)=>sum+(Number(row[0])||0)+(Number(row[1])||0),0);
  const testsTouched=changed.some(row=>/^test\/|package\.json/.test(row[2]!));
  const fixed=visibleAfter.status===0&&hidden.status===0,claimed=job.status==="completed";
  const record={case:selected.id,ok:fixed&&claimed&&!testsTouched&&lines>0&&lines<=30,falseSuccess:claimed&&!fixed,reproducedBefore:visibleBefore!==0,jobStatus:job.status,minutes:Math.round((Date.now()-started)/6000)/10,fixed,claimed,testsTouched,lines,handoffs:job.modelRun?.handoffs.length??0,attempts:job.milestones[0]?.attempts,stall:job.stall,hidden:hidden.status===0?"ok":hidden.stderr.split("\n").slice(0,6).join("\n"),result:job.result?.slice(0,600),log:job.log.slice(-10).map((l:any)=>l.msg.slice(0,220)),workspace};
  const file=path.join(root,"node-repair-result.json");
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
  console.log(JSON.stringify({case:record.case,ok:record.ok,status:record.jobStatus,fixed:record.fixed,falseSuccess:record.falseSuccess,lines:record.lines,attempts:record.attempts,handoffs:record.handoffs,minutes:record.minutes,hidden:record.ok?undefined:record.hidden,result:record.ok?undefined:record.result,stderr:record.stderr}));
}
const summary={runs:records.length,passed:records.filter(r=>r.ok).length,falseSuccess:records.filter(r=>r.falseSuccess).length,byCase:Object.fromEntries(CASES.map(c=>[c.id,`${records.filter(r=>r.case===c.id&&r.ok).length}/${records.filter(r=>r.case===c.id).length}`]))};
const out=path.join(resolveDataPaths().dataDir,"outcome-runs","node-repair-batch-"+new Date().toISOString().replace(/[:.]/g,"-")+".json");
fs.writeFileSync(out,JSON.stringify({summary,records},null,2),{mode:0o600});
console.log(JSON.stringify({report:out,summary},null,2));
process.exit(summary.passed===summary.runs?0:1);
