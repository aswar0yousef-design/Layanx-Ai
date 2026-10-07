import assert from "node:assert/strict";
import {createDesktopControlToolAdapter,windowsHelperCommandChars} from "../src/tools/desktop-control.js";
import {LayanXCore} from "../src/core/orchestrator.js";
import type {ModelProviderAdapter} from "../src/models/inference.js";

assert.ok(windowsHelperCommandChars()<16000,"PowerShell bootstrap stays far below the 32,767-char command-line limit: "+windowsHelperCommandChars());

// 1. Adapter: UI Automation operations travel as JSON, text base64-encoded, indexes bounded.
const real=Object.getOwnPropertyDescriptor(process,"platform")!;
Object.defineProperty(process,"platform",{value:"win32"});
try{
  const ops:any[]=[];
  const tree={window:"Notepad",truncated:false,elements:[{i:0,type:"Edit",name:"Text editor",rect:[0,0,800,600]},{i:1,type:"MenuItem",name:"File",rect:[0,0,40,20]}]};
  const adapter=createDesktopControlToolAdapter({windows:{async send(op){ops.push(op);
    if(op.op==="uitree")return JSON.stringify(op.scope==="windows"?{windows:[{title:"Untitled - Notepad",pid:42}]}:tree);
    if(op.op==="uiclick")return "mouse|20|10";
    if(op.op==="uiset")return "value";
    if(op.op==="focuswin")return "ok|1234|Untitled - Notepad";
    return "ok";}}});
  const req=(action:string,payload:Record<string,unknown>)=>({missionId:"m",agentId:"core",projectId:"p",tool:"t",action,permission:"L4_EXECUTE",idempotencyKey:"k",payload} as any);
  const read=await adapter.execute(req("desktop ui tree",{})) as any;
  assert.equal(read.elements.length,2);assert.match(read.hint,/element index/);
  assert.equal(ops.at(-1).max,120,"default element budget");
  await adapter.execute(req("desktop ui tree",{maxElements:5000}));
  assert.equal(ops.at(-1).max,400,"element budget is capped");
  assert.deepEqual((await adapter.execute(req("desktop ui tree",{scope:"windows"})) as any).windows[0].pid,42);
  assert.deepEqual(await adapter.execute(req("desktop click element",{index:1})),{index:1,method:"mouse"});
  await assert.rejects(adapter.execute(req("desktop click element",{index:-1})),/index/);
  await assert.rejects(adapter.execute(req("desktop click element",{index:"1; calc"})),/index/);
  const evil='سلام"; Stop-Computer';
  await adapter.execute(req("desktop set element text",{index:0,text:evil}));
  assert.equal(Buffer.from(ops.at(-1).text,"base64").toString("utf8"),evil,"text is base64, never PowerShell code");
  assert.ok(!JSON.stringify(ops.at(-1)).includes("Stop-Computer"));
  assert.deepEqual(await adapter.execute(req("desktop focus window",{title:"notepad"})),{focused:true,title:"Untitled - Notepad"});
  await assert.rejects(adapter.execute(req("desktop focus window",{title:""})),/title/);
}finally{Object.defineProperty(process,"platform",real);}
if(process.platform!=="win32"){
  const adapter=createDesktopControlToolAdapter({windows:{async send(){return "{}";}}});
  await assert.rejects(adapter.execute({action:"desktop ui tree",payload:{}} as any),/Windows only/);
}

// 2. Agent loop: an element click planned without a fresh tree first reads the window.
process.env.LAYANX_AUTO_APPROVE_TOOLS="desktop.ui.click";
const calls:string[]=[];
const prompts:string[]=[];
const provider:ModelProviderAdapter={name:"ollama",
  async health(){return{provider:"ollama",available:true,updatedAt:new Date().toISOString()};},
  async generate(model,request){
    const prompt=typeof request.input==="string"?request.input:"";prompts.push(prompt);
    if(prompts.length===1)return{provider:"ollama",modelId:model.id,output:JSON.stringify({risk:"medium",requiredPermission:"L4_EXECUTE",steps:[{description:"Click the File menu"}],successCriteria:["done"],stopCondition:"stop",tools:[{tool:"desktop.ui.click",action:"desktop click element",permission:"L4_EXECUTE",reason:"open menu",payload:{index:7}}]})};
    const clicked=calls.includes("click");
    return{provider:"ollama",modelId:model.id,output:clicked?"null":JSON.stringify({tool:"desktop.ui.click",action:"desktop click element",permission:"L4_EXECUTE",reason:"File is element 1",payload:{index:1}})};
  }};
const core=new LayanXCore();
core.models.register({id:"qwen3.5:4b",provider:"ollama",capabilities:["reasoning","vision"],local:true,enabled:true,priority:1});
core.providers.register(provider);
core.registerAgent({agentId:"core",purpose:"desktop",allowedTools:["desktop.ui.tree","desktop.ui.click"],forbiddenResources:[],requiredPermission:"L4_EXECUTE",maxToolCalls:10,maxRuntimeMs:60000,successCriteria:["done"],stopCondition:"stop"});
core.tools.register({name:"desktop.ui.tree",description:"read window elements",permission:"L2_ANALYZE",dangerous:false,actions:["desktop ui tree"]});
core.tools.register({name:"desktop.ui.click",description:"click element by index",permission:"L4_EXECUTE",dangerous:true,actions:["desktop click element"]});
core.toolAdapters.register("desktop.ui.tree",{async execute(){calls.push("tree");return{data:{window:"Notepad",elements:[{i:1,type:"MenuItem",name:"File"}]}};}});
core.toolAdapters.register("desktop.ui.click",{async execute(r){calls.push("click");assert.equal((r.payload as any).index,1,"index comes from the fresh tree");return{data:{index:1,method:"mouse"}};}});
const run=await core.runAgentGateway("Click the File menu in Notepad","p1",6) as any;
delete process.env.LAYANX_AUTO_APPROVE_TOOLS;
assert.deepEqual(calls,["tree","click"],"tree first, then the click chosen from it");
assert.equal(run.completed,true,JSON.stringify(run).slice(0,400));
console.log("desktop-uia: element tree, element actions and tree-before-click in the agent loop");
