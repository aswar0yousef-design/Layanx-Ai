/**
 * One day of learning, started by the daily schedule or by hand. It never runs real work: the benchmark uses throwaway
 * folders, and only a guide that did no harm joins what LayanX uses.
 *
 *   npx tsx scripts/skills-daily.ts --store <folder> --ledger <improvement ledger> [--topics 3] [--runs 2] [--no-experiment]
 */
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {resolveDataPaths} from "../src/platform/paths.js";
import {runDailyLearning} from "../src/autonomy/daily-learning.js";
import {mineFailures,type BenchmarkScore} from "../src/autonomy/improvement-cycle.js";
import {gitHubClient} from "../src/autonomy/skill-scout.js";

const arg=(name:string)=>{const i=process.argv.indexOf("--"+name);return i>=0?process.argv[i+1]:undefined;};
const store=path.resolve(arg("store")??process.env.LAYANX_STORE_DIR??".layanx"),improvementLedger=arg("ledger")??path.join(store,"improvement-ledger.json");
const cases=["csv","wordcount"],runs=Number(arg("runs")??"2"),runsRoot=path.join(resolveDataPaths().dataDir,"outcome-runs");
process.env.LAYANX_STORE_DIR=store;
const baseUrl=(process.env.OLLAMA_BASE_URL||"http://127.0.0.1:11434").replace(/\/+$/,""),model=process.env.OLLAMA_MODEL||"gpt-oss:20b";
const think=async(prompt:string)=>{
  const response=await fetch(baseUrl+"/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({model,stream:false,messages:[{role:"user",content:prompt}],options:{num_ctx:8192}}),signal:AbortSignal.timeout(300_000)});
  if(!response.ok)throw new Error("Ollama answered "+response.status);
  return String(((await response.json()) as {message?:{content?:string}}).message?.content??"");
};
const benchmark=async(guidanceFile?:string):Promise<BenchmarkScore>=>{
  const score:BenchmarkScore={runs:0,passed:0,falseSuccess:0,minutes:0,byCase:{}};
  for(const id of cases){
    const child=spawnSync(process.execPath,[...process.execArgv,"scripts/outcome-build-types-acceptance.ts","--runs",String(runs),"--case",id],{encoding:"utf8",windowsHide:true,maxBuffer:256*1024*1024,timeout:3*3600_000,env:{...process.env,LAYANX_TASK_RESEARCH:"local",LAYANX_BENCHMARK_GUIDANCE_FILE:guidanceFile??""}});
    const report=/"report":\s*"([^"]+)"/.exec(child.stdout??"")?.[1]?.replace(/\\\\/g,"\\");
    if(!report||!fs.existsSync(report))throw new Error(`no report for ${id}: ${(child.stderr??"").slice(-300)}`);
    const records=(JSON.parse(fs.readFileSync(report,"utf8")) as {records:any[]}).records,passed=records.filter(r=>r.ok).length;
    score.byCase[id]={passed,runs:records.length};score.runs+=records.length;score.passed+=passed;score.falseSuccess+=records.filter(r=>r.falseSuccess).length;score.minutes+=records.reduce((sum,r)=>sum+(r.minutes??0),0);
  }
  return score;
};
const jobsFile=path.join(store,"supervisor-jobs.json");
let recentGoals:string[]=[];try{recentGoals=(JSON.parse(fs.readFileSync(jobsFile,"utf8")) as Array<{goal:string}>).slice(-8).map(job=>job.goal);}catch{}
const failures=mineFailures(fs.existsSync(jobsFile)?[jobsFile]:[]).map(pattern=>pattern.label);
const records=await runDailyLearning({ledgerFile:path.join(store,"learning-ledger.json"),workDir:path.join(store,"learning-trials"),failures:process.argv.includes("--no-failures")?[]:failures,recentGoals,client:gitHubClient(),research:{think},benchmark,maxTopics:Number(arg("topics")??"3"),log:line=>console.log(new Date().toISOString(),line)});
console.log(JSON.stringify(records.map(record=>({topic:record.topic,title:record.title,source:record.source,status:record.status,why:record.why})),null,1));
if(!process.argv.includes("--no-experiment")){
  const improve=spawnSync(process.execPath,[...process.execArgv,"scripts/outcome-improve-acceptance.ts","--ledger",improvementLedger,"--cases",cases.join(","),"--runs",String(runs)],{encoding:"utf8",windowsHide:true,maxBuffer:256*1024*1024,timeout:8*3600_000});
  console.log((improve.stdout??"").trim().split(/\r?\n/).slice(-14).join("\n"));
}
void runsRoot;
process.exit(0);
