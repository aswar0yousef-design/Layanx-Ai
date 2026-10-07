import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Supervisor,type SupervisorDeps} from "../src/autonomy/supervisor.js";
import {externalDockerCommand,pinnedImage,createExternalAgentAdapter} from "../src/autonomy/external-agents.js";
import {setIsolation} from "../src/autonomy/sandbox.js";

process.env.LAYANX_STORE_DIR=fs.mkdtempSync(path.join(os.tmpdir(),"lx-store-"));
const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-queue-"));
process.env.LAYANX_WORKSPACE_ROOT=root;
fs.mkdirSync(path.join(root,"shop"),{recursive:true});fs.mkdirSync(path.join(root,"blog"),{recursive:true});
const info=(p:string)=>({dir:path.join(root,p),stack:"node" as const,packageManager:"npm" as const,scripts:["test"],hasLockfile:true,git:false,tasks:[]});

// 1. Two jobs on the same project never run at the same time; another project is not blocked.
let releaseFirst!:()=>void;const firstGate=new Promise<void>(r=>{releaseFirst=r;});
const active=new Map<string,number>();let maxSameProject=0;const order:string[]=[];
const deps:SupervisorDeps={
  async think(){return JSON.stringify({acceptance:["works"],milestones:[{title:"Do",goal:"do it",kind:"code"}],checks:{test:true}});},
  async runAgent(goal,projectId){
    order.push(projectId+":"+goal);
    active.set(projectId,(active.get(projectId)??0)+1);maxSameProject=Math.max(maxSameProject,active.get("shop")??0);
    if(goal.includes("first shop job"))await firstGate;
    active.set(projectId,(active.get(projectId)??1)-1);
    return{completed:true,missionId:"m"};
  },
  async resumeAgent(){return{completed:true};},
  async runTool(){return{ok:true,data:{ok:true,exitCode:0}};},
  isApproved:()=>false,cloudAvailable:()=>false,externalAgent:()=>null,detect:p=>info(p)
};
const sup=new Supervisor(deps,{pollMs:5});
const a=sup.create("first shop job: add the cart","shop");
await new Promise(r=>setTimeout(r,60));
const b=sup.create("second shop job: add the wishlist","shop");
const c=sup.create("blog job: add an about page","blog");
const until=async(f:()=>boolean,ms=8000)=>{const end=Date.now()+ms;while(!f()){if(Date.now()>end)throw new Error("timeout: "+JSON.stringify(sup.list().map(j=>[j.goal.slice(0,20),j.status])));await new Promise(r=>setTimeout(r,10));}};
await until(()=>sup.get(b.id)!.status==="queued");
await until(()=>sup.get(c.id)!.status==="completed");
assert.equal(sup.get(a.id)!.status==="completed",false,"first job still running");
assert.ok(sup.get(b.id)!.log.some(l=>/Waiting for the earlier job on this project/.test(l.msg)));
releaseFirst();
await until(()=>sup.get(a.id)!.status==="completed"&&sup.get(b.id)!.status==="completed");
assert.equal(maxSameProject,1,"never two agents at once on one project");
const firstAt=order.findIndex(o=>o.includes("first shop job")),secondAt=order.findIndex(o=>o.includes("second shop job"));
assert.ok(firstAt>=0&&secondAt>firstAt,"older job first");
sup.stop();

// 2. Docker-isolated projects run coding agents only inside a pinned container.
assert.equal(pinnedImage("paulgauthier/aider:0.86.1"),true);
assert.equal(pinnedImage("paulgauthier/aider:latest"),false);
assert.equal(pinnedImage("paulgauthier/aider"),false);
assert.equal(pinnedImage("ghcr.io/x/y@sha256:"+"a".repeat(64)),true);
const aider={name:"aider" as const,kind:"local" as const,path:"C:\\Python\\Scripts\\aider.exe",label:"Aider"};
assert.throws(()=>externalDockerCommand(aider,"fix the bug",path.join(root,"shop"),{}),/LAYANX_AGENT_IMAGE_AIDER/);
assert.throws(()=>externalDockerCommand(aider,"fix the bug",path.join(root,"shop"),{LAYANX_AGENT_IMAGE_AIDER:"paulgauthier/aider:latest"}),/exact version/);
const cmd=externalDockerCommand(aider,"fix the bug; rm -rf /",path.join(root,"shop"),{LAYANX_AGENT_IMAGE_AIDER:"paulgauthier/aider:0.86.1",LAYANX_CODER_MODEL:"qwen2.5-coder:7b"});
assert.equal(cmd.command,"docker");
assert.ok(cmd.args.includes("--cap-drop")&&cmd.args.includes("no-new-privileges"));
assert.ok(cmd.args.includes(`type=bind,source=${path.join(root,"shop")},target=/work`),"only the project folder is mounted");
assert.ok(cmd.args.includes("OLLAMA_API_BASE=http://host.docker.internal:11434"),"the container reaches Ollama on this PC");
assert.ok(!cmd.args.some(a=>a.includes("C:\\Python")),"no host paths inside the container command");
assert.equal(cmd.args.filter(a=>a.includes("rm -rf")).length,1,"task text is one argument");
// The adapter refuses to fall back to the host when the project is Docker-isolated.
const isoFile=path.join(process.env.LAYANX_STORE_DIR!,"isolation.json");process.env.LAYANX_ISOLATION_FILE=isoFile;
setIsolation(isoFile,"shop","docker");
process.env.LAYANX_AIDER_PATH=process.execPath; // pretend aider is installed
delete process.env.LAYANX_AGENT_IMAGE_AIDER;
await assert.rejects(createExternalAgentAdapter().execute({projectId:"shop",payload:{agent:"aider",task:"fix the failing test"}} as any) as Promise<unknown>,/isolated in Docker/);
delete process.env.LAYANX_AIDER_PATH;
fs.rmSync(root,{recursive:true,force:true});
console.log("supervisor-queue-docker-agents: one job per project, other projects in parallel, coding agents stay inside Docker isolation");
process.exit(0);
