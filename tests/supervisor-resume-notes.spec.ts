import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Supervisor,wantsOpenWhenDone,type SupervisorDeps} from "../src/autonomy/supervisor.js";
import {isLocalPreview,openInBrowser} from "../src/platform/open-url.js";

// Real-PC report: a website job stopped, there was no way to continue it, a follow-up "when finish open"
// started a second job, and nothing showed whether the job had finished the whole goal.
process.env.LAYANX_STORE_DIR=fs.mkdtempSync(path.join(os.tmpdir(),"lx-store-"));
const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-resume-"));
process.env.LAYANX_WORKSPACE_ROOT=root;
fs.mkdirSync(path.join(root,"shop"),{recursive:true});

// 1. Open-when-done wording, English (with the typo from the report) and Arabic; local addresses only.
for(const t of ["when finsh open","open it when you are done","افتحه عند الانتهاء","لما تخلص افتحلي الموقع"])assert.equal(wantsOpenWhenDone(t),true,t);
for(const t of ["build an open source library","اريد منك عمل موقع احترافي لمحل بيع كمبيوترات"])assert.equal(wantsOpenWhenDone(t),false,t);
assert.equal(isLocalPreview("http://localhost:3000/"),true);
for(const u of ["http://localhost:3000/a&calc","https://example.com","http://localhost:3000/?q=1","file:///C:/x"])assert.equal(isLocalPreview(u),false,u);
assert.throws(()=>openInBrowser("https://example.com","win32"),/Only local addresses/);

// 2. A job in an empty folder: the agent creates the project in milestone 1, so checks appear later;
//    milestone 2 keeps failing until the owner resumes it; a note asks to open the site when done.
let project:"empty"|"node"="empty";
let failSecond=true;
const agentGoals:string[]=[];const tools:string[]=[];const opened:string[]=[];
const deps:SupervisorDeps={
  async think(prompt){
    if(prompt.includes("planning lead"))return JSON.stringify({acceptance:["shop home page renders"],milestones:[{title:"Create the Next.js app",goal:"create it",kind:"code"},{title:"Add the products page",goal:"products",kind:"code"}],checks:{test:true,build:true,browser:{path:"/"}}});
    return JSON.stringify({ok:true,issues:[]});
  },
  async runAgent(goal){
    agentGoals.push(goal);
    if(goal.includes("Current milestone (1/2)")){project="node";return{completed:true,missionId:"m1"};}
    if(failSecond)return{completed:false,reason:"model gave up",missionId:"m2"};
    return{completed:true,missionId:"m2"};
  },
  async resumeAgent(){return{completed:true};},
  async runTool(_p,tool,payload){
    tools.push(tool+":"+String(payload.task??""));
    if(tool==="project.run"&&payload.task==="dev:start")return{ok:true,data:{url:"http://localhost:3000"}};
    if(tool==="browser.test")return{ok:true,data:{problems:[],results:[]}};
    if(tool==="project.security")return{ok:true,data:{score:100,blocked:false,counts:{}}};
    return{ok:true,data:{ok:true,exitCode:0}};
  },
  isApproved:()=>true,cloudAvailable:()=>false,externalAgent:()=>null,
  detect:()=>project==="empty"
    ?{dir:path.join(root,"shop"),stack:"unknown" as const,scripts:[],hasLockfile:false,git:false,tasks:[]}
    :{dir:path.join(root,"shop"),stack:"node" as const,packageManager:"npm" as const,scripts:["dev","build","test"],hasLockfile:false,git:false,tasks:[]},
  openUrl:url=>{opened.push(url);}
};
const sup=new Supervisor(deps,{pollMs:5});
const until=async(f:()=>boolean,ms=10000)=>{const end=Date.now()+ms;while(!f()){if(Date.now()>end)throw new Error("timeout: "+JSON.stringify(sup.list().map(j=>[j.status,j.log.slice(-4).map(l=>l.msg)])));await new Promise(r=>setTimeout(r,10));}};

