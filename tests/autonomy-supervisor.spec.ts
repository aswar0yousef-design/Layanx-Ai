import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Supervisor,type SupervisorDeps} from "../src/autonomy/supervisor.js";
process.env.LAYANX_STORE_DIR=(await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(),"lx-store-"));

const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-sup-"));
process.env.LAYANX_WORKSPACE_ROOT=root;
fs.mkdirSync(path.join(root,"shop",".git"),{recursive:true});
const until=async(f:()=>boolean,ms=8000)=>{const end=Date.now()+ms;while(!f()){if(Date.now()>end)throw new Error("timeout");await new Promise(r=>setTimeout(r,10));}};
const info={dir:path.join(root,"shop"),stack:"node" as const,packageManager:"npm" as const,scripts:["test","build","dev"],hasLockfile:true,git:true,tasks:[]};

function scenario(opts:{testFailures:number;needApproval?:boolean;cloud?:boolean;visualIssue?:boolean}){
  const calls:{agents:Array<{agent:string;routing?:unknown;goal:string}>;tools:Array<{tool:string;payload:any}>;think:Array<{cloud?:boolean;images:number}>}={agents:[],tools:[],think:[]};
  let testRuns=0,approved=false,visualAsked=0;
  const deps:SupervisorDeps={
    async think(prompt,o={}){
      calls.think.push({cloud:o.cloud,images:o.images?.length??0});
      if(o.images?.length){visualAsked++;return JSON.stringify(opts.visualIssue&&visualAsked===1?{ok:false,issues:["the header overlaps the menu on mobile"]}:{ok:true,issues:[]});}
      return "<think>plan</think>```json\n"+JSON.stringify({acceptance:["products page lists products"],milestones:[{title:"API",goal:"add products API",kind:"code"},{title:"Page",goal:"add products page",kind:"code"}],checks:{test:true,build:true,browser:{path:"/products"}}})+"\n```";
    },
    async runAgent(goal,projectId,agentId,routing){
      calls.agents.push({agent:agentId,routing,goal});
      if(opts.needApproval&&!approved)return{paused:true,missionId:"m-approval",approvalId:"ap-1",nextToolIndex:2};
      return{completed:true,missionId:"m-"+calls.agents.length};
    },
    async resumeAgent(){return{completed:true,missionId:"m-approval"};},
    async runTool(_p,tool,payload){
      calls.tools.push({tool,payload});
      if(tool==="project.run"&&payload.task==="test"){testRuns++;const fail=testRuns>1&&testRuns<=1+opts.testFailures;return{ok:true,data:{ok:!fail,exitCode:fail?1:0,stdout:fail?"1 failing: products API returns 500":"ok"}};}
      if(tool==="project.run"&&payload.task==="dev:start")return{ok:true,data:{running:true,url:"http://localhost:5173"}};
      if(tool==="browser.test")return{ok:true,data:{ok:true,problems:[],results:[{viewport:"desktop",screenshot:{mimeType:"image/jpeg",base64:"AAAA"}},{viewport:"mobile",screenshot:{mimeType:"image/jpeg",base64:"BBBB"}}]}};
      return{ok:true,data:{ok:true,exitCode:0}};
    },
    isApproved:id=>{if(id==="ap-1"&&approved)return true;return false;},
    cloudAvailable:()=>Boolean(opts.cloud),
    externalAgent:()=>({name:"aider",kind:"local"}),
    detect:()=>info
  };
  return{deps,calls,approve:()=>{approved=true;}};
}

