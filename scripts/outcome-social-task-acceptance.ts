/**
 * Social posts from the owner's words, judged from outside, against a stand-in Facebook Page (tests/fixtures/fake-graph.ts);
 * no real account is ever used. The local model writes the drafts; the judge reads what the Page received and the drafts.
 *
 *   npx tsx scripts/outcome-social-task-acceptance.ts --runs 1 [--case draft]
 */
import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {resolveDataPaths} from "../src/platform/paths.js";
import {startFakeGraph,type FakeGraph} from "../tests/fixtures/fake-graph.js";

const arg=(name:string)=>{const i=process.argv.indexOf("--"+name);return i>=0?process.argv[i+1]:undefined;};
type Check={check:string;ok:boolean;detail?:string};
interface World{graph:FakeGraph;business:any;draftId?:string;draftText?:string}
interface Case{id:string;goal:string;expectDone:boolean;setup?:(w:World)=>void;judge:(w:World,reply:string,route:string)=>Check[]}
/** The judge's own language check (not the product's): an Arabic post holds Arabic letters, digits, punctuation, emoji and hashtags only. */
const mixedLanguage=(t:string)=>t.split(/\s+/).filter(w=>w&&!w.startsWith("#")).filter(w=>/[^\u0600-\u06FF\s\d\p{P}\p{S}\u200c\u200d\uFE0F]/u.test(w.replace(/\p{Extended_Pictographic}/gu,"")));
/** Claims the request did not make. */
const CLAIMS=/(?:فيتامين|بروبيوتيك|يعالج|علاج|شفاء|مضاد|بكتيريا|مناعه|مناعة|جائزه|جائزة|الافضل في العالم|vitamin|cure)/u;
const digits=(t:string)=>(t.replace(/[٠-٩]/g,d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).match(/\d+/g)??[]);
const CASES:Case[]=[
  {id:"draft",expectDone:true,goal:"اكتب منشور لفيسبوك عن وصول عسل السدر اليمني الجديد إلى المتجر",
   judge:(w,reply)=>{const d=w.business.snapshot().content.filter((c:any)=>c.origin==="social.draft").at(-1);return[
     {check:"a draft was saved for Facebook",ok:!!d&&d.status==="draft"&&d.platforms.includes("facebook"),detail:JSON.stringify(d??null).slice(0,300)},
     {check:"nothing was sent to the Page",ok:w.graph.requests.length===0},
     {check:"the draft has no number the owner did not give",ok:!!d&&digits(d.body).length===0,detail:d?.body},
     {check:"the draft is about the honey",ok:!!d&&/عسل/.test(d.body)},
     {check:"the draft is in Arabic only (no words from other languages)",ok:!!d&&mixedLanguage(d.body).length===0,detail:d?mixedLanguage(d.body).join(" "):""},
     {check:"the draft makes no health or award claims the owner did not make",ok:!!d&&!CLAIMS.test(d.body)},
     {check:"the reply shows the draft word for word",ok:!!d&&reply.includes(d.body)}];}},
  {id:"publish",expectDone:true,goal:"انشر المنشور",
   setup:w=>{const t="وصل عسل السدر اليمني الجديد، تعالوا جرّبوه في المحل.";const c=w.business.createContent({title:"عسل",body:t,platforms:["facebook"],mediaIds:[],status:"draft",origin:"social.draft"});w.draftId=c.id;w.draftText=c.body;},
   judge:(w,reply)=>[
     {check:"the Page received exactly the draft, once",ok:w.graph.posts.length===1&&w.graph.posts[0]!.message===w.draftText,detail:JSON.stringify(w.graph.posts)},
     {check:"the token never went in an address",ok:!w.graph.requests.some(r=>r.path.includes("access_token"))},
     {check:"the reply says it was read back and matches",ok:/النص مطابق/.test(reply),detail:reply.slice(0,300)}]},
  {id:"nodraft",expectDone:false,goal:"انشر المنشور",
   judge:(w,reply)=>[{check:"nothing was sent",ok:w.graph.requests.length===0},{check:"the owner is told there is no draft",ok:/لا توجد مسودة/.test(reply),detail:reply.slice(0,200)}]},
  {id:"question",expectDone:false,goal:"كيف أكتب منشور جيد لمتجري؟",
   judge:(w,_reply,route)=>[{check:"a question stays a conversation",ok:route==="answer",detail:route},{check:"nothing was sent",ok:w.graph.requests.length===0}]}
];

