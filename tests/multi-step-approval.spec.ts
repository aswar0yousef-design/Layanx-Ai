import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Seen live 2026-11-13 on "open Calculator and compute 125 × 8" (open, type, read; two steps need approval):
 *  1. every resume after an approval started again at step 0, so Calculator was opened again and asked for approval forever;
 *  2. a screenshot was written OVER the planned typing step, so nothing was typed;
 *  3. when typing failed, the final "read" step still ran and the mission reported success.
 * The desktop tools are replaced by fakes here, so this runs anywhere.
 */
const root=fs.mkdtempSync(path.join(os.tmpdir(),"multi-step-"));const dir=path.join(root,"s");fs.mkdirSync(dir);fs.mkdirSync(path.join(root,"p","ms"),{recursive:true});
Object.assign(process.env,{LAYANX_WORKSPACE_ROOT:path.join(root,"p"),LAYANX_STORE_DIR:dir,LAYANX_DATA_DIR:root,LAYANX_DATABASE_URL:"",DATABASE_URL:"",LAYANX_RUNTIME_STORAGE_PATH:path.join(dir,"r.json"),LAYANX_LESSONS_FILE:path.join(dir,"l.json"),LAYANX_TRUST_FILE:path.join(root,"t.json"),LAYANX_SECRET_VAULT_PATH:path.join(dir,"v"),LAYANX_AI_MODE:"local",LAYANX_FREE_POOL_ENABLED:"false",OPENAI_ENABLED:"false",ANTHROPIC_ENABLED:"false",GEMINI_ENABLED:"false",MT5_AUTO_START:"false"});
const {createRuntime}=await import("../src/runtime.js");
const core:any=createRuntime({storagePath:process.env.LAYANX_RUNTIME_STORAGE_PATH}).core;
const calls:string[]=[];let typingWorks=true;
const fake=(name:string,run:(p:any)=>unknown)=>{core.toolAdapters.unregister(name);core.toolAdapters.register(name,{async execute(r:any){calls.push(name);return run(r.payload??{});}});};
fake("desktop.app.open",()=>({opened:true,what:"calc"}));
fake("desktop.keyboard.type",p=>{if(!typingWorks)throw new Error("The front window is not Calculator. Nothing was sent to it.");return{characters:String(p.text).length,effect:{verified:null}};});
fake("desktop.ui.tree",()=>({window:"Calculator",elements:[{name:"Display is 1,000"}]}));
fake("desktop.screenshot",()=>({mimeType:"image/png",base64:"iVBORw0KGgo=",bytes:8}));

async function run(goal:string){
  let r=await core.runAgentGateway(goal,"ms",8,{},"core",{preferLocal:true});let approvals=0;
  for(let i=0;i<6&&r.paused&&r.approvalId;i++){core.executionRuntime.approvals.approve(r.approvalId);approvals++;r=await core.executeAgentLoop(r.missionId,"ms",8,{[r.nextToolIndex]:r.approvalId},"core");}
  return{r,approvals};
}
{
  const {r,approvals}=await run("افتح الحاسبة واحسب 125 × 8");
  assert.equal(r.completed,true,JSON.stringify(r.reason??r.status));
  assert.deepEqual(calls,["desktop.app.open","desktop.keyboard.type","desktop.ui.tree"],"each step once, typing not replaced by a screenshot");
  assert.equal(approvals,2,"one approval per dangerous step");
  const {composeTaskAnswer}=await import("../src/core/task-answer.js");
  assert.equal((await composeTaskAnswer(core.modelExecution,"افتح الحاسبة واحسب 125 × 8",r.results,true))!.text,"الحاسبة تعرض: 1000","the reply carries the step results from before the resume");
}
{
  calls.length=0;typingWorks=false;
  const {r}=await run("افتح الحاسبة واحسب 7 × 6");
  assert.equal(r.completed,false,"a failed step means the task is not done, even if the last step succeeds");
  assert.ok(!calls.filter(c=>c==="desktop.app.open").slice(1).length,"Calculator is opened once");
}
console.log("multi-step approval: resumes after the finished steps, keeps the planned step, and never finishes over a failed step");
process.exit(0);
