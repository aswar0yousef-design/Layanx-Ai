import assert from "node:assert/strict";
import {AiMissionPlanner} from "../src/core/ai-planner.js";
import type {ToolCatalogEntry} from "../src/core/tool-catalog.js";

const catalog:ToolCatalogEntry[]=[
  {name:"files.write",description:"Write project file",permission:"L3_MODIFY",dangerous:true,
    actions:["write file"],tags:["file"]},
  {name:"runtime.status",description:"Read runtime status",permission:"L1_READ",dangerous:false,
    actions:["read runtime status"],tags:["status"]}
];
const tool={tool:"files.write",action:"write file",permission:"L3_MODIFY",reason:"Create file",
  payload:{path:"package.json",content:"{}"}};
const base={risk:"low",requiredPermission:"L1_READ",steps:[{description:"Write package.json"}],
  successCriteria:["result.system === 'LayanX AI'","result.ready === true"],
  stopCondition:"Stop on error",tools:[tool]};
let calls=0;
const prompts:string[]=[];
const planner=new AiMissionPlanner({async execute(input:{input:string}){
  calls++;
  prompts.push(input.input);
  return{output:JSON.stringify(calls===1?base:{...base,successCriteria:["The planned file write succeeds"]})};
}} as never);
const plan=await planner.plan("Create a package.json",catalog);
assert.equal(calls,2,"An unrelated runtime.status criterion is repaired once, not retried during execution");
assert.deepEqual(plan.successCriteria,["The planned file write succeeds"]);
assert.equal(plan.requiredPermission,"L3_MODIFY");
assert.ok(prompts[1]?.includes("final tool is files.write"),"Repair includes the specific validation failure");

const repeated=new AiMissionPlanner({async execute(){return{output:JSON.stringify(base)}}} as never);
await assert.rejects(()=>repeated.plan("Create package.json",catalog),
  /Planner success criteria reference runtime.status fields/,"Never execute contradictory unrepaired criteria");

// Valid runtime.status checks remain strictly checked against actual runtime output.
const valid=new AiMissionPlanner({async execute(){return{output:JSON.stringify({
  ...base,requiredPermission:"L1_READ",tools:[{tool:"runtime.status",action:"read runtime status",permission:"L1_READ",reason:"Read runtime"}]
})}}} as never);
const runtime=await valid.plan("Read runtime status",catalog);
assert.deepEqual(runtime.successCriteria,base.successCriteria);
assert.equal(runtime.requiredPermission,"L1_READ");
console.log("Planner cross-tool criteria: invalid status checks repaired before execution");
