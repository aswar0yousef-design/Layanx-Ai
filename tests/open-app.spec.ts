import assert from "node:assert/strict";
import {openRequest,resolveOpenTarget} from "../src/tools/open-app.js";
import {createDesktopControlToolAdapter} from "../src/tools/desktop-control.js";
import {LayanXCore} from "../src/core/orchestrator.js";
import {VoiceAssistant} from "../src/voice/assistant.js";
import {trustAllows} from "../src/autonomy/trust.js";

/**
 * The owner said «افتح Google Chrome» and got "Planner selected a tool outside the allowed catalog":
 * there was no tool to open a program, so the local model invented one. Now:
 *  - desktop.app.open opens a known program, a Start-menu app by name, or a web page, and never runs a command line;
 *  - a plain "open X" is planned in one step without the model, and the mission ends after it (no model call);
 *  - the voice assistant does not ask the model what "open X" means;
 *  - in a trusted project it runs without an approval (closing the program undoes it).
 */
// ---------- what "open X" means
const cases:Array<[string,unknown]>=[
  ["افتح Google Chrome",{app:"Google Chrome",label:"Google Chrome"}],
  ["ليان، افتح متصفح جوجل كروم",{app:"جوجل كروم",label:"Google Chrome"}],
  ["افتح واتساب",{app:"WhatsApp",label:"WhatsApp"}],
  ["شغّل الحاسبة",{app:"الحاسبة",label:"Calculator"}],
  ["افتح برنامج وورد",{app:"Word",label:"Word"}],
  ["open youtube.com",{url:"https://youtube.com/",label:"https://youtube.com/"}],
  ["افتح youtube.com في كروم",{app:"كروم",url:"https://youtube.com/",label:"https://youtube.com/"}],
  ["Open the Chrome browser",{app:"Chrome",label:"Google Chrome"}],
  ["افتح المتصفح",{url:"https://www.google.com/",label:"https://www.google.com/"}],
  // Not certainly something to open: the planner decides.
  ["افتح ملف التقرير",null],["افتح الموقع",null],["open a pull request for the fix",null],["افتح كروم واكتب رسالة لأحمد وأرسلها",null]
];
for(const [text,want] of cases)assert.deepEqual(openRequest(text),want,text);
assert.throws(()=>resolveOpenTarget({app:"cmd /c del C:\\"}),/may contain letters/);
assert.throws(()=>resolveOpenTarget({url:"javascript:alert(1)"}),/http\(s\)/);
assert.throws(()=>resolveOpenTarget({url:"https://x.com","app":"notepad"}),/browser/);
assert.throws(()=>resolveOpenTarget({}),/Say which program/);

// ---------- the Windows tool: what reaches the helper (base64, a kind, never a command line)
{
  const real=Object.getOwnPropertyDescriptor(process,"platform")!;
  Object.defineProperty(process,"platform",{value:"win32"});
  try{
    const ops:any[]=[];
    const adapter=createDesktopControlToolAdapter({windows:{async send(op){ops.push(op);return op.kind==="start"?"ok|WhatsApp":"ok|"+Buffer.from(op.value,"base64").toString();}}});
    const run=(payload:Record<string,unknown>)=>adapter.execute({missionId:"m",agentId:"core",projectId:"p",tool:"desktop.app.open",action:"desktop open app",permission:"L4_EXECUTE",idempotencyKey:"k",payload} as any) as Promise<any>;
    const decode=(o:any)=>({op:o.op,kind:o.kind,value:Buffer.from(o.value,"base64").toString(),...(o.browser?{browser:o.browser}:{})});
    assert.deepEqual((await run({app:"كروم"})).via,"program");assert.deepEqual(decode(ops.at(-1)),{op:"openapp",kind:"known",value:"chrome"});
    assert.equal((await run({app:"واتساب"})).what,"WhatsApp");assert.deepEqual(decode(ops.at(-1)),{op:"openapp",kind:"start",value:"WhatsApp"});
    await run({app:"edge",url:"https://example.com/a?b=1"});assert.deepEqual(decode(ops.at(-1)),{op:"openapp",kind:"url",value:"https://example.com/a?b=1",browser:"msedge"});
    const evil='Notepad"; Remove-Item -Recurse C:\\ ; $(calc)';
    await assert.rejects(run({app:evil}),/may contain letters/);
    assert.ok(!JSON.stringify(ops).includes("Remove-Item"),"nothing like a command reaches the helper");
  }finally{Object.defineProperty(process,"platform",real);}
}

// ---------- "open Chrome" through the agent: one step, no model call, done
{
  const core=new LayanXCore();
  let modelCalls=0;
  core.models.register({id:"m",provider:"fake",capabilities:["reasoning"],local:true,enabled:true,priority:1});
  core.providers.register({name:"fake",async health(){return{provider:"fake",available:true,updatedAt:new Date().toISOString()};},async generate(model){modelCalls++;return{modelId:model.id,provider:"fake",output:'{"tool":"desktop.open_chrome"}'};}});
  core.registerAgent({agentId:"core",purpose:"open",allowedTools:["desktop.app.open","files.read"],forbiddenResources:[],requiredPermission:"L4_EXECUTE",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"});
  core.tools.register({name:"files.read",description:"read",permission:"L1_READ",dangerous:false,actions:["read file"],tags:["files"]});
  core.tools.register({name:"desktop.app.open",description:"open a program",permission:"L4_EXECUTE",dangerous:true,actions:["desktop open app"],tags:["desktop","open"]});
  const opened:unknown[]=[];
  core.toolAdapters.register("desktop.app.open",{async execute(r){opened.push(r.payload);return{opened:true,what:"Google Chrome"};}});
  const first=await core.runAgentGateway("افتح Google Chrome","default",10) as any;
  assert.ok(first.paused&&first.approvalId,"supervised: it asks first");
  core.executionRuntime.approvals.approve(first.approvalId);
  const done=await core.executeAgentLoop(first.missionId,"default",10,{0:first.approvalId},"core") as any;
  assert.equal(done.completed,true,JSON.stringify(done));assert.equal(core.missions.get(first.missionId)?.status,"completed");
  assert.deepEqual(opened,[{app:"Google Chrome"}]);
  assert.equal(modelCalls,0,"no model call to plan or to decide it is finished");
}

// ---------- the voice assistant: no model to understand "open X"
{
  const goals:string[]=[];let decided=0;
  const jarvis=new VoiceAssistant({decide:async()=>{decided++;return"{}";},runTask:async goal=>{goals.push(goal);return{completed:true,missionId:"m1"};},snapshot:()=>({missions:[],approvals:[],schedules:0})});
  const r=await jarvis.turn({text:"ليان افتح Google Chrome"});
  assert.equal(r.intent,"task");assert.equal(r.reply,"تم، فتحت Google Chrome.");
  assert.deepEqual(goals,["ليان افتح Google Chrome"]);assert.equal(decided,0);
  const off=await jarvis.turn({text:"افتح واتساب",allowTasks:false});
  assert.equal(off.intent,"task");assert.equal(goals.length,1,"tasks switched off: nothing runs");
}

// ---------- trust
assert.equal(trustAllows("desktop.app.open","p",{LAYANX_DEFAULT_TRUST:"trusted"}),true,"trusted: opens without asking");
assert.equal(trustAllows("desktop.app.open","p",{LAYANX_DEFAULT_TRUST:"supervised"}),false);
assert.equal(trustAllows("desktop.mouse.click","p",{LAYANX_DEFAULT_TRUST:"trusted"}),false,"clicking still needs full trust");

console.log("open-app: programs and web pages open by name, in one step, with no command line and no model call");
process.exit(0);
