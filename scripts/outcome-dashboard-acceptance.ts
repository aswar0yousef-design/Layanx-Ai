/**
 * The system-health page against numbers this script produced itself. A throwaway server, a model provider owned by the
 * script with known outcomes and token counts, and a real browser reading what the page shows. No real model is used.
 *
 *   npx tsx scripts/outcome-dashboard-acceptance.ts
 */
import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {resolveDataPaths} from "../src/platform/paths.js";

const id=randomUUID().slice(0,8);
const parent=path.join(resolveDataPaths().dataDir,"outcome-runs"),root=path.join(parent,"dashboard-"+id),store=path.join(root,"store");
fs.mkdirSync(store,{recursive:true,mode:0o700});
Object.assign(process.env,{LAYANX_WORKSPACE_ROOT:path.join(root,"projects"),LAYANX_STORE_DIR:store,LAYANX_DATA_DIR:root,LAYANX_DATABASE_URL:"",DATABASE_URL:"",LAYANX_RUNTIME_STORAGE_PATH:path.join(store,"runtime.json"),LAYANX_BUSINESS_STORAGE_PATH:path.join(store,"business.json"),LAYANX_SECRET_VAULT_PATH:path.join(store,"secrets.vault"),LAYANX_AI_MODE:"local",LAYANX_FREE_POOL_ENABLED:"false",OPENAI_ENABLED:"false",ANTHROPIC_ENABLED:"false",GEMINI_ENABLED:"false",MT5_AUTO_START:"false",LAYANX_OPEN_BROWSER:"off",LAYANX_DESKTOP_NOTIFY:"off"});
const {createRuntime}=await import("../src/runtime.js");
const {startRuntimeApi}=await import("../src/api-server.js");
const runtime=createRuntime({storagePath:process.env.LAYANX_RUNTIME_STORAGE_PATH});
const core=runtime.core;
let plan:Array<{ok:boolean;input:number;output:number;delay:number}>=[{ok:true,input:100,output:50,delay:40},{ok:true,input:200,output:25,delay:40},{ok:false,input:0,output:0,delay:40}];
const JUDGE="judge-model-"+id;
core.providers.register({name:"judge",async health(){return{provider:"judge",available:true,updatedAt:new Date().toISOString()};},
  async generate(model:any){const step=plan.shift()!;await new Promise(r=>setTimeout(r,step.delay));if(!step.ok)throw new Error("planned failure "+id);return{provider:"judge",model:model.id,modelId:model.id,output:"ok",usage:{inputTokens:step.input,outputTokens:step.output}} as never;}} as never);
core.models.register({id:JUDGE,provider:"judge",capabilities:["chat"],local:true,enabled:true,qualityScore:999} as never);
for(let i=0;i<3;i++)await core.modelExecution.execute({capability:"chat",input:"x",routing:{preferLocal:true,modelId:JUDGE}} as never).catch(()=>undefined);
core.audit.append({timestamp:new Date().toISOString(),actor:"judge",action:"judge.planted-failure",resource:"resource-"+id,result:"failure",metadata:{}} as never);

const token="t"+id;
const port=21000+Math.floor(Math.random()*20000);
const server:any=startRuntimeApi({core,business:runtime.business,host:"127.0.0.1",port,token,...(runtime.persistence?{persistence:runtime.persistence}:{})} as never);
if(!server.listening)await new Promise(resolve=>server.once("listening",resolve));
const checks:Array<{check:string;ok:boolean;detail?:unknown}>=[];
const record=(check:string,ok:boolean,detail?:unknown)=>{checks.push({check,ok,detail});console.log(ok?"PASS":"FAIL",check,detail===undefined?"":JSON.stringify(detail).slice(0,300));};
const pw:any=await import("playwright-core");
const chromium=pw.chromium??pw.default?.chromium;
const browser=await chromium.launch({headless:true,channel:"msedge"}).catch(()=>chromium.launch({headless:true,channel:"chrome"}));
try{
  const refused=await fetch(`http://127.0.0.1:${port}/v1/dashboard/overview`);
  record("the data needs the token",refused.status===401,refused.status);
  const context=await browser.newContext({extraHTTPHeaders:{authorization:"Bearer "+token},viewport:{width:1280,height:900}});
  const page=await context.newPage();
  const errors:string[]=[];page.on("pageerror",(e:Error)=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/#overview`,{waitUntil:"load"});
  await page.waitForSelector(`tr[data-model="${JUDGE}"]`,{timeout:15000});
  const cells=(await page.locator(`tr[data-model="${JUDGE}"] td`).allInnerTexts()) as string[];
  record("calls, successes and failures match what happened",cells[1]==="3"&&cells[2]==="2"&&cells[3]==="1",cells);
  record("tokens match the provider's report",cells[5]==="375",cells[5]);
  const speed=/^(\d+) ms$/.exec(cells[4]!);
  record("speed was measured, not invented",Boolean(speed)&&Number(speed![1])>=30&&Number(speed![1])<2000,cells[4]);
  record("a local model costs nothing",cells[6]==="$0.0000",cells[6]);
  record("the model's real error is shown",cells[7]!.includes("planned failure "+id),cells[7]);
  record("totals agree",(await page.locator("#ovCalls").innerText())==="3"&&(await page.locator("#ovFailed").innerText())==="1"&&(await page.locator("#ovTokens").innerText())==="375");
  record("a recorded failure appears",(await page.locator("#ovErrors").innerText()).includes("judge.planted-failure"),(await page.locator("#ovErrors").innerText()).slice(0,200));
  const tools=Number(await page.locator("#ovTools").innerText());
  record("the tool count is the real catalog",tools===core.toolCatalog.list(core.agents.get("core"),"L4_EXECUTE").length&&tools>0,tools);
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
  record("fits a phone",await page.evaluate("document.documentElement.scrollWidth<=window.innerWidth+2"));
  record("no page errors",!errors.length,errors);
  const statsFile=JSON.parse(fs.readFileSync(path.join(store,"model-stats.json"),"utf8"));
  record("the numbers survive a restart on disk",statsFile[JUDGE]?.calls===3,statsFile[JUDGE]?.calls);
}catch(error){record("scenario completed",false,String((error as Error).stack).slice(0,500));}
finally{await browser.close().catch(()=>undefined);server.closeAllConnections?.();server.close();}
const report={at:new Date().toISOString(),ok:checks.length>=12&&checks.every(c=>c.ok),passed:checks.filter(c=>c.ok).length,total:checks.length,checks};
const out=path.join(parent,"dashboard-"+new Date().toISOString().replace(/[:.]/g,"-")+".json");
fs.writeFileSync(out,JSON.stringify(report,null,2),{mode:0o600});
console.log(JSON.stringify({report:out,ok:report.ok,passed:report.passed,total:report.total}));
process.exit(report.ok?0:1);
