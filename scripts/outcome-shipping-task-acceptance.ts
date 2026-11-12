/**
 * Shipping and invoices from the owner's words, judged from outside. A stand-in WooCommerce store (tests/fixtures) and a
 * shipping desk with one carrier for Riyadh; LayanX's agent gets the request through the normal gateway, and the judge reads
 * the desk's file, the store and the invoice file afterwards.
 *
 *   npx tsx scripts/outcome-shipping-task-acceptance.ts --runs 1 [--case prepare]
 */
import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {resolveDataPaths} from "../src/platform/paths.js";
import {startFakeWoo} from "../tests/fixtures/fake-woocommerce.js";
import {ShippingDesk} from "../src/business/shipping.js";

const arg=(name:string)=>{const i=process.argv.indexOf("--"+name);return i>=0?process.argv[i+1]:undefined;};
type Check={check:string;ok:boolean;detail?:string};
interface World{desk:ShippingDesk;deskFile:string;store:Awaited<ReturnType<typeof startFakeWoo>>;invoiceDir:string}
interface Case{id:string;goal:string;writes:boolean;setup?:(w:World)=>Promise<void>;judge:(w:World,reply:string)=>Check[]}
const digits=(t:string)=>t.replace(/[٠-٩]/g,d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
const shipment=(w:World,order:string)=>new ShippingDesk(w.deskFile).list().find(s=>s.orderId===order);
async function prepared(w:World){
  const {shipmentsFromStore}=await import("../src/business/store-shipping.js");
  const {WooClient}=await import("../src/business/woocommerce.js");
  await shipmentsFromStore(new WooClient({url:w.store.url,key:"ck_trial",secret:"cs_trial",allowWrites:false}),w.desk);
}
const CASES:Case[]=[
  {id:"prepare",writes:false,goal:"جهّز شحنات طلبات المتجر",
   judge:(w,reply)=>{const s=shipment(w,"1041");return[
     {check:"order 1041 has a shipment with the right customer, weight and cash on delivery",ok:!!s&&s.customer.phone==="0501112233"&&s.weightKg===1.2&&s.codAmount===9000&&s.carrierId==="smsa",detail:JSON.stringify(s??null)},
     {check:"order 1045 (Dammam, no carrier) has no shipment",ok:!shipment(w,"1045")},
     {check:"the store was not changed",ok:!w.store.requests.some(r=>r.method!=="GET")},
     {check:"the reply lists 1041 and says why 1045 was not prepared",ok:/1041/.test(reply)&&/1045/.test(reply)&&/الدمام/.test(reply),detail:reply.slice(0,400)}];}},
  {id:"invoice",writes:false,goal:"اطبع فاتورة الطلب رقم 1041",setup:prepared,
   judge:(w,reply)=>{const files=fs.existsSync(w.invoiceDir)?fs.readdirSync(w.invoiceDir):[];const html=files.find(f=>f.endsWith(".html"));const text=html?fs.readFileSync(path.join(w.invoiceDir,html),"utf8"):"";return[
     {check:"an invoice file INV-000001 was written",ok:files.includes("INV-000001.html"),detail:files.join(",")},
     {check:"it holds the order's line and total",ok:/عسل سدر يمني 500 جرام/.test(text)&&/90\.00 SAR/.test(text)},
     {check:"a PDF was written too",ok:files.includes("INV-000001.pdf")&&fs.readFileSync(path.join(w.invoiceDir,"INV-000001.pdf")).subarray(0,4).toString()==="%PDF"},
     {check:"the reply gives the invoice number and total",ok:/INV-000001/.test(reply)&&/90\.00/.test(digits(reply)),detail:reply.slice(0,300)}];}},
  {id:"close",writes:true,goal:"الطلبات اللي وصلت اقفلها في المتجر",
   setup:async w=>{await prepared(w);const s=w.desk.list().find(x=>x.orderId==="1041")!;await w.desk.book(s.id,"SMSA-1");for(const st of ["picked_up","in_transit","delivered"] as const)w.desk.update(s.id,st);},
   judge:(w,reply)=>[
     {check:"order 1041 is completed in the store",ok:w.store.orders.find(o=>o.number==="1041")?.status==="completed"},
     {check:"order 1045 (not delivered) is untouched",ok:w.store.orders.find(o=>o.number==="1045")?.status==="processing"},
     {check:"only that one order was written",ok:w.store.requests.filter(r=>r.method!=="GET").length===1,detail:JSON.stringify(w.store.requests.filter(r=>r.method!=="GET"))},
     {check:"the reply names 1041",ok:/1041/.test(reply),detail:reply.slice(0,300)}]},
  {id:"report",writes:false,goal:"كم شحنة متأخرة عندي؟",
   setup:async w=>{await prepared(w);},
   judge:(w,reply)=>[{check:"the reply gives the carrier and its counts",ok:/سمسا/.test(reply)&&/1 شحنة/.test(reply)&&/متأخر 0/.test(reply),detail:reply.slice(0,300)}]}
];

async function runOne(selected:Case){
  const id="ship-"+selected.id+"-"+randomUUID().slice(0,6);
  const root=path.join(resolveDataPaths().dataDir,"outcome-runs",new Date().toISOString().replace(/[:.]/g,"-")+"-"+id);
  const dir=path.join(root,"store"),projects=path.join(root,"projects");
  fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(projects,id),{recursive:true});
  const store=await startFakeWoo({key:"ck_trial",secret:"cs_trial"});
  const deskFile=path.join(dir,"shipping.json"),desk=new ShippingDesk(deskFile);
  desk.saveCarrier({id:"smsa",name:"سمسا",active:true,zones:{riyadh:["الرياض"]},rates:[{zone:"riyadh",firstKg:1,firstPrice:2000,extraKgPrice:500,days:2,codFee:700}]});
  const world:World={desk,deskFile,store,invoiceDir:path.join(dir,"invoices")};
  Object.assign(process.env,{LAYANX_WORKSPACE_ROOT:projects,LAYANX_STORE_DIR:dir,LAYANX_DATA_DIR:root,LAYANX_DATABASE_URL:"",DATABASE_URL:"",LAYANX_BUSINESS_STORAGE_PATH:path.join(root,"business.json"),
    LAYANX_RUNTIME_STORAGE_PATH:path.join(dir,"runtime.json"),LAYANX_LESSONS_FILE:path.join(dir,"lessons.json"),LAYANX_TRUST_FILE:path.join(root,"trust.json"),
    LAYANX_SECRET_VAULT_PATH:path.join(dir,"secrets.vault"),LAYANX_AI_MODE:"local",LAYANX_FREE_POOL_ENABLED:"false",OPENAI_ENABLED:"false",ANTHROPIC_ENABLED:"false",GEMINI_ENABLED:"false",MT5_AUTO_START:"false",LAYANX_OPEN_BROWSER:"off",
    LAYANX_WOOCOMMERCE_URL:store.url,LAYANX_WOOCOMMERCE_CONSUMER_KEY:"ck_trial",LAYANX_WOOCOMMERCE_CONSUMER_SECRET:"cs_trial",LAYANX_WOOCOMMERCE_ALLOW_WRITES:selected.writes?"on":"off",
    LAYANX_SELLER_NAME:"متجر تجريبي"});
  await selected.setup?.(world);
  store.requests.length=0;
  const {createRuntime}=await import("../src/runtime.js");
  const {composeTaskAnswer}=await import("../src/core/task-answer.js");
  const {routeRequest}=await import("../src/voice/request-router.js");
  const core:any=createRuntime({storagePath:process.env.LAYANX_RUNTIME_STORAGE_PATH}).core;
  const route=routeRequest(selected.goal).route,started=Date.now();
  let result:any,approved=0;
  try{
    if(route!=="task")throw new Error("routed to "+route+", not a task");
    result=await core.runAgentGateway(selected.goal,id,12,{},"core",{preferLocal:true});
    for(let round=0;round<4&&result?.paused&&result.approvalId;round++){
      core.executionRuntime.approvals.approve(result.approvalId);approved++;
      result=await core.executeAgentLoop(result.missionId,id,12,{[result.nextToolIndex]:result.approvalId},"core");
    }
  }catch(error){result={error:String((error as Error).message).slice(0,400)};}
  const answer=result?.results?await composeTaskAnswer(core.modelExecution,selected.goal,result.results,result.completed===true).catch(()=>null):null;
  const verdict=selected.judge(world,answer?.text??"");
  await store.close();
  const works=verdict.every(v=>v.ok),claimed=result?.completed===true;
  const file=path.join(root,"shipping-result.json");
  fs.writeFileSync(file,JSON.stringify({case:selected.id,route,ok:works&&claimed,falseSuccess:claimed&&!works,works,claimed,minutes:Math.round((Date.now()-started)/6000)/10,approved,verdict,
    reply:answer?.text??null,tools:(result?.results??[]).map((r:any)=>({tool:r.tool,ok:r.ok,error:r.error?.slice?.(0,300)})),reason:result?.reason??result?.error},null,2));
  console.log("RESULT_FILE="+file);
}

