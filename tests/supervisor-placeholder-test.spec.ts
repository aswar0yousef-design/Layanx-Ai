import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Supervisor,type SupervisorDeps} from "../src/autonomy/supervisor.js";

// Real-PC report: a website job stopped at milestone 1 with the "test" check red. A project created with
// `npm init` has a test script that only fails ("Error: no test specified" && exit 1); as a gate it failed
// every attempt. A job planned before the fix still lists "test": it is skipped, and the job finishes.
process.env.LAYANX_STORE_DIR=fs.mkdtempSync(path.join(os.tmpdir(),"lx-store-"));
const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-placeholder-"));
process.env.LAYANX_WORKSPACE_ROOT=root;
fs.mkdirSync(path.join(root,"shop"),{recursive:true});
fs.writeFileSync(path.join(root,"shop","package.json"),JSON.stringify({name:"shop",scripts:{test:"echo \"Error: no test specified\" && exit 1",build:"next build",dev:"next dev"}}));

const ran:string[]=[];
const deps:SupervisorDeps={
  async think(prompt){
    if(prompt.includes("planning lead"))return JSON.stringify({acceptance:["home page renders"],milestones:[{title:"Add site metadata",goal:"metadata",kind:"code"}],checks:{test:true,build:true,browser:false}});
    return JSON.stringify({ok:true,issues:[]});
  },
  async runAgent(){return{completed:true,missionId:"m1"};},
  async resumeAgent(){return{completed:true};},
  async runTool(_p,tool,payload){
    ran.push(tool+":"+String(payload.task??""));
    // What the real project.run does for the placeholder: it fails.
    if(tool==="project.run"&&payload.task==="test")return{ok:false,error:"Error: no test specified"};
    if(tool==="project.security")return{ok:true,data:{score:100,blocked:false,counts:{}}};
    return{ok:true,data:{ok:true,exitCode:0}};
  },
  isApproved:()=>true,cloudAvailable:()=>false,externalAgent:()=>null,
  // As planned before the fix: "test" counted as a script.
  detect:()=>({dir:path.join(root,"shop"),stack:"node" as const,packageManager:"npm" as const,scripts:["dev","build","test"],hasLockfile:false,git:false,tasks:[]})
};
const sup=new Supervisor(deps,{pollMs:5});
const until=async(f:()=>boolean,ms=10000)=>{const end=Date.now()+ms;while(!f()){if(Date.now()>end)throw new Error("timeout: "+JSON.stringify(sup.list().map(j=>[j.status,j.log.slice(-4).map(l=>l.msg)])));await new Promise(r=>setTimeout(r,10));}};
const job=sup.create("Add metadata to the computer shop site","shop");
await until(()=>["completed","failed"].includes(sup.get(job.id)!.status));
const j=sup.get(job.id)!;
assert.equal(j.status,"completed",JSON.stringify(j.log.slice(-6)));
assert.equal(j.milestones[0]!.attempts,1,"passed on the first attempt");
assert.ok(j.lastChecks?.some(c=>c.name==="test"&&c.skipped),"the placeholder test is skipped, not failed: "+JSON.stringify(j.lastChecks));
assert.ok(!ran.includes("project.run:test"),"the placeholder is never run as a test");
assert.ok(ran.includes("project.run:build"),"the build still gates the work");

// A real test script is still a gate.
fs.writeFileSync(path.join(root,"shop","package.json"),JSON.stringify({name:"shop",scripts:{test:"vitest run",build:"next build"}}));
ran.length=0;
const job2=sup.create("Add a contact page","shop");
await until(()=>["completed","failed"].includes(sup.get(job2.id)!.status),20000);
assert.equal(sup.get(job2.id)!.status,"failed","a failing real test still stops the job");
assert.ok(ran.includes("project.run:test"));
sup.stop();
fs.rmSync(root,{recursive:true,force:true});
console.log("supervisor-placeholder-test: the npm init placeholder is not a test; real tests still gate the work");
process.exit(0);
