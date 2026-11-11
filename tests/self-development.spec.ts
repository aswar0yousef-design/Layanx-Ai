import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {protectedChanges,runSelfDevelopment} from "../src/autonomy/self-development.js";

assert.deepEqual(protectedChanges(["src/voice/ui.ts","tests/a.spec.ts","src/core/runtime.ts","package.json","scripts/security-check.mjs","src\\autonomy\\trust.ts"]),["tests/a.spec.ts","src/core/runtime.ts","package.json","scripts/security-check.mjs","src\\autonomy\\trust.ts"]);

const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-selfdev-"));
const repo=path.join(root,"repo"),workspaceRoot=path.join(root,"work");
fs.mkdirSync(path.join(repo,"src"),{recursive:true});
const git=(...args:string[])=>{const r=spawnSync("git",["-c","user.name=t","-c","user.email=t@local.invalid",...args],{cwd:repo,encoding:"utf8",windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout;};
fs.writeFileSync(path.join(repo,"src/a.js"),"export const a=1;\n");
git("init","-q","-b","main");git("add","-A");git("commit","-q","-m","base");
const head=git("rev-parse","HEAD").trim();
// A fake job standing in for the supervisor: it edits what the scenario says and finishes.
const supervisorThat=(file:string,status="completed")=>({create(_goal:string,projectId:string){
  if(file)fs.mkdirSync(path.dirname(path.join(workspaceRoot,projectId,file)),{recursive:true});
  if(file)fs.writeFileSync(path.join(workspaceRoot,projectId,file),"changed\n");
  return{id:"job",status,result:"r"} as never;
}});
const passing=async()=>({ok:true,summary:"all good"}),failing=async()=>({ok:false,summary:"3 failed"});
try{
  const good=await runSelfDevelopment({goal:"fix",repo,workspaceRoot,supervisor:supervisorThat("src/a.js"),gate:passing,pollMs:5});
  assert.equal(good.status,"awaiting_approval");assert.deepEqual(good.changedFiles,["src/a.js"]);assert.equal(good.mergeCommand,`git merge --no-ff ${good.branch}`);
  // The owner's branch has not moved and the work is on its own branch.
  assert.equal(git("rev-parse","main").trim(),head);assert.notEqual(git("rev-parse",good.branch).trim(),head);
  assert.equal(fs.readFileSync(path.join(repo,"src/a.js"),"utf8"),"export const a=1;\n");
  const gate=await runSelfDevelopment({goal:"fix",repo,workspaceRoot,supervisor:supervisorThat("src/a.js"),gate:failing,pollMs:5});
  assert.equal(gate.status,"failed");assert.equal(gate.mergeCommand,undefined);assert.match(gate.reason!,/release gate failed/);
  let ranGate=false;
  const guard=await runSelfDevelopment({goal:"fix",repo,workspaceRoot,supervisor:supervisorThat("src/core/runtime.ts"),gate:async()=>{ranGate=true;return{ok:true,summary:""};},pollMs:5});
  assert.equal(guard.status,"refused");assert.equal(ranGate,false);assert.equal(guard.mergeCommand,undefined);
  const unfinished=await runSelfDevelopment({goal:"fix",repo,workspaceRoot,supervisor:supervisorThat("","failed"),gate:passing,pollMs:5});
  assert.equal(unfinished.status,"failed");assert.match(unfinished.reason!,/did not finish/);
  const nothing=await runSelfDevelopment({goal:"fix",repo,workspaceRoot,supervisor:supervisorThat(""),gate:passing,pollMs:5});
  assert.equal(nothing.status,"failed");assert.match(nothing.reason!,/changed nothing/);
  assert.equal(git("rev-parse","main").trim(),head);
}finally{fs.rmSync(root,{recursive:true,force:true,maxRetries:3});}
console.log("self-development: separate branch, release gate, guards refused, and it can never merge by itself");