const job=sup.create("Build a professional online store for a computer shop","shop");
assert.equal(job.openWhenDone,false);
await until(()=>sup.get(job.id)!.status==="failed");
const failed=sup.get(job.id)!;
assert.equal(failed.milestones[0]!.status,"done","milestone 1 finished before the stop");
assert.equal(failed.milestones[1]!.status,"failed");
assert.ok(failed.checks?.test&&failed.checks.build&&failed.checks.browser,"checks were added once the project existed: "+JSON.stringify(failed.checks));
assert.ok(failed.log.some(l=>/now has checks to prove the work/.test(l.msg)));
assert.ok(tools.includes("project.run:install"),"the new project's packages were installed before its checks");
assert.throws(()=>sup.resume("nope"),/job_not_found/);

// The owner's follow-up goes to this job, not into a new one.
sup.addNote(job.id,"when finsh open");
assert.equal(sup.get(job.id)!.openWhenDone,true,"the note asks to open the site when done");
assert.equal(sup.list().length,1,"no second job");

// Resume: milestone 1 is not redone; milestone 2 gets fresh attempts and the owner's note.
failSecond=false;
const firstMilestoneRuns=agentGoals.filter(g=>g.includes("(1/2)")).length;
sup.resume(job.id);
assert.throws(()=>sup.resume(job.id),/job_not_stopped/,"a running job is not resumed twice");
await until(()=>sup.get(job.id)!.status==="completed");
const done=sup.get(job.id)!;
assert.equal(agentGoals.filter(g=>g.includes("(1/2)")).length,firstMilestoneRuns,"finished milestones stay finished");
assert.ok(agentGoals.at(-1)!.includes("Owner's instructions added during the job")&&agentGoals.at(-1)!.includes("when finsh open"),"the note reaches the agent");
assert.ok(done.log.some(l=>/Resumed by the owner \(1\/2 milestones already done\)/.test(l.msg)));
assert.match(done.result!,/2 milestone\(s\), checks .*test.*passing/,"the result says what proved it: "+done.result);
assert.equal(done.preview,"http://localhost:3000/","the dev server stays up for the owner");
assert.ok(!tools.slice(-3).includes("project.run:dev:stop"),"not stopped after the browser check");
assert.deepEqual(opened,["http://localhost:3000/"],"opened in the browser once, when done");
assert.equal(done.resumed,1);
sup.stop();

// 3. Without open-when-done the dev server is stopped as before.
project="node";const tools2:string[]=[];const opened2:string[]=[];
const sup2=new Supervisor({...deps,runTool:async(p,t,pl)=>{tools2.push(t+":"+String(pl.task??""));return deps.runTool(p,t,pl);},openUrl:u=>{opened2.push(u);}},{pollMs:5});
const j2=sup2.create("Add a contact page to the site","shop");
const until2=async(f:()=>boolean)=>{const end=Date.now()+10000;while(!f()){if(Date.now()>end)throw new Error("timeout2");await new Promise(r=>setTimeout(r,10));}};
await until2(()=>sup2.get(j2.id)!.status==="completed");
assert.ok(tools2.includes("project.run:dev:stop"));assert.deepEqual(opened2,[]);assert.equal(sup2.get(j2.id)!.preview,undefined);
sup2.stop();
// 4. One attempt where the agent stops, then one that finishes: the milestone passes on attempt 2
//    (before the fix the first failure stuck to the milestone and every later attempt failed too).
let calls=0;
const sup3=new Supervisor({...deps,openUrl:undefined,async runAgent(){calls++;return calls===1?{completed:false,reason:"model gave up"}:{completed:true};},
  async think(prompt){return prompt.includes("planning lead")?JSON.stringify({acceptance:["x"],milestones:[{title:"Only step",goal:"do it",kind:"code"}],checks:{test:true}}):"{}";}},{pollMs:5});
const j3=sup3.create("Fix the footer links","shop");
const end3=Date.now()+10000;while(!["completed","failed"].includes(sup3.get(j3.id)!.status)){if(Date.now()>end3)throw new Error("timeout3");await new Promise(r=>setTimeout(r,10));}
assert.equal(sup3.get(j3.id)!.status,"completed",JSON.stringify(sup3.get(j3.id)!.log.slice(-5)));
assert.equal(sup3.get(j3.id)!.milestones[0]!.attempts,2);
sup3.stop();
fs.rmSync(root,{recursive:true,force:true});
console.log("supervisor-resume-notes: resume continues a stopped job, owner notes reach it, checks appear for new projects, the site opens when done");
process.exit(0);
