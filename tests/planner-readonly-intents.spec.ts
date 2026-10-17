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
 {name:"desktop.screenshot",description:"capture screenshot",permission:"L2_ANALYZE",dangerous:false,actions:["desktop screenshot"],tags:["desktop","screen"]},{name:"research.internet",description:"read-only internet research",permission:"L2_ANALYZE",dangerous:false,actions:["research internet","deep research internet","search across internet","بحث شامل في الإنترنت","بحث شامل"],tags:["research","internet"]},
 {name:"mcp.servers.list",description:"list configured MCP servers",permission:"L1_READ",dangerous:false,actions:["list mcp servers","قائمة خوادم MCP"],tags:["mcp","servers"]},
 {name:"memory.recall",description:"search stored memory",permission:"L1_READ",dangerous:false,actions:["recall memory","search memory","read memory","استرجاع الذاكرة","بحث في الذاكرة","قراءة الذاكرة"],tags:["memory","recall"]},
 {name:"desktop.window.focus",description:"focus existing window",permission:"L4_EXECUTE",dangerous:true,actions:["desktop focus window"],tags:["desktop","window"]},
 {name:"desktop.keyboard.type",description:"type text into focused app",permission:"L4_EXECUTE",dangerous:true,actions:["desktop type"],tags:["desktop","keyboard"]}
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
const research=await planner.plan("ابحث في الإنترنت عن أفضل مطاعم المأكولات العمانية في مسقط",catalog);
assert.equal(research.tools[0]?.tool,"research.internet");
assert.equal(research.tools[0]?.payload?.query,"ابحث في الإنترنت عن أفضل مطاعم المأكولات العمانية في مسقط");
const mcp=await planner.plan("Which MCP tool servers are installed?",catalog);
assert.equal(mcp.tools[0]?.tool,"mcp.servers.list");
const memory=await planner.plan("What did we decide last week about the shop's payment provider? Check your memory",catalog);
assert.equal(memory.tools[0]?.tool,"memory.recall");
assert.match(String(memory.tools[0]?.payload?.query),/payment provider/);
const notepad=await planner.plan("Switch to the Notepad window and write hello in it",catalog);
assert.equal(notepad.requiredPermission,"L4_EXECUTE");
assert.equal(notepad.risk,"high");
assert.deepEqual(notepad.tools.map(t=>t.tool),["desktop.window.focus","desktop.keyboard.type"]);
assert.deepEqual(notepad.tools[0]?.payload,{title:"Notepad"});
assert.deepEqual(notepad.tools[1]?.payload,{text:"hello"});
const stop=await planner.nextTool({goal:"Read the LayanX runtime status",result:{status:"running",providers:["ollama"]},tools:catalog,requiredPermission:"L2_ANALYZE" as any,completedTools:["runtime.status"]});
assert.equal(stop,null,"do not repeat a completed one-step read-only task");
assert.equal(modelCalls,0,"deterministic common intents should avoid fragile small-model JSON for clear requests");

let scopePrompt="";
const scopePlanner=new AiMissionPlanner({async execute(request:any){scopePrompt=String(request.input);return{output:"null"};}} as any);
const next=await scopePlanner.nextTool({goal:"Check the available status",result:{},tools:catalog,requiredPermission:"L1_READ" as any,completedTools:[]});
assert.equal(next,null);
assert.ok(!scopePrompt.includes("desktop.keyboard.type"),"adaptive planner must not see tools above the mission permission");
assert.ok(!scopePrompt.includes("desktop.window.focus"),"adaptive planner must not see dangerous tools above the mission permission");

console.log("planner-intents: Arabic runtime, Gmail, calendar, security, screen, research, MCP, memory, Notepad approval scope and stop-when-done passed");
