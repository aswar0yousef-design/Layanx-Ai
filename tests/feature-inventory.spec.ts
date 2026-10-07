import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Guards the three wiring mistakes found during the feature audit.
process.env.LAYANX_CAPABILITIES="all";
process.env.LAYANX_WORKSPACE_ROOT=fs.mkdtempSync(path.join(os.tmpdir(),"lx-inv-ws-"));
const {createRuntime}=await import("../src/runtime.js");
const core=createRuntime({storagePath:fs.mkdtempSync(path.join(os.tmpdir(),"lx-inv-"))}).core as any;
const tools=core.tools.list() as Array<{name:string;action?:string;actions?:string[];permission:string;dangerous?:boolean}>;
assert.ok(tools.length>=100,"the full tool set is registered");

// 1) every tool has an implementation
for(const t of tools)assert.ok(core.toolAdapters.get(t.name),"adapter for "+t.name);

// 2) the agent may choose every registered tool (dangerous ones still need approval)
const allowed=new Set<string>(core.agents.get("core").allowedTools);
assert.deepEqual(tools.map(t=>t.name).filter(n=>!allowed.has(n)),[],"tools the agent cannot reach");
for(const n of ["trading.order.place","trading.mt5.autoscalper.start","agent-reach.setup"])
  assert.equal(tools.find(t=>t.name===n)?.dangerous,true,n+" must require approval");

// 3) the planner's catalog offers at least one action for every tool (otherwise it can never be chosen)
const catalog=core.toolCatalog.list(core.agents.get("core"),"L4_EXECUTE") as Array<{name:string;actions:string[]}>;
assert.deepEqual(catalog.filter(e=>!e.actions.length).map(e=>e.name),[],"tools without any selectable action");

// 4) every declared action of every read-only tool reaches its implementation
const unsupported:string[]=[];
for(const t of tools.filter(x=>!x.dangerous&&(x.permission==="L1_READ"||x.permission==="L2_ANALYZE"))){
  for(const action of [t.action,...(t.actions??[])].filter(Boolean) as string[]){
    try{await Promise.race([core.toolAdapters.get(t.name).execute({missionId:"m",agentId:"core",projectId:"default",tool:t.name,action,permission:t.permission,idempotencyKey:"k",payload:{}}),new Promise((_,r)=>setTimeout(()=>r(new Error("timeout")),6000))]);}
    catch(e){if(/unsupported .*action|unknown action/i.test(String((e as Error).message)))unsupported.push(t.name+" <- "+action);}
  }
}
assert.deepEqual(unsupported,[],"declared actions the implementation rejects");
console.log("feature-inventory: "+tools.length+" tools wired, allowed and reachable");
process.exit(0);