async function runOne(selected:Case){
  const id="social-"+selected.id+"-"+randomUUID().slice(0,6);
  const root=path.join(resolveDataPaths().dataDir,"outcome-runs",new Date().toISOString().replace(/[:.]/g,"-")+"-"+id);
  const dir=path.join(root,"store"),projects=path.join(root,"projects");
  fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(projects,id),{recursive:true});
  const graph=await startFakeGraph({token:"trial_page_token"});
  // The models the live LayanX uses (its saved plan), so the trial writes with the same model as the owner's LayanX.
  try{const plan=JSON.parse(fs.readFileSync(path.join(resolveDataPaths().dataDir,"ollama-models.json"),"utf8")).plan?.assignments??{};
    const main=plan.planning??plan.general;if(main)process.env.OLLAMA_MODEL=main;if(plan.vision)process.env.OLLAMA_VISION_MODEL=plan.vision;}catch{}
  Object.assign(process.env,{LAYANX_WORKSPACE_ROOT:projects,LAYANX_STORE_DIR:dir,LAYANX_DATA_DIR:root,LAYANX_DATABASE_URL:"",DATABASE_URL:"",LAYANX_BUSINESS_STORAGE_PATH:path.join(dir,"business.json"),
    LAYANX_RUNTIME_STORAGE_PATH:path.join(dir,"runtime.json"),LAYANX_LESSONS_FILE:path.join(dir,"lessons.json"),LAYANX_TRUST_FILE:path.join(root,"trust.json"),
    LAYANX_SECRET_VAULT_PATH:path.join(dir,"secrets.vault"),LAYANX_AI_MODE:"local",LAYANX_FREE_POOL_ENABLED:"false",OPENAI_ENABLED:"false",ANTHROPIC_ENABLED:"false",GEMINI_ENABLED:"false",MT5_AUTO_START:"false",LAYANX_OPEN_BROWSER:"off",
    // The stand-in Page and a throwaway token; never the owner's accounts.
    LAYANX_FACEBOOK_SOCIAL_TOKEN:"trial_page_token",LAYANX_FACEBOOK_SOCIAL_BASE_URL:graph.url});
  const {createRuntime}=await import("../src/runtime.js");
  const {composeTaskAnswer}=await import("../src/core/task-answer.js");
  const {routeRequest}=await import("../src/voice/request-router.js");
  const runtime:any=createRuntime({storagePath:process.env.LAYANX_RUNTIME_STORAGE_PATH});
  const core=runtime.core,business=runtime.business;
  business.upsertSocialAccount({platform:"facebook",name:"صفحة تجريبية",externalId:"trialpage",enabled:true});
  const world:World={graph,business};
  selected.setup?.(world);
  const route=routeRequest(selected.goal).route,started=Date.now();
  let result:any={},approved=0;
  if(route==="task"){
    try{
      result=await core.runAgentGateway(selected.goal,id,6,{},"core",{preferLocal:true});
      for(let round=0;round<3&&result?.paused&&result.approvalId;round++){core.executionRuntime.approvals.approve(result.approvalId);approved++;result=await core.executeAgentLoop(result.missionId,id,6,{[result.nextToolIndex]:result.approvalId},"core");}
    }catch(error){result={error:String((error as Error).message).slice(0,400)};}
  }
  const answer=result?.results?await composeTaskAnswer(core.modelExecution,selected.goal,result.results,result.completed===true).catch(()=>null):null;
  const verdict=selected.judge(world,answer?.text??"",route);
  await graph.close();
  const works=verdict.every(v=>v.ok),claimed=result?.completed===true;
  const ok=works&&claimed===selected.expectDone;
  const file=path.join(root,"social-result.json");
  fs.writeFileSync(file,JSON.stringify({case:selected.id,route,ok,falseSuccess:claimed&&!works,works,claimed,minutes:Math.round((Date.now()-started)/6000)/10,approved,verdict,reply:answer?.text??null,
    tools:(result?.results??[]).map((r:any)=>`${r.tool}:${r.ok?"ok":"fail: "+String(r.error??"").slice(0,200)}`),reason:result?.reason??result?.error},null,2));
  console.log("RESULT_FILE="+file);
}

if(process.argv.includes("--one")){await runOne(CASES.find(c=>c.id===arg("one"))!);process.exit(0);}
const runs=Number(arg("runs")??"1"),only=arg("case"),records:any[]=[];
for(const selected of CASES.filter(c=>!only||c.id===only))for(let i=1;i<=runs;i++){
  const child=spawnSync(process.execPath,[...process.execArgv,process.argv[1]!,"--one",selected.id],{encoding:"utf8",windowsHide:true,timeout:25*60_000,maxBuffer:64*1024*1024});
  const file=/RESULT_FILE=(.+)/.exec(child.stdout??"")?.[1]?.trim();
  const record=file&&fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):{case:selected.id,ok:false,stage:"process",stderr:(child.stderr??"").slice(-1500)};
  records.push(record);
  console.log(JSON.stringify({case:record.case,ok:record.ok,claimed:record.claimed,works:record.works,falseSuccess:record.falseSuccess,minutes:record.minutes,tools:record.tools,failed:record.verdict?.filter((v:any)=>!v.ok),reason:record.reason,stderr:record.stderr}));
}
const summary={runs:records.length,passed:records.filter(r=>r.ok).length,falseSuccess:records.filter(r=>r.falseSuccess).length};
const out=path.join(resolveDataPaths().dataDir,"outcome-runs","social-task-batch-"+new Date().toISOString().replace(/[:.]/g,"-")+".json");
fs.writeFileSync(out,JSON.stringify({summary,records},null,2));
console.log(JSON.stringify({report:out,summary},null,2));
process.exit(summary.passed===summary.runs?0:1);
