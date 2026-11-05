import assert from "node:assert/strict";
import {AiMissionPlanner} from "../src/core/ai-planner.js";
import type {ToolCatalogEntry} from "../src/core/tool-catalog.js";

const permitted:ToolCatalogEntry[]=[
  {name:"files.write",description:"write a project-relative file",permission:"L3_MODIFY",dangerous:true,
    actions:["write file"],tags:["files"]},
  {name:"project.run",description:"run existing project checks",permission:"L4_EXECUTE",dangerous:true,
    actions:["run project task"],tags:["project"]}
];
const plan={risk:"low",requiredPermission:"L1_READ",steps:[{description:"Create a project file"}],
  successCriteria:["file created"],stopCondition:"Stop on failure",
  tools:[{tool:"files.write",action:"write file",permission:"L3_MODIFY",reason:"create package.json",
    payload:{path:"package.json",content:"{}"}},{tool:"project.run",action:"run project task",
    permission:"L4_EXECUTE",reason:"test the project",payload:{task:"test"}}]};
const model={async execute(){return{output:JSON.stringify(plan)}}} as never;
const planner=new AiMissionPlanner(model);
const result=await planner.plan("Create package.json for a task app",permitted);
assert.equal(result.requiredPermission,"L4_EXECUTE",
  "The model's incorrect low mission scope cannot make its allowed coding tools unusable");
assert.deepEqual(result.tools.map(t=>t.permission),["L3_MODIFY","L4_EXECUTE"],
  "Tool permissions come from the authoritative catalog, not a widened model permission");

const unauthorized={...plan,tools:[{tool:"files.write",action:"write file",permission:"L5_CRITICAL",
  reason:"forged critical privilege"}]};
const attack=new AiMissionPlanner({async execute(){return{output:JSON.stringify(unauthorized)}}} as never);
await assert.rejects(()=>attack.plan("Create package.json",permitted),/must match the tool requirement/,
  "A forged tool permission must still be rejected rather than normalized");

const outside={...plan,tools:[{tool:"not-in-catalog",action:"write file",permission:"L4_EXECUTE",
  reason:"unknown"}]};
const forbidden=new AiMissionPlanner({async execute(){return{output:JSON.stringify(outside)}}} as never);
await assert.rejects(()=>forbidden.plan("Create package.json",permitted),/outside the allowed catalog/,
  "The scope repair must never authorize unknown tools");
console.log("planner mission scope: allowed catalog tools work; forged permission and tool remain rejected");
