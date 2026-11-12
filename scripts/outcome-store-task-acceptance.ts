/**
 * WooCommerce tasks from the owner's words, judged from outside. A stand-in store (tests/fixtures/fake-woocommerce.ts: the real
 * REST API's auth, paging and date filters) holds known orders and products; LayanX's agent gets the owner's request through
 * the normal gateway with the local model, and the judge reads the store afterwards: was exactly the asked-for change made
 * (and nothing else), and does the reply state the store's real numbers.
 *
 *   npx tsx scripts/outcome-store-task-acceptance.ts --runs 1 [--case report]
 */
import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {resolveDataPaths} from "../src/platform/paths.js";
import {applyLiveModelPlan} from "./live-models.js";
import {startFakeWoo,sampleCatalog} from "../tests/fixtures/fake-woocommerce.js";

const arg=(name:string)=>{const i=process.argv.indexOf("--"+name);return i>=0?process.argv[i+1]:undefined;};
type Check={check:string;ok:boolean;detail?:string};
interface Case{id:string;goal:string;writes:boolean;judge:(store:{products:any[];orders:any[];requests:any[]},reply:string,before:ReturnType<typeof sampleCatalog>)=>Check[]}
const digits=(t:string)=>t.replace(/[٠-٩]/g,d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[٬,]/g,"");
const unchangedExcept=(now:any[],before:any[],id?:number)=>now.filter(x=>x.id!==id).every(x=>{const b=before.find(y=>y.id===x.id);return!b||JSON.stringify(b)===JSON.stringify(x);});
const writes=(r:any[])=>r.filter(x=>x.method!=="GET");
const CASES:Case[]=[
  {id:"report",writes:false,goal:"كم طلب جاني اليوم في متجري وكم المبيعات؟ وهل في منتج نفد مخزونه؟",
   judge:(s,reply)=>[
     {check:"nothing in the store was changed",ok:writes(s.requests).length===0,detail:JSON.stringify(writes(s.requests))},
     {check:"the reply gives today's 5 orders",ok:/\b5\b/.test(digits(reply)),detail:reply.slice(0,400)},
     {check:"the reply gives the paid sales 183",ok:digits(reply).includes("183")},
     {check:"the reply names the out-of-stock coffee",ok:/بن يمني/.test(reply)}]},
  {id:"price",writes:true,goal:"خفّض سعر عسل السدر في متجري إلى 40 ريال",
   judge:(s,reply,b)=>[
     {check:"the honey's price is 40 in the store",ok:s.products.find(p=>p.id===11)?.regular_price==="40",detail:JSON.stringify(s.products.find(p=>p.id===11))},
     {check:"no other product or order changed",ok:unchangedExcept(s.products,b.products,11)&&unchangedExcept(s.orders,b.orders)},
     {check:"the reply states the new price",ok:digits(reply).includes("40"),detail:reply.slice(0,300)}]},
  {id:"order",writes:true,goal:"اجعل الطلب رقم 1045 مكتمل في متجري",
   judge:(s,reply,b)=>[
     {check:"order 1045 is completed in the store",ok:s.orders.find(o=>o.number==="1045")?.status==="completed",detail:s.orders.find(o=>o.number==="1045")?.status},
     {check:"no other order or product changed",ok:unchangedExcept(s.orders,b.orders,505)&&unchangedExcept(s.products,b.products)},
     {check:"the reply says it",ok:/1045/.test(digits(reply)),detail:reply.slice(0,300)}]},
  {id:"stock",writes:true,goal:"حدّث مخزون زيت السمسم في متجري إلى 9 حبات",
   judge:(s,reply,b)=>[
     {check:"the sesame oil's stock is 9 in the store",ok:Number(s.products.find(p=>p.id===13)?.stock_quantity)===9,detail:JSON.stringify(s.products.find(p=>p.id===13))},
     {check:"no other product or order changed",ok:unchangedExcept(s.products,b.products,13)&&unchangedExcept(s.orders,b.orders)},
     {check:"the reply states the new stock",ok:/\b9\b/.test(digits(reply)),detail:reply.slice(0,300)}]},
  {id:"sale",writes:true,goal:"حط سعر عرض 25 على بن حراز في المتجر",
   judge:(s,reply,b)=>[
     {check:"the coffee's sale price is 25 and its normal price still 30",ok:s.products.find(p=>p.id===12)?.sale_price==="25"&&s.products.find(p=>p.id===12)?.regular_price==="30",detail:JSON.stringify(s.products.find(p=>p.id===12))},
     {check:"no other product or order changed",ok:unchangedExcept(s.products,b.products,12)&&unchangedExcept(s.orders,b.orders)},
     {check:"the reply states the sale price",ok:digits(reply).includes("25"),detail:reply.slice(0,300)}]},
  // No number: nothing may change, and the task must not be reported as done.
  {id:"vague",writes:true,goal:"خفّض سعر الزيت في متجري شوية",
   judge:(s,reply)=>[{check:"nothing in the store was changed",ok:writes(s.requests).length===0,detail:JSON.stringify(writes(s.requests))},
     {check:"the owner is asked for the price, in Arabic",ok:/السعر/.test(reply)&&/[؀-ۿ]/.test(reply),detail:reply.slice(0,300)}]}
];

