import {MemoryEngine} from "../src/core/memory.js";

const memory=new MemoryEngine();
memory.remember({missionId:"mission-a",projectId:"project-a",kind:"fact",summary:"Private alpha deployment marker",content:{marker:"alpha-only"},confidence:1,tags:["deployment"]});
memory.remember({missionId:"mission-b",projectId:"project-b",kind:"fact",summary:"Private beta deployment marker",content:{marker:"beta-only"},confidence:1,tags:["deployment"]});

const alpha=memory.recallScoped("alpha deployment marker",10,"project-a");
if(alpha.length!==1||alpha[0]?.projectId!=="project-a")throw new Error("Scoped lexical recall did not stay in project A.");
if(alpha.some(entry=>entry.projectId!=="project-a"||JSON.stringify(entry).includes("beta-only")))throw new Error("Scoped lexical recall leaked project B.");

const beta=await memory.recallAsyncScoped("beta deployment marker",10,"project-b");
if(beta.length!==1||beta[0]?.projectId!=="project-b")throw new Error("Scoped hybrid recall did not stay in project B.");
if(beta.some(entry=>entry.projectId!=="project-b"||JSON.stringify(entry).includes("alpha-only")))throw new Error("Scoped hybrid recall leaked project A.");

let syncRejected=false;
try{memory.recallScoped("deployment",10,"  ");}catch(error){syncRejected=error instanceof Error&&error.message.includes("Project id is required");}
if(!syncRejected)throw new Error("Scoped recall accepted a blank project id.");

let asyncRejected=false;
try{await memory.recallAsyncScoped("deployment",10,"  ");}catch(error){asyncRejected=error instanceof Error&&error.message.includes("Project id is required");}
if(!asyncRejected)throw new Error("Scoped async recall accepted a blank project id.");

console.log("Required project-scoped memory recall tests passed.");
