import assert from "node:assert/strict";
const {openRequest,resolveOpenTarget}=await import("../src/tools/open-app.js");
const {normaliseRisk,normalisePermission}=await import("../src/core/ai-planner.js");

// ---------- «قم بفتح كروم يوتيوب»: a site by name, in a browser, is a direct open ----------
const yt=openRequest("قم بفتح كروم يوتيوب");
assert.deepEqual(yt&&{url:yt.url,label:yt.label},{url:"https://www.youtube.com/",label:"YouTube"});
assert.equal((resolveOpenTarget(yt!) as {browser?:string}).browser,"chrome");
for(const t of ["افتح يوتيوب","افتح يوتيوب في كروم","open youtube in chrome","افتح اليوتيوب"])assert.equal(openRequest(t)?.url,"https://www.youtube.com/",t);
assert.equal(openRequest("قم بتشغيل الفيسبوك على ايدج")?.url,"https://www.facebook.com/");
assert.equal(openRequest("افتح كروم")?.label,"Google Chrome","a bare browser stays the browser");
assert.equal(openRequest("افتح ملف التقرير"),null,"anything uncertain still goes to the planner");
assert.equal(openRequest("قم بفتح الحاسبة")?.label,"Calculator");

// ---------- the model's words for risk and permission ----------
assert.deepEqual(["Medium","moderate"," LOW ","weird",undefined,"critical"].map(normaliseRisk),["medium","medium","low","high","high","critical"],"unknown risk counts as high");
assert.deepEqual(["l3_modify","L3","L3 MODIFY","L4_EXECUTE"].map(normalisePermission),["L3_MODIFY","L3_MODIFY","L3_MODIFY","L4_EXECUTE"]);
assert.equal(normalisePermission("L9"),"L9","a level that does not exist is not invented");
assert.equal(normalisePermission("admin"),"admin");

console.log("open sites by name and plan words: direct opens for sites, risk normalised, permissions only re-spelled");

// ---------- a malformed next reply after real, checked work ----------
{
  const {plannerFormatStop}=await import("../src/autonomy/supervisor.js");
  for(const r of ["Mission has no execution step.","Model planner returned invalid JSON.","Invalid mission risk.","Adaptive planner returned an invalid tool after one constrained repair attempt: Adaptive planner returned invalid JSON."])assert.equal(plannerFormatStop(r),true,r);
  for(const r of [undefined,"Moving, sending, paying or withdrawing money is the owner's decision","Planner tool permission exceeds mission scope.","Repeated read-only tool blocked: files.read"])assert.equal(plannerFormatStop(r),false,String(r));
}

// ---------- project.run: an invented result field becomes the tool's real receipt ----------
{
  const {ModelRegistry}=await import("../src/models/registry.js");
  const {ModelExecutionRouter,ModelProviderRegistry}=await import("../src/core/model-execution.js");
  const {AiMissionPlanner}=await import("../src/core/ai-planner.js");
  const reply=(task:string)=>JSON.stringify({risk:"Moderate",requiredPermission:"l4_execute",steps:[{description:"run it"}],
    successCriteria:["result.status === 'success'","result.ok === true"],stopCondition:"stop",
    tools:[{tool:"project.run",action:"run project task",permission:"L4_EXECUTE",reason:"kit",payload:{task}}]});
  const catalog=[{name:"project.run",description:"run",permission:"L4_EXECUTE",dangerous:true,actions:["run project task"],tags:[]}] as never;
  for(const [task,want] of [["template:dashboard",'result.template === "dashboard"'],["build","result.ok === true"]] as const){
    const models=new ModelRegistry();models.register({id:"m",provider:"p",capabilities:["reasoning"],local:true,enabled:true,priority:1});
    const providers=new ModelProviderRegistry();
    providers.register({name:"p",async health(){return{provider:"p",available:true,updatedAt:new Date().toISOString()};},async generate(model:any){return{modelId:model.id,provider:model.provider,output:reply(task)};}} as never);
    const plan=await new AiMissionPlanner(new ModelExecutionRouter(models,providers)).plan("build the dashboard",catalog);
    assert.equal(plan.risk,"medium");assert.equal(plan.requiredPermission,"L4_EXECUTE");
    assert.ok(plan.successCriteria.includes(want),task+": "+plan.successCriteria.join(" | "));
    assert.ok(!plan.successCriteria.some(c=>c.includes("result.status")),"the invented field is gone");
  }
}
console.log("project.run receipts replace invented criteria");
