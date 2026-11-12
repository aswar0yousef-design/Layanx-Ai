/**
 * Email invoices to Google Sheets from the owner's words, judged from outside. Stand-in Gmail/Drive/Sheets
 * (tests/fixtures/fake-google.ts) hold five realistic emails: an English carrier invoice, an Arabic one in HTML only, a
 * newsletter, a PDF-only invoice (nothing to read: must not be guessed) and a resent duplicate. LayanX's live model reads them;
 * the judge reads the sheets afterwards. No real Google account is used.
 *
 *   npx tsx scripts/outcome-mail-invoices-acceptance.ts --runs 3
 */
import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {resolveDataPaths} from "../src/platform/paths.js";
import {applyLiveModelPlan} from "./live-models.js";
import {SAMPLE_MAILS,startFakeGoogle} from "../tests/fixtures/fake-google.js";

const arg=(name:string)=>{const i=process.argv.indexOf("--"+name);return i>=0?process.argv[i+1]:undefined;};
async function runOne(){
  const id="mailinv-"+randomUUID().slice(0,6);
  const root=path.join(resolveDataPaths().dataDir,"outcome-runs",new Date().toISOString().replace(/[:.]/g,"-")+"-"+id);
  const dir=path.join(root,"store"),projects=path.join(root,"projects");
  fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(projects,id),{recursive:true});
  const google=await startFakeGoogle(SAMPLE_MAILS,"trial_google_token");
  Object.assign(process.env,{LAYANX_WORKSPACE_ROOT:projects,LAYANX_STORE_DIR:dir,LAYANX_DATA_DIR:root,LAYANX_DATABASE_URL:"",DATABASE_URL:"",LAYANX_BUSINESS_STORAGE_PATH:path.join(dir,"business.json"),
    LAYANX_RUNTIME_STORAGE_PATH:path.join(dir,"runtime.json"),LAYANX_LESSONS_FILE:path.join(dir,"lessons.json"),LAYANX_TRUST_FILE:path.join(root,"trust.json"),LAYANX_GOOGLE_INVOICE_REGISTRY:path.join(dir,"google-invoices.json"),
    LAYANX_SECRET_VAULT_PATH:path.join(dir,"secrets.vault"),LAYANX_AI_MODE:"local",LAYANX_FREE_POOL_ENABLED:"false",OPENAI_ENABLED:"false",ANTHROPIC_ENABLED:"false",GEMINI_ENABLED:"false",MT5_AUTO_START:"false",LAYANX_OPEN_BROWSER:"off"});
  const models=applyLiveModelPlan();
  const {createRuntime}=await import("../src/runtime.js");
  const {composeTaskAnswer}=await import("../src/core/task-answer.js");
  const {routeRequest}=await import("../src/voice/request-router.js");
  const {GoogleInvoiceAgent}=await import("../src/google-invoice-agent.js");
  const {createGoogleWorkspaceAdapter}=await import("../src/connectors/google-workspace.js");
  const core:any=createRuntime({storagePath:process.env.LAYANX_RUNTIME_STORAGE_PATH}).core;
  // Only in this trial: the invoice tool talks to the stand-in Google instead of the real one; everything else is LayanX's own.
  const agent=new GoogleInvoiceAgent(core,{google:createGoogleWorkspaceAdapter({accessToken:"trial_google_token",fetcher:google.fetcher}),registryPath:path.join(dir,"google-invoices.json")});
  core.toolAdapters.unregister("email.invoices.scan");
  core.toolAdapters.register("email.invoices.scan",{async execute(request:any){const p=request.payload??{};return agent.scan({provider:p.provider==="yahoo"?"yahoo":"google",limit:typeof p.limit==="number"?p.limit:undefined});}});
  const goal="اقرأ فواتير الشحن من بريدي وسجلها في Google Sheets",route=routeRequest(goal).route,started=Date.now();
  let result:any={};
  try{if(route!=="task")throw new Error("routed to "+route);result=await core.runAgentGateway(goal,id,6,{},"core",{preferLocal:true});}catch(error){result={error:String((error as Error).message).slice(0,400)};}
  const answer=result?.results?await composeTaskAnswer(core.modelExecution,goal,result.results,result.completed===true).catch(()=>null):null;
  const reply=answer?.text??"";
  const books=[...google.sheets.values()];
  const rows=(prefix:string)=>books.filter(b=>b.title.startsWith(prefix)).flatMap(b=>(b.tabs.get("Invoices")??[]).slice(1));
  const all=books.flatMap(b=>[...b.tabs.values()].flatMap(t=>t.slice(1)));
  const smsa=rows("SMSA"),aramex=books.filter(b=>/أرامكس|aramex/i.test(b.title)).flatMap(b=>(b.tabs.get("Invoices")??[]).slice(1));
  const verdict=[
    {check:"SMSA invoice INV-55821 written once with total 1250.50",ok:smsa.length===1&&smsa[0]![0]==="INV-55821"&&Number(smsa[0]![2])===1250.5,detail:JSON.stringify(smsa)},
    {check:"Aramex invoice ARX-7731 (Arabic, HTML only) written once with total 345",ok:aramex.length===1&&aramex[0]![0]==="ARX-7731"&&Number(aramex[0]![2])===345,detail:JSON.stringify(aramex)},
    {check:"nothing else was written (no newsletter, no guessed DHL row, no duplicate)",ok:all.length===2,detail:JSON.stringify(all)},
    {check:"the reply says the DHL invoice was not written and why",ok:/DHL|Invoice available/.test(reply)&&/(ليس في الرسالة|مرفق|attachment|not in the email)/.test(reply),detail:reply.slice(0,600)}];
  await google.close();
  const works=verdict.every(v=>v.ok),claimed=result?.completed===true;
  const file=path.join(root,"mail-invoices-result.json");
  fs.writeFileSync(file,JSON.stringify({case:"mail-invoices",models,route,ok:works&&claimed,falseSuccess:claimed&&!works,works,claimed,minutes:Math.round((Date.now()-started)/6000)/10,verdict,reply,
    tools:(result?.results??[]).map((r:any)=>`${r.tool}:${r.ok?"ok":"fail: "+String(r.error??"").slice(0,200)}`),reason:result?.reason??result?.error},null,2));
  console.log("RESULT_FILE="+file);
}
if(process.argv.includes("--one")){await runOne();process.exit(0);}
const runs=Number(arg("runs")??"1"),records:any[]=[];
for(let i=1;i<=runs;i++){
  const child=spawnSync(process.execPath,[...process.execArgv,process.argv[1]!,"--one"],{encoding:"utf8",windowsHide:true,timeout:25*60_000,maxBuffer:64*1024*1024});
  const file=/RESULT_FILE=(.+)/.exec(child.stdout??"")?.[1]?.trim();
  const record=file&&fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):{case:"mail-invoices",ok:false,stage:"process",stderr:(child.stderr??"").slice(-1500)};
  records.push(record);
  console.log(JSON.stringify({ok:record.ok,claimed:record.claimed,works:record.works,falseSuccess:record.falseSuccess,minutes:record.minutes,models:record.models,tools:record.tools,failed:record.verdict?.filter((v:any)=>!v.ok),reason:record.reason,stderr:record.stderr}));
}
const summary={runs:records.length,passed:records.filter(r=>r.ok).length,falseSuccess:records.filter(r=>r.falseSuccess).length};
const out=path.join(resolveDataPaths().dataDir,"outcome-runs","mail-invoices-batch-"+new Date().toISOString().replace(/[:.]/g,"-")+".json");
fs.writeFileSync(out,JSON.stringify({summary,records},null,2));
console.log(JSON.stringify({report:out,summary},null,2));
process.exit(summary.passed===summary.runs?0:1);
