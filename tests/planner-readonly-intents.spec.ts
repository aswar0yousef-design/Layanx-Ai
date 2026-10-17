import assert from "node:assert/strict";
import {AiMissionPlanner} from "../src/core/ai-planner.js";

let modelCalls=0;
const planner=new AiMissionPlanner({async execute(){modelCalls++;throw new Error("A high-confidence read-only request should not need model planning.");}} as any);
const catalog=[
 {name:"runtime.status",description:"read runtime status",permission:"L1_READ",dangerous:false,actions:["read runtime status","inspect runtime","runtime status","قراءة حالة النظام","فحص التشغيل"],tags:["runtime","status"]},
 {name:"google.gmail.search",description:"search Gmail messages",permission:"L1_READ",dangerous:false,actions:["search emails"],tags:["google","workspace"]},
 {name:"google.calendar.upcoming",description:"read upcoming Google Calendar events",permission:"L1_READ",dangerous:false,actions:["calendar upcoming","read upcoming Google Calendar events"],tags:["google","workspace"]},
 {name:"project.security",description:"security check of the project",permission:"L2_ANALYZE",dangerous:false,actions:["security scan","scan project security","فحص أمني","فحص أمان المشروع"],tags:["security","scan"]},
 {name:"desktop.ui.tree",description:"list open windows",permission:"L2_ANALYZE",dangerous:false,actions:["desktop ui tree"],tags:["desktop","screen"]},
 {name:"desktop.screenshot",description:"capture screenshot",permission:"L2_ANALYZE",dangerous:false,actions:["desktop screenshot"],tags:["desktop","screen"]}
] as any;
const runtime=await planner.plan("اقرأ حالة النظام وأخبرني هل كل شيء يعمل",catalog);
assert.equal(runtime.tools[0]?.tool,"runtime.status");
const gmail=await planner.plan("ابحث في بريدي في Gmail عن فواتير الشهر الماضي",catalog);
assert.equal(gmail.tools[0]?.tool,"google.gmail.search");
const now=new Date(),firstThis=new Date(now.getFullYear(),now.getMonth(),1),firstPrevious=new Date(now.getFullYear(),now.getMonth()-1,1),fmt=(d:Date)=>String(d.getFullYear())+"/"+String(d.getMonth()+1).padStart(2,"0")+"/"+String(d.getDate()).padStart(2,"0");
assert.ok(String(gmail.tools[0]?.payload?.query).includes("after:"+fmt(firstPrevious)+" before:"+fmt(firstThis)),"Gmail query should cover exactly the previous calendar month");
assert.match(String(gmail.tools[0]?.payload?.query),/invoice.*فاتورة|invoice OR invoices OR فاتورة/);
const calendar=await planner.plan("ما هي مواعيدي القادمة في التقويم؟",catalog);
assert.equal(calendar.tools[0]?.tool,"google.calendar.upcoming");
const security=await planner.plan("افحص أمان المشروع واعرض المشاكل",catalog);
assert.equal(security.tools[0]?.tool,"project.security");
const screen=await planner.plan("انظر إلى الشاشة وقل لي ما النوافذ المفتوحة",catalog);
assert.equal(screen.tools[0]?.tool,"desktop.ui.tree");
assert.deepEqual(screen.tools[0]?.payload,{scope:"windows"});
assert.equal(modelCalls,0,"deterministic read-only routing should avoid fragile small-model JSON for clear intents");
console.log("planner-readonly-intents: Arabic runtime, Gmail, calendar, security and screen routes passed");
