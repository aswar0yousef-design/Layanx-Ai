import {MemoryEngine} from "../src/core/memory.js";
import {ContextFabric} from "../src/core/context-fabric.js";
import type {Mission} from "../src/core/types.js";

const memory=new MemoryEngine();
memory.remember({missionId:"m-a",projectId:"project-a",kind:"fact",summary:"Arabic project fact",content:"مرحبا هذا سياق المشروع العربي",confidence:1,tags:["arabic","project"]});
memory.remember({missionId:"m-b",projectId:"project-b",kind:"fact",summary:"Other project fact",content:"secret project context",confidence:1,tags:["project"]});

const mission={id:"m-a",projectId:"project-a",goal:"test context",status:"running",requiredPermission:"L1_READ",steps:[]} as unknown as Mission;
const fabric=new ContextFabric(memory);
const context=fabric.build({projectId:"project-a",mission,query:"العربي",limit:10,maxChars:2000});
if(context.memories.length!==1||context.memories[0].projectId!=="project-a")throw new Error("Project-scoped Arabic retrieval failed.");
if(!context.text.includes("مرحبا"))throw new Error("Arabic context was not preserved.");

const cross=memory.recall("secret",10,"project-a");
if(cross.length!==0)throw new Error("Cross-project memory leaked.");

const wrong={...mission,projectId:"project-b"};
try{fabric.build({projectId:"project-a",mission:wrong,query:"project"});throw new Error("Cross-project context request was accepted.");}
catch(error){if(!(error instanceof Error)||!error.message.includes("Project isolation"))throw error;}

memory.remember({missionId:"m-a",projectId:"project-a",kind:"fact",summary:"Sensitive",content:{apiKey:"should not leak"},confidence:1,tags:[]});
const sanitized=memory.recall("Sensitive",10,"project-a")[0];
if(!sanitized||sanitized.content===undefined||JSON.stringify(sanitized.content).includes("should not leak"))throw new Error("Memory sanitization regression.");

console.log("Memory context fabric tests passed.");
