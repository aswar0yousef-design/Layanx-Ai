/**
 * Restart acceptance. Starts the real API as its own process, plans a mission with the local model, records a release,
 * kills the process outright and starts a new one on the same storage. This script decides what survived.
 *
 *   npx tsx scripts/outcome-restart-acceptance.ts
 *   LAYANX_RESTART_DATABASE_URL=postgres://... npx tsx scripts/outcome-restart-acceptance.ts
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {spawn,spawnSync,type ChildProcess} from "node:child_process";
import {resolveDataPaths} from "../src/platform/paths.js";

const id="restart-"+randomUUID().slice(0,8);
const root=path.join(resolveDataPaths().dataDir,"outcome-runs",new Date().toISOString().replace(/[:.]/g,"-")+"-"+id);
const store=path.join(root,"store"),projects=path.join(root,"projects");
fs.mkdirSync(store,{recursive:true,mode:0o700});fs.mkdirSync(projects,{recursive:true,mode:0o700});
const databaseUrl=process.env.LAYANX_RESTART_DATABASE_URL??"";
const model=process.env.OLLAMA_MODEL||"gpt-oss:20b";
const port=await new Promise<number>(resolve=>{const s=http.createServer().listen(0,"127.0.0.1",()=>{const p=(s.address() as {port:number}).port;s.close(()=>resolve(p));});});
const env:NodeJS.ProcessEnv={...process.env,
  LAYANX_API_HOST:"127.0.0.1",LAYANX_API_PORT:String(port),LAYANX_FLOW_HOST:"127.0.0.1",LAYANX_FLOW_PORT:String(port+1),LAYANX_API_TOKEN:"",
  LAYANX_WORKSPACE_ROOT:projects,LAYANX_STORE_DIR:store,LAYANX_DATA_DIR:root,LAYANX_DATABASE_URL:databaseUrl,DATABASE_URL:databaseUrl,
  LAYANX_RUNTIME_STORAGE_PATH:path.join(store,"runtime.json"),LAYANX_BUSINESS_STORAGE_PATH:path.join(store,"business.json"),LAYANX_MEDIA_STORAGE_PATH:path.join(store,"media.json"),
  LAYANX_LESSONS_FILE:path.join(store,"lessons.json"),LAYANX_PLAYBOOKS_DIR:path.join(store,"playbooks"),LAYANX_TRUST_FILE:path.join(root,"trust.json"),LAYANX_ISOLATION_FILE:path.join(root,"isolation.json"),LAYANX_SECRET_VAULT_PATH:path.join(store,"secrets.vault"),LAYANX_FREE_POOL_CONFIG:path.join(store,"free-providers.json"),
  LAYANX_AI_MODE:"local",LAYANX_CAPABILITIES:"coding",LAYANX_FREE_POOL_ENABLED:"false",OPENAI_ENABLED:"false",ANTHROPIC_ENABLED:"false",GEMINI_ENABLED:"false",MT5_AUTO_START:"false",LAYANX_OPEN_BROWSER:"off",
  OLLAMA_MODEL:model,LAYANX_OLLAMA_MODEL_PLAN:JSON.stringify({general:model,planning:model,coding:model,fast:model})};

const api=`http://127.0.0.1:${port}`;
const log=fs.openSync(path.join(root,"api.log"),"a");
async function start():Promise<ChildProcess>{
  const child=spawn(process.execPath,["node_modules/tsx/dist/cli.mjs","src/api.ts"],{cwd:process.cwd(),env,stdio:["ignore",log,log],windowsHide:true});
  for(let i=0;i<240;i++){
    if(child.exitCode!==null)throw new Error("The API exited during startup; see "+path.join(root,"api.log"));
    try{if((await fetch(api+"/v1/health",{signal:AbortSignal.timeout(1000)})).ok)return child;}catch{}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error("The API did not become healthy.");
}
function kill(child:ChildProcess){
  if(process.platform==="win32")spawnSync("taskkill",["/PID",String(child.pid),"/T","/F"],{windowsHide:true});
  else child.kill("SIGKILL");
}
const post=async(url:string,data:unknown)=>{const r=await fetch(api+url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data),signal:AbortSignal.timeout(420_000)});return{status:r.status,body:await r.json() as any};};
const get=async(url:string)=>await (await fetch(api+url)).json() as any;
const checks:Record<string,boolean>={};
const release={id:"release-"+id,missionId:id,projectId:"default",branch:"feature/x",baseBranch:"main",commit:"abc123",title:"Restart acceptance"};

let child=await start();
let failure:string|undefined,plan:any,cancelled:any;
try{
  const started=Date.now();
  plan=await post("/v1/missions",{goal:"List the files in this project and report how many there are."});
  console.log("planned",plan.status,Math.round((Date.now()-started)/1000)+"s",plan.body.error??"");
  checks.missionAccepted=plan.status===201;
  if(!checks.missionAccepted)throw new Error("planning failed: "+plan.body.error);
  cancelled=await post("/v1/missions",{goal:"Report the size of the largest file in this project."});
  checks.secondAccepted=cancelled.status===201;
  if(!checks.secondAccepted)throw new Error("planning failed: "+cancelled.body.error);
  checks.cancelAccepted=(await post(`/v1/missions/${cancelled.body.mission.id}/cancel`,{projectId:"default"})).status===200;
  checks.releaseAccepted=(await post("/v1/release",release)).status===201;
  checks.transitionAccepted=(await post(`/v1/release/${release.id}/transition`,{stage:"REVIEWED"})).status===200;

  kill(child);
  await new Promise(resolve=>setTimeout(resolve,1500));
  checks.processReallyGone=await fetch(api+"/v1/health",{signal:AbortSignal.timeout(1000)}).then(()=>false,()=>true);

  child=await start();
  const find=async()=>{const missions=(await get("/v1/missions")).missions as any[];return{planned:missions.find(m=>m.id===plan.body.mission.id),cancelled:missions.find(m=>m.id===cancelled.body.mission.id)};};
  const first=await find();
  checks.missionSurvived=first.planned?.goal===plan.body.mission.goal;
  // Compared by value: PostgreSQL's JSONB does not keep key order.
  checks.stepsSurvived=isDeepStrictEqual(first.planned?.tools??[],plan.body.mission.tools??[])&&isDeepStrictEqual(first.planned?.steps,plan.body.mission.steps);
  checks.cancelSurvived=first.cancelled?.status==="cancelled";
  await new Promise(resolve=>setTimeout(resolve,15_000));
  const later=await find();
  checks.didNotRunByItself=later.planned?.status==="planned"&&later.planned?.steps?.every((s:any)=>s.status==="pending");
  const releaseAfter=()=>get("/v1/release").then(r=>(r.releases as any[]).find(x=>x.id===release.id));
  checks.releaseSurvived=(await releaseAfter())?.stage==="REVIEWED";
  checks.continuesAfterRestart=(await post(`/v1/release/${release.id}/transition`,{stage:"SECURITY_APPROVED"})).status===200;
  checks.duplicateRejected=(await post("/v1/release",release)).status===422;
  checks.notReset=(await releaseAfter())?.stage==="SECURITY_APPROVED";
}catch(error){failure=error instanceof Error?error.message:String(error);}
finally{kill(child);}

const ok=!failure&&Object.values(checks).every(Boolean)&&Object.keys(checks).length===14;
const reportFile=path.join(root,"restart-result.json");
const body={at:new Date().toISOString(),ok,storage:databaseUrl?"postgresql":process.env.LAYANX_STORAGE==="json"?"json":"sqlite",model,checks,failure,missionId:plan?.body?.mission?.id,cancelledId:cancelled?.body?.mission?.id,releaseId:release.id};
fs.writeFileSync(reportFile,JSON.stringify(body,null,2),{mode:0o600});
console.log(JSON.stringify({reportFile,...body},null,2));
process.exit(ok?0:1);
