import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate from whatever identity the machine has.
const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-git-identity-"));
const home=path.join(root,"home");fs.mkdirSync(home);
process.env.HOME=home;process.env.USERPROFILE=home;process.env.XDG_CONFIG_HOME=home;
const {createGitToolAdapter}=await import("../src/tools/git.js");
const {ProjectIsolation}=await import("../src/security/project-isolation.js");

const adapter=createGitToolAdapter({root});
const workspace=new ProjectIsolation().workspacePath(path.resolve(root),"site");
fs.mkdirSync(workspace,{recursive:true});
const git=(...args:string[])=>execFileSync("git",args,{cwd:workspace,encoding:"utf8",windowsHide:true,env:{...process.env,HOME:home,USERPROFILE:home,GIT_CONFIG_NOSYSTEM:"1"}}).trim();
git("init","--quiet");
const commit=async(message:string)=>adapter.execute({action:"git commit",projectId:"site",payload:{message}} as never) as Promise<{exitCode:number}>;
const change=async(name:string)=>{fs.writeFileSync(path.join(workspace,name),name);await adapter.execute({action:"git add",projectId:"site",payload:{path:name}} as never);};

await change("a.txt");
const first=await commit("first");
assert.equal(first.exitCode,0,"a project on a machine with no git identity still gets its commits");
assert.equal(git("log","-1","--format=%an"),"LayanX");

git("config","user.name","Owner Name");git("config","user.email","owner@example.test");
await change("b.txt");
const second=await commit("second");
assert.equal(second.exitCode,0);
assert.equal(git("log","-1","--format=%an <%ae>"),"Owner Name <owner@example.test>","the owner's identity always wins");
assert.equal(git("config","--get-regexp","^user\\.").split("\n").length,2,"git config is not changed");
console.log("git-commit-identity: commits work with and without an owner identity");
