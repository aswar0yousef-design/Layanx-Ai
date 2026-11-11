/**
 * One real self-improvement cycle on this PC. It counts failures from real job records, picks the experiment they point to,
 * and runs the unchanged outside benchmark (outcome-build-types-acceptance.ts) before and after. The benchmark's judges know
 * nothing about this cycle, and the disposable ledger means nothing here changes how LayanX runs afterwards.
 *
 *   npx tsx scripts/outcome-improve-acceptance.ts --cases csv,wordcount --runs 3 [--ledger file] [--setting KEY=VALUE]
 */
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {mineFailures,proposeExperiments,readLedger,tryProposal,type BenchmarkScore,type Proposal} from "../src/autonomy/improvement-cycle.js";
import {resolveDataPaths} from "../src/platform/paths.js";

const arg=(name:string)=>{const i=process.argv.indexOf("--"+name);return i>=0?process.argv[i+1]:undefined;};
const cases=(arg("cases")??"csv,wordcount").split(","),runs=Number(arg("runs")??"3");
const runsRoot=path.join(resolveDataPaths().dataDir,"outcome-runs");
const ledgerFile=arg("ledger")??path.join(runsRoot,`improve-${new Date().toISOString().replace(/[:.]/g,"-")}.json`);

function sourceVersion(dir:string):string{
  const hash=createHash("sha256");
  const visit=(folder:string)=>{for(const entry of fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const full=path.join(folder,entry.name);
    if(entry.isDirectory())visit(full);else{hash.update(entry.name);hash.update(fs.readFileSync(full));}
  }};
  visit(dir);
  return hash.digest("hex").slice(0,16);
}
const benchmark=async(settings:Record<string,string>):Promise<BenchmarkScore>=>{
  const score:BenchmarkScore={runs:0,passed:0,falseSuccess:0,minutes:0,byCase:{}};
  for(const id of cases){
    const child=spawnSync(process.execPath,[...process.execArgv,"scripts/outcome-build-types-acceptance.ts","--runs",String(runs),"--case",id],{encoding:"utf8",windowsHide:true,maxBuffer:256*1024*1024,timeout:3*3600_000,env:{...process.env,...settings}});
    const report=/"report":\s*"([^"]+)"/.exec(child.stdout??"")?.[1]?.replace(/\\\\/g,"\\");
    if(!report||!fs.existsSync(report))throw new Error(`The benchmark produced no report for ${id}: ${(child.stderr??"").slice(-400)}`);
    const {records}=JSON.parse(fs.readFileSync(report,"utf8")) as {records:any[]};
    const passed=records.filter(r=>r.ok).length;
    score.byCase[id]={passed,runs:records.length};score.runs+=records.length;score.passed+=passed;
    score.falseSuccess+=records.filter(r=>r.falseSuccess).length;
    score.minutes+=records.reduce((sum,r)=>sum+(r.minutes??0),0);
    score.report=report;
  }
  console.log(JSON.stringify({settings,score}));
  return score;
};
const jobFiles=fs.readdirSync(runsRoot,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>path.join(runsRoot,entry.name,"store","supervisor-jobs.json")).filter(file=>fs.existsSync(file));
const patterns=mineFailures(jobFiles);
console.log(JSON.stringify({jobFiles:jobFiles.length,patterns:patterns.map(p=>({id:p.id,count:p.count,projects:p.projects}))}));
const codeVersion=sourceVersion("src");
const forced=arg("setting")?.split("=");
const proposals:Proposal[]=forced?[{title:"Requested experiment",reason:"Named on the command line.",settings:{[forced[0]!]:forced[1]!}}]:proposeExperiments(patterns,readLedger(ledgerFile),codeVersion,1);
if(!proposals.length){console.log("No experiment left to try on this code.");process.exit(0);}
const entry=await tryProposal({ledgerFile,benchmark,benchmarkId:`build-types:${cases.join("+")}:${runs}`,codeVersion},proposals[0]!);
console.log(JSON.stringify({ledger:ledgerFile,title:entry.title,settings:entry.settings,status:entry.status,why:entry.why,before:entry.before?.passed,after:entry.after?.map(s=>s.passed),of:entry.before?.runs},null,2));
process.exit(0);
