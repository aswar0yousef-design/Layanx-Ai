import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {applyKeptSettings,classifyFailureText,judge,mineFailures,proposeExperiments,readLedger,rollBack,settingRefusal,tryProposal,type BenchmarkScore} from "../src/autonomy/improvement-cycle.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"improve-"));
let serial=0;
const ledgerFile=()=>path.join(root,`ledger-${++serial}.json`);
const score=(a:number,b:number,falseSuccess=0,minutes=30):BenchmarkScore=>({runs:6,passed:a+b,falseSuccess,minutes,byCase:{x:{passed:a,runs:3},y:{passed:b,runs:3}}});
const THINK={LAYANX_OLLAMA_THINK:"on"};
const input=(ledger:string,results:BenchmarkScore[],calls:Array<Record<string,string>>=[])=>({ledgerFile:ledger,benchmarkId:"b",codeVersion:"v1",benchmark:async(env:Record<string,string>)=>{calls.push(env);return results.shift()!;}});
const proposal={title:"t",reason:"r",settings:THINK};

// What may not change, whatever the score.
for(const key of ["LAYANX_TRUST_DEFAULT","LAYANX_ISOLATION","LAYANX_AUTO_APPROVE","OPENAI_API_KEY","LAYANX_FREE_POOL_ENABLED","LAYANX_LIVE_TRADING","MT5_AUTO_START","__proto__"])assert.match(settingRefusal({[key]:"1"})!,/not something/);
assert.match(settingRefusal({})!,/changes nothing/);
assert.match(settingRefusal({LAYANX_OLLAMA_CONTEXT:"lots"})!,/outside/);
assert.match(settingRefusal({LAYANX_REVIEW_MODEL:"gpt-5:cloud"})!,/cloud/i);
assert.equal(settingRefusal({LAYANX_REVIEW_MODEL:"gpt-oss:20b"}),undefined);

// The judge.
assert.equal(judge(score(1,1),score(2,1)).keep,true);
assert.match(judge(score(2,1),score(3,0)).why,/Worse on: y/);
assert.match(judge(score(1,1),score(2,2,1)).why,/False successes rose/);
assert.match(judge(score(1,1),score(1,1)).why,/No measured gain/);
assert.equal(judge(score(1,1),score(1,1,0,20)).keep,true);
assert.equal(judge(score(1,1),score(2,1),2).keep,false);
assert.equal(judge(score(1,1,1),score(1,1,0)).keep,true);
assert.match(judge(score(1,1),{...score(1,1),runs:3}).why,/not comparable/);

{ // A real gain is confirmed by a second run, recorded with its numbers, and used at the next start.
  const file=ledgerFile(),calls:Array<Record<string,string>>=[];
  const entry=await tryProposal(input(file,[score(1,1),score(3,1),score(2,2)],calls),proposal);
  assert.equal(entry.status,"kept");
  assert.equal(calls.length,3);
  assert.deepEqual(calls[0],{});
  assert.deepEqual(calls[1],THINK);
  assert.equal(entry.after!.length,2);
  const env:NodeJS.ProcessEnv={};
  assert.deepEqual(applyKeptSettings(file,env),["LAYANX_OLLAMA_THINK"]);
  assert.equal(env.LAYANX_OLLAMA_THINK,"on");
  const owner:NodeJS.ProcessEnv={LAYANX_OLLAMA_THINK:"off"};
  assert.deepEqual(applyKeptSettings(file,owner),[]);
  assert.equal(owner.LAYANX_OLLAMA_THINK,"off");
  rollBack(file,entry.id,"stopped helping");
  assert.deepEqual(applyKeptSettings(file,{}),[]);
  assert.equal(readLedger(file).entries[0]!.status,"rolled_back");
}
{ // A gain that does not repeat is noise.
  const entry=await tryProposal(input(ledgerFile(),[score(1,1),score(2,1),score(1,1)]),proposal);
  assert.equal(entry.status,"rejected");
  assert.match(entry.why,/did not repeat/);
}
{ // A loss leaves nothing behind, and is not tried again on the same code.
  const file=ledgerFile(),calls:Array<Record<string,string>>=[];
  const entry=await tryProposal(input(file,[score(2,2),score(1,2)],calls),proposal);
  assert.equal(entry.status,"rejected");
  assert.deepEqual(applyKeptSettings(file,{}),[]);
  const again=await tryProposal(input(file,[],calls),proposal);
  assert.equal(again.status,"refused");
  assert.match(again.why,/Already tried/);
  assert.equal(calls.length,2);
}
{ // A refused proposal never reaches the benchmark, a tampered ledger cannot smuggle a setting in, and one baseline serves several tries.
  const file=ledgerFile(),calls:Array<Record<string,string>>=[];
  assert.equal((await tryProposal(input(file,[],calls),{...proposal,settings:{LAYANX_TRUST_DEFAULT:"trusted"}})).status,"refused");
  assert.equal(calls.length,0);
  const ledger=readLedger(file);ledger.entries[0]!.status="kept";fs.writeFileSync(file,JSON.stringify(ledger));
  const env:NodeJS.ProcessEnv={};
  assert.deepEqual(applyKeptSettings(file,env),[]);
  assert.equal(env.LAYANX_TRUST_DEFAULT,undefined);
  const results=[score(2,2),score(2,2)];
  await tryProposal(input(file,results,calls),proposal);
  await tryProposal(input(file,[score(2,2)],calls),{...proposal,settings:{LAYANX_OLLAMA_CONTEXT:"16384"}});
  assert.deepEqual(calls.map(c=>Object.keys(c).join()),["","LAYANX_OLLAMA_THINK","LAYANX_OLLAMA_CONTEXT"]);
}
{ // Failures are counted from job records and lead to experiments not yet tried.
  assert.equal(classifyFailureText("Patch rejected: The model returned no edits."),"no-edits");
  assert.equal(classifyFailureText("all good"),undefined);
  const jobs=path.join(root,"jobs.json");
  fs.writeFileSync(jobs,JSON.stringify([
    {projectId:"a",log:[{msg:"Patch rejected: The model returned no edits."},{msg:"Patch rejected: The model returned no edits."}],milestones:[{notes:"ReferenceError: document is not defined"}]},
    {projectId:"b",log:[{msg:"Patch rejected: The model returned no edits."}],milestones:[]}
  ]));
  fs.writeFileSync(path.join(root,"broken.json"),"{");
  const mined=mineFailures([jobs,path.join(root,"broken.json"),path.join(root,"absent.json")]);
  assert.deepEqual(mined.map(p=>[p.id,p.count,p.projects]),[["no-edits",3,2],["scope",1,1]]);
  const ledger={entries:[],baselines:{}};
  assert.deepEqual(proposeExperiments(mined,ledger,"v1")[0]!.settings,THINK);
  const tried={entries:[{id:"x",at:"",title:"",reason:"",settings:THINK,status:"rejected" as const,why:"",codeVersion:"v1"}],baselines:{}};
  assert.deepEqual(proposeExperiments(mined,tried,"v1"),[]);
  assert.equal(proposeExperiments(mined,tried,"v2").length,1);
}
fs.rmSync(root,{recursive:true,force:true});
console.log("improvement-cycle: only measured, repeated gains stay; guarded settings cannot be touched; failures become experiments");