if(process.argv.includes("--one")){await runOne(CASES.find(c=>c.id===arg("one"))!);process.exit(0);}
const runs=Number(arg("runs")??"1"),only=arg("case"),records:any[]=[];
for(const selected of CASES.filter(c=>!only||c.id===only))for(let i=1;i<=runs;i++){
  const child=spawnSync(process.execPath,[...process.execArgv,process.argv[1]!,"--one",selected.id],{encoding:"utf8",windowsHide:true,timeout:25*60_000,maxBuffer:64*1024*1024});
  const file=/RESULT_FILE=(.+)/.exec(child.stdout??"")?.[1]?.trim();
  const record=file&&fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):{case:selected.id,ok:false,stage:"process",stderr:(child.stderr??"").slice(-1500)};
  records.push(record);
  console.log(JSON.stringify({case:record.case,ok:record.ok,claimed:record.claimed,works:record.works,falseSuccess:record.falseSuccess,minutes:record.minutes,approved:record.approved,tools:record.tools?.map((t:any)=>t.tool+":"+(t.ok?"ok":"fail:"+(t.error??""))),failed:record.verdict?.filter((v:any)=>!v.ok),reason:record.reason,stderr:record.stderr}));
}
const summary={runs:records.length,passed:records.filter(r=>r.ok).length,falseSuccess:records.filter(r=>r.falseSuccess).length};
const out=path.join(resolveDataPaths().dataDir,"outcome-runs","shipping-task-batch-"+new Date().toISOString().replace(/[:.]/g,"-")+".json");
fs.writeFileSync(out,JSON.stringify({summary,records},null,2));
console.log(JSON.stringify({report:out,summary},null,2));
process.exit(summary.passed===summary.runs?0:1);
