import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {createGitToolAdapter} from "../src/tools/git.js";
import type {ToolRequest} from "../src/core/types.js";

const exec=promisify(execFile);
const dir=await mkdtemp(join(process.cwd(),"git-safety-test-"));
await exec("git",["init","-q"],{cwd:dir});
await exec("git",["config","user.email","test@example.com"],{cwd:dir});
await exec("git",["config","user.name","LayanX Test"],{cwd:dir});
await writeFile(join(dir,"sample.txt"),"one\n","utf8");
await exec("git",["add","sample.txt"],{cwd:dir});
await exec("git",["commit","-m","initial"],{cwd:dir});

const adapter=createGitToolAdapter({root:join(dir,"..")});
const base:ToolRequest={missionId:"m",agentId:"core",projectId:dir.split("/").pop(),tool:"git.checkpoint",action:"git checkpoint",permission:"L2_ANALYZE",idempotencyKey:"checkpoint",payload:{}};
const checkpoint=await adapter.execute(base) as {stdout:string;exitCode:number};
if(checkpoint.exitCode!==0||!/^[0-9a-f]{40}\s*$/i.test(checkpoint.stdout))throw new Error("Checkpoint did not return an exact commit SHA.");

await adapter.execute({...base,tool:"git.branch",action:"git branch",permission:"L4_EXECUTE",idempotencyKey:"branch",payload:{branch:"layanx/repair-test"}});
await writeFile(join(dir,"sample.txt"),"changed\n","utf8");
await exec("git",["add","sample.txt"],{cwd:dir});
await exec("git",["commit","-m","change"],{cwd:dir});
await adapter.execute({...base,tool:"git.rollback",action:"git rollback",permission:"L4_EXECUTE",idempotencyKey:"rollback",payload:{commit:checkpoint.stdout.trim()}});
const {stdout}=await exec("git",["show","HEAD:sample.txt"],{cwd:dir});
if(stdout!=="one\n")throw new Error("Rollback did not restore the checkpoint.");

await rm(dir,{recursive:true,force:true});
console.log("Git safety tests passed.");