async function runOne(selected:Case){
  const id="store-"+selected.id+"-"+randomUUID().slice(0,6);
  const root=path.join(resolveDataPaths().dataDir,"outcome-runs",new Date().toISOString().replace(/[:.]/g,"-")+"-"+id);
  const dir=path.join(root,"store"),projects=path.join(root,"projects");
  fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(projects,id),{recursive:true});
  const now=new Date();
  const woo=await startFakeWoo({now,key:"ck_trial",secret:"cs_trial"});
  const before=JSON.parse(JSON.stringify({products:woo.products,orders:woo.orders}));
  Object.assign(process.env,{LAYANX_WORKSPACE_ROOT:projects,LAYANX_STORE_DIR:dir,LAYANX_DATA_DIR:root,LAYANX_DATABASE_URL:"",DATABASE_URL:"",LAYANX_BUSINESS_STORAGE_PATH:path.join(root,"business.json"),
    LAYANX_RUNTIME_STORAGE_PATH:path.join(dir,"runtime.json"),LAYANX_LESSONS_FILE:path.join(dir,"lessons.json"),LAYANX_TRUST_FILE:path.join(root,"trust.json"),
    LAYANX_SECRET_VAULT_PATH:path.join(dir,"secrets.vault"),LAYANX_AI_MODE:"local",LAYANX_FREE_POOL_ENABLED:"false",OPENAI_ENABLED:"false",ANTHROPIC_ENABLED:"false",GEMINI_ENABLED:"false",MT5_AUTO_START:"false",LAYANX_OPEN_BROWSER:"off",
    // The stand-in store and its throwaway keys; never the owner's store.
    LAYANX_WOOCOMMERCE_URL:woo.url,LAYANX_WOOCOMMERCE_CONSUMER_KEY:"ck_trial",LAYANX_WOOCOMMERCE_CONSUMER_SECRET:"cs_trial",LAYANX_WOOCOMMERCE_ALLOW_WRITES:selected.writes?"on":"off"});
  // The owner's LayanX models, not the runtime's fallback (found 2026-11-13).
  const models=applyLiveModelPlan();
  const {createRuntime}=await import("../src/runtime.js");
  const {composeTaskAnswer}=await import("../src/core/task-answer.js");
  const {routeRequest}=await import("../src/voice/request-router.js");
  const runtime=createRuntime({storagePath:process.env.LAYANX_RUNTIME_STORAGE_PATH});
  const core:any=runtime.core;
  const route=routeRequest(selected.goal).route,started=Date.now();
  let result:any,approved=0;
  try{
    if(route!=="task")throw new Error("routed to "+route+", not a task");
    result=await core.runAgentGateway(selected.goal,id,12,{},"core",{preferLocal:true});
    for(let round=0;round<8&&result?.paused&&result.approvalId;round++){
      core.executionRuntime.approvals.approve(result.approvalId);approved++;
      result=await core.executeAgentLoop(result.missionId,id,12,{[result.nextToolIndex]:result.approvalId},"core");
    }
  }catch(error){result={error:String((error as Error).message).slice(0,400)};}
  const answer=result?.results?await composeTaskAnswer(core.modelExecution,selected.goal,result.results,result.completed===true).catch(()=>null):null;
  const verdict=selected.judge(woo,answer?.text??"",before);
  await woo.close();
  const works=verdict.every(v=>v.ok),claimed=result?.completed===true;
  // The vague request passes only when nothing changed AND it was not reported as done.
  const ok=selected.id==="vague"?works&&!claimed:works&&claimed;
  const file=path.join(root,"store-result.json");
  fs.writeFileSync(file,JSON.stringify({case:selected.id,models,route,ok,falseSuccess:claimed&&!works||selected.id==="vague"&&claimed,works,claimed,minutes:Math.round((Date.now()-started)/6000)/10,approved,verdict,
    reply:answer?.text??null,tools:(result?.results??[]).map((r:any)=>({tool:r.tool,ok:r.ok,error:r.error?.slice?.(0,300)})),requests:writes(woo.requests),reason:result?.reason??result?.error},null,2));
  console.log("RESULT_FILE="+file);
}

if(process.argv.includes("--one")){await runOne(CASES.find(c=>c.id===arg("one"))!);process.exit(0);}
const runs=Number(arg("runs")??"1"),only=arg("case"),records:any[]=[];
for(const selected of CASES.filter(c=>!only||c.id===only))for(let i=1;i<=runs;i++){
  const child=spawnSync(process.execPath,[...process.execArgv,process.argv[1]!,"--one",selected.id],{encoding:"utf8",windowsHide:true,timeout:25*60_000,maxBuffer:64*1024*1024});
  const file=/RESULT_FILE=(.+)/.exec(child.stdout??"")?.[1]?.trim();
  const record=file&&fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):{case:selected.id,ok:false,stage:"process",stderr:(child.stderr??"").slice(-1500)};
  records.push(record);
  console.log(JSON.stringify({case:record.case,ok:record.ok,claimed:record.claimed,works:record.works,falseSuccess:record.falseSuccess,minutes:record.minutes,tools:record.tools?.map((t:any)=>t.tool+":"+(t.ok?"ok":"fail:"+(t.error??""))),failed:record.verdict?.filter((v:any)=>!v.ok),reason:record.reason,stderr:record.stderr}));
}
const summary={runs:records.length,passed:records.filter(r=>r.ok).length,falseSuccess:records.filter(r=>r.falseSuccess).length};
const out=path.join(resolveDataPaths().dataDir,"outcome-runs","store-task-batch-"+new Date().toISOString().replace(/[:.]/g,"-")+".json");
fs.writeFileSync(out,JSON.stringify({summary,records},null,2));
console.log(JSON.stringify({report:out,summary},null,2));
process.exit(summary.passed===summary.runs?0:1);
