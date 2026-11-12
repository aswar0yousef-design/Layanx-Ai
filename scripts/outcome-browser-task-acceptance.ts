/**
 * Browser tasks from the owner's words, judged from outside. A small local shipping site records every form it receives;
 * LayanX's agent gets a goal ("get a shipping quote from Sanaa to Aden for 3 kg and tell me the price"), and the judge checks
 * what the site really received and whether the reply states the price the site computed. The browser is LayanX's own
 * headless one: nothing on the owner's screen is touched.
 *
 *   npx tsx scripts/outcome-browser-task-acceptance.ts --runs 1 [--case quote]
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {resolveDataPaths} from "../src/platform/paths.js";
import {applyLiveModelPlan} from "./live-models.js";

const arg=(name:string)=>{const i=process.argv.indexOf("--"+name);return i>=0?process.argv[i+1]:undefined;};
const page=(title:string,body:string)=>`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1>${body}<p><a href="/">الرئيسية</a> · <a href="/contact">اتصل بنا</a></p></body></html>`;
const price=(weight:number)=>1500+weight*500;
interface Received{form:string;fields:Record<string,string>}
function shippingSite(received:Received[]){
  return http.createServer(async(req,res)=>{
    let body="";for await(const c of req)body+=c;
    const send=(html:string)=>{res.writeHead(200,{"content-type":"text/html; charset=utf-8"});res.end(html);};
    const url=new URL(req.url??"/","http://x");
    if(req.method==="POST"){
      const fields=Object.fromEntries(new URLSearchParams(body));received.push({form:url.pathname,fields});
      if(url.pathname==="/quote"){const w=Number(fields.weight);return send(page("نتيجة عرض السعر",Number.isFinite(w)&&w>0?`<p id="result">السعر: ${price(w)} ريال من ${fields.from} إلى ${fields.to}</p>`:`<p id="result">الوزن غير صحيح</p>`));}
      if(url.pathname==="/contact")return send(page("تم الإرسال",`<p id="sent">شكراً ${fields.name}، وصلت رسالتك.</p>`));
    }
    if(url.pathname==="/contact")return send(page("اتصل بنا",`<form method="post" action="/contact"><label for="name">الاسم</label><input id="name" name="name"><label for="message">الرسالة</label><textarea id="message" name="message"></textarea><button type="submit">إرسال</button></form>`));
    return send(page("عرض سعر شحن",`<form method="post" action="/quote"><label for="from">من</label><input id="from" name="from"><label for="to">إلى</label><input id="to" name="to"><label for="weight">الوزن (كغ)</label><input id="weight" name="weight" type="number"><button type="submit">احسب السعر</button></form>`));
  });
}
interface Case{id:string;goal:(base:string)=>string;judge:(received:Received[],reply:string)=>Array<{check:string;ok:boolean;detail?:string}>}
const CASES:Case[]=[
  {id:"quote",goal:b=>`افتح الموقع ${b}/ واطلب عرض سعر شحن من صنعاء إلى عدن بوزن 3 كيلو، وأخبرني كم السعر`,
   judge:(r,reply)=>{const q=r.filter(x=>x.form==="/quote").at(-1)?.fields;return[
     {check:"the site received the quote request",ok:!!q&&/صنعاء/.test(q.from??"")&&/عدن/.test(q.to??"")&&Number(q.weight)===3,detail:JSON.stringify(q??null)},
     {check:"the reply states the price",ok:reply.replace(/[٬,]/g,"").includes(String(price(3))),detail:reply.slice(0,300)}];}},
  {id:"contact",goal:b=>`افتح صفحة اتصل بنا في ${b}/contact وأرسل رسالة باسم سالم نصها: متى يصل طلبي رقم 4471؟`,
   judge:r=>{const c=r.filter(x=>x.form==="/contact").at(-1)?.fields;return[
     {check:"the site received the message",ok:!!c&&/سالم/.test(c.name??"")&&/4471/.test(c.message??""),detail:JSON.stringify(c??null)}];}}
];

async function runOne(selected:Case){
  const id="browser-"+selected.id+"-"+randomUUID().slice(0,6);
  const root=path.join(resolveDataPaths().dataDir,"outcome-runs",new Date().toISOString().replace(/[:.]/g,"-")+"-"+id);
  const store=path.join(root,"store"),projects=path.join(root,"projects");
  fs.mkdirSync(store,{recursive:true});fs.mkdirSync(path.join(projects,id),{recursive:true});
  const received:Received[]=[];const site=shippingSite(received);
  await new Promise<void>(r=>site.listen(0,"127.0.0.1",()=>r()));
  const base="http://127.0.0.1:"+(site.address() as {port:number}).port;
  Object.assign(process.env,{LAYANX_WORKSPACE_ROOT:projects,LAYANX_STORE_DIR:store,LAYANX_DATA_DIR:root,LAYANX_DATABASE_URL:"",DATABASE_URL:"",
    LAYANX_RUNTIME_STORAGE_PATH:path.join(store,"runtime.json"),LAYANX_LESSONS_FILE:path.join(store,"lessons.json"),LAYANX_TRUST_FILE:path.join(root,"trust.json"),
    LAYANX_SECRET_VAULT_PATH:path.join(store,"secrets.vault"),LAYANX_AI_MODE:"local",LAYANX_FREE_POOL_ENABLED:"false",OPENAI_ENABLED:"false",ANTHROPIC_ENABLED:"false",GEMINI_ENABLED:"false",MT5_AUTO_START:"false",LAYANX_OPEN_BROWSER:"off",
    });
  // The owner's LayanX models, not the runtime's fallback (found 2026-11-13).
  const models=applyLiveModelPlan();
  const {createRuntime}=await import("../src/runtime.js");
  const {composeTaskAnswer}=await import("../src/core/task-answer.js");
  const runtime=createRuntime({storagePath:process.env.LAYANX_RUNTIME_STORAGE_PATH});
  const core:any=runtime.core;
  // LayanX refuses local addresses for http.read and browser.read, and that stays. In this trial only, the one test site this
  // script serves is let through; every other address still goes to the original, protected adapter.
  for(const tool of ["http.read","browser.read"]){
    const original=core.toolAdapters.get(tool);
    core.toolAdapters.unregister(tool);
    core.toolAdapters.register(tool,{async execute(request:any){
      const raw=String(request?.payload?.url??"");
      if(!raw.startsWith(base+"/")&&raw!==base)return original.execute(request);
      const r=await fetch(raw,{redirect:"error",signal:AbortSignal.timeout(5000)});
      return{url:raw,status:r.status,ok:r.ok,contentType:r.headers.get("content-type")??"",body:await r.text()};
    }});
  }
  const goal=selected.goal(base),started=Date.now();
  let result:any,approvals:Record<number,string>={},approved=0;
  try{
    // Approved here as the owner would: the run measures the agent on a throwaway local site, not a person.
    // Resumed on the same task after each approval, as the panel does (a new gateway call would be a new task).
    result=await core.runAgentGateway(goal,id,12,{},"core",{preferLocal:true});
    for(let round=0;round<8&&result?.paused&&result.approvalId;round++){
      core.executionRuntime.approvals.approve(result.approvalId);approved++;
      result=await core.executeAgentLoop(result.missionId,id,12,{[result.nextToolIndex]:result.approvalId},"core");
    }
  }catch(error){result={error:String((error as Error).message).slice(0,400)};}
  const answer=result?.results?await composeTaskAnswer(core.modelExecution,goal,result.results,result.completed===true).catch(()=>null):null;
  site.close();
  const verdict=selected.judge(received,answer?.text??"");
  const works=verdict.every(v=>v.ok),claimed=result?.completed===true;
  const file=path.join(root,"browser-result.json");
  fs.writeFileSync(file,JSON.stringify({case:selected.id,models,ok:works&&claimed,falseSuccess:claimed&&!works,works,claimed,minutes:Math.round((Date.now()-started)/6000)/10,approved,verdict,received,
    reply:answer?.text??null,tools:(result?.results??[]).map((r:any)=>({tool:r.tool,ok:r.ok,error:r.error?.slice?.(0,200)})),plan:(core.missions?.get?.(result?.missionId)?.tools??[]).map((t:any)=>({tool:t.tool,payload:t.payload})),reason:result?.reason??result?.error},null,2));
  console.log("RESULT_FILE="+file);
}

if(process.argv.includes("--one")){await runOne(CASES.find(c=>c.id===arg("one"))!);process.exit(0);}
const runs=Number(arg("runs")??"1"),only=arg("case"),records:any[]=[];
for(const selected of CASES.filter(c=>!only||c.id===only))for(let i=1;i<=runs;i++){
  const child=spawnSync(process.execPath,[...process.execArgv,process.argv[1]!,"--one",selected.id],{encoding:"utf8",windowsHide:true,timeout:25*60_000,maxBuffer:64*1024*1024});
  const file=/RESULT_FILE=(.+)/.exec(child.stdout??"")?.[1]?.trim();
  const record=file&&fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):{case:selected.id,ok:false,stage:"process",stderr:(child.stderr??"").slice(-1500)};
  records.push(record);
  console.log(JSON.stringify({case:record.case,ok:record.ok,claimed:record.claimed,works:record.works,falseSuccess:record.falseSuccess,minutes:record.minutes,tools:record.tools?.map((t:any)=>t.tool+":"+(t.ok?"ok":"fail")),failed:record.verdict?.filter((v:any)=>!v.ok),reason:record.reason,stderr:record.stderr}));
}
const summary={runs:records.length,passed:records.filter(r=>r.ok).length,falseSuccess:records.filter(r=>r.falseSuccess).length};
const out=path.join(resolveDataPaths().dataDir,"outcome-runs","browser-task-batch-"+new Date().toISOString().replace(/[:.]/g,"-")+".json");
fs.writeFileSync(out,JSON.stringify({summary,records},null,2));
console.log(JSON.stringify({report:out,summary},null,2));
process.exit(summary.passed===summary.runs?0:1);