// 1) happy path: plan -> baseline -> 2 milestones -> commits -> dev server + browser + vision -> notes
{
  const s=scenario({testFailures:0});
  const file=path.join(root,"jobs1.json");
  const sup=new Supervisor(s.deps,{file,pollMs:5});
  const job=sup.create("أضف صفحة منتجات للمتجر","shop");
  await until(()=>["completed","failed"].includes(sup.get(job.id)!.status));
  const j=sup.get(job.id)!;
  assert.equal(j.status,"completed",j.log.map(l=>l.msg).join("\n"));
  assert.equal(j.milestones.length,2);assert.deepEqual(s.calls.agents.map(a=>a.agent),["coder","coder"],"code milestones go to the coder agent");
  assert.ok(s.calls.tools.some(t=>t.tool==="project.run"&&t.payload.task==="install"),"dependencies installed first");
  const commits=s.calls.tools.filter(t=>t.tool==="git.commit").map(t=>t.payload.message);
  assert.equal(commits.filter(m=>m!=="LayanX: project notes").length,2,"one checkpoint commit per milestone");
  assert.equal(commits.at(-1),"LayanX: project notes","project memory is committed last so the branch is clean to merge");
  assert.ok(s.calls.tools.some(t=>t.tool==="browser.test"&&t.payload.url==="http://localhost:5173/products"));
  assert.ok(s.calls.think.some(t=>t.images===2),"vision model looked at desktop and mobile screenshots");
  assert.ok(s.calls.tools.some(t=>t.payload.task==="dev:stop"));
  assert.match(fs.readFileSync(path.join(root,"shop",".layanx","CHANGELOG.md"),"utf8"),/أضف صفحة منتجات/);
  assert.ok(fs.existsSync(path.join(root,"shop",".layanx","PROJECT.md")));
  assert.equal(JSON.parse(fs.readFileSync(file,"utf8"))[0].status,"completed","jobs are persisted");
}

// 2) tests fail -> repair with the failure output -> local coding agent on attempt 3 -> cloud model on attempt 3+
{
  const s=scenario({testFailures:3,cloud:true});
  const sup=new Supervisor(s.deps,{pollMs:5});
  const job=sup.create("fix the products API","shop");
  await until(()=>["completed","failed"].includes(sup.get(job.id)!.status));
  const j=sup.get(job.id)!;
  assert.equal(j.status,"completed",j.log.map(l=>l.msg).join("\n"));
  assert.match(s.calls.agents[1]!.goal,/1 failing: products API returns 500/,"failure output is handed back to the agent");
  assert.match(s.calls.agents[1]!.goal,/REGRESSION/,"a check that passed before and fails now is flagged as a regression");
  assert.ok(s.calls.tools.some(t=>t.tool==="agent.external"&&t.payload.agent==="aider"),"a coding agent was brought in");
  assert.ok(s.calls.agents.some(a=>JSON.stringify(a.routing)==='{"preferLocal":false}'),"escalated to a cloud model after local attempts");
  assert.equal(j.cloudUsed,true);assert.deepEqual(j.externalUsed,["aider"]);
}

// 3) waits for the owner's approval instead of skipping it, then resumes
{
  const s=scenario({testFailures:0,needApproval:true});
  const sup=new Supervisor(s.deps,{pollMs:5});
  const job=sup.create("deploy-ready build","shop");
  await until(()=>sup.get(job.id)!.status==="waiting_approval");
  await new Promise(r=>setTimeout(r,50));
  assert.equal(sup.get(job.id)!.status,"waiting_approval","still waiting while not approved");
  s.approve();
  await until(()=>["completed","failed"].includes(sup.get(job.id)!.status));
  assert.equal(sup.get(job.id)!.status,"completed");
}

// 4) final visual review finds a problem -> repair milestone -> verified
{
  const s=scenario({testFailures:0,visualIssue:true});
  const sup=new Supervisor(s.deps,{pollMs:5});
  const job=sup.create("redesign the products page","shop");
  await until(()=>["completed","failed"].includes(sup.get(job.id)!.status));
  const j=sup.get(job.id)!;
  assert.equal(j.status,"completed");
  assert.equal(j.milestones.at(-1)!.title,"Fix final verification");
  assert.ok(s.calls.agents.some(a=>/header overlaps the menu/.test(a.goal)),"visual issue was sent to the coder");
}

// 5) gives up cleanly after repeated failures, and cancel works
{
  const s=scenario({testFailures:99});
  const sup=new Supervisor(s.deps,{pollMs:5});
  const job=sup.create("impossible change","shop");
  await until(()=>["completed","failed"].includes(sup.get(job.id)!.status));
  assert.equal(sup.get(job.id)!.status,"failed");assert.match(sup.get(job.id)!.result!,/after 4 attempts/);
  const s2=scenario({testFailures:0,needApproval:true});const sup2=new Supervisor(s2.deps,{pollMs:5});
  const j2=sup2.create("something","shop");await until(()=>sup2.get(j2.id)!.status==="waiting_approval");
  sup2.cancel(j2.id);assert.equal(sup2.get(j2.id)!.status,"cancelled");
}
console.log("autonomy-supervisor: plan, gates, regression, repair, coding agent, cloud escalation, approvals, visual review verified");
process.exit(0);
