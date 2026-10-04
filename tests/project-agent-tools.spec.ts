import {mkdtemp,rm,readFile} from "node:fs/promises";
import {join} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {createFileWriteToolAdapter} from "../src/tools/fabric.js";
import {createGitToolAdapter} from "../src/tools/git.js";
import {ApprovalEngine} from "../src/security/approval.js";
import type {ToolRequest} from "../src/core/types.js";

const exec=promisify(execFile); const gitBinary="git";
const dir=await mkdtemp(join(process.cwd(),"project-agent-test-"));
await exec(gitBinary,["init","-q"],{cwd:dir});
await exec(gitBinary,["init","-q"],{cwd:join(dir,"project-a")});
await exec(gitBinary,["config","user.email","test@example.com"],{cwd:join(dir,"project-a")});
await exec(gitBinary,["config","user.name","LayanX Test"],{cwd:join(dir,"project-a")});

const base:ToolRequest={missionId:"m",agentId:"core",projectId:"project-a",tool:"files.write",action:"write file",permission:"L3_MODIFY",idempotencyKey:"write-1"};
const write=createFileWriteToolAdapter({root:dir});
const result=await write.execute({...base,payload:{path:"src/example.ts",content:"export const ok = true;\n"}});
if(!(result as {written:boolean}).written)throw new Error("File write failed.");
if(await readFile(join(dir,"project-a","src/example.ts"),"utf8")!=="export const ok = true;\n")throw new Error("Written content mismatch.");
await write.execute({...base,payload:{path:"../escape.ts",content:"blocked"}}).then(()=>{throw new Error("File write traversal was not blocked.");}).catch(error=>{if(!String(error).includes("escapes"))throw error;});

const git=createGitToolAdapter({root:dir});
const status=await git.execute({...base,tool:"git.status",action:"git status",permission:"L2_ANALYZE",idempotencyKey:"git-status",payload:{}});
if(!String((status as {stdout:string}).stdout).includes("src/"))throw new Error("Git status did not inspect the project workspace.");
await git.execute({...base,tool:"git.add",action:"git add",permission:"L4_EXECUTE",idempotencyKey:"git-add",payload:{path:"../outside"}}).then(()=>{throw new Error("Git path traversal was not blocked.");}).catch(error=>{if(!String(error).includes("escapes"))throw error;});
const previous=process.env.LAYANX_ALLOW_MAIN_PUSH;
delete process.env.LAYANX_ALLOW_MAIN_PUSH;
await git.execute({...base,tool:"git.push",action:"git push",permission:"L4_EXECUTE",idempotencyKey:"git-push",payload:{remote:"origin",branch:"main"}}).then(()=>{throw new Error("Main push was not blocked.");}).catch(error=>{if(!String(error).includes("main/master"))throw error;});
if(previous!==undefined)process.env.LAYANX_ALLOW_MAIN_PUSH=previous;

const approvals=new ApprovalEngine();
const approval=approvals.create({missionId:"m",agentId:"core",tool:"git.commit",action:"git commit",permission:"L4_EXECUTE",payloadHash:"approved-payload",reason:"commit",expiresAt:new Date(Date.now()+60000).toISOString()});
approvals.approve(approval.id);
if(approvals.authorize(approval.id,{missionId:"m",agentId:"core",tool:"git.commit",action:"git commit",permission:"L4_EXECUTE",payloadHash:"changed-payload"}).allowed)throw new Error("Approval payload binding was bypassed.");

await rm(dir,{recursive:true,force:true});
console.log("Project agent tool tests passed.");
