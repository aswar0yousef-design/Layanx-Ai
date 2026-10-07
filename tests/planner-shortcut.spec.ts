import assert from "node:assert/strict";
import {AiMissionPlanner} from "../src/core/ai-planner.js";

// "build a website" must be planned by the model, not reduced to running `npm run build`.
let modelCalls=0;
const plan={risk:"medium",requiredPermission:"L4_EXECUTE",steps:[{description:"Write the page"}],successCriteria:["done"],stopCondition:"stop",tools:[]};
const planner=new AiMissionPlanner({async execute(){modelCalls++;return{modelId:"m",provider:"p",output:JSON.stringify(plan),attempts:[]};}} as any);
const catalog=[{name:"project.verify",description:"verify",permission:"L4_EXECUTE",dangerous:true,actions:["verify project"],tags:[]},{name:"files.write",description:"write",permission:"L3_MODIFY",dangerous:false,actions:["write file"],tags:[]}] as any;
const shortcut=async(goal:string)=>{const before=modelCalls;const p=await planner.plan(goal,catalog);return{model:modelCalls>before,tool:p.tools?.[0]?.tool};};
for(const g of ["build a website for my shop","ابنِ موقعاً لمتجري","fix the login bug and run the tests","أضف صفحة جديدة ثم شغّل الاختبارات","Overall goal: create the page\nuse project.run to verify"])
  assert.equal((await shortcut(g)).model,true,`model must plan: ${g}`);
for(const g of ["run the tests","شغّل الاختبارات","check the build","run typecheck"])
  assert.deepEqual(await shortcut(g),{model:false,tool:"project.verify"},`pure verification shortcut: ${g}`);
console.log("planner-shortcut: only pure verification requests skip the model");
