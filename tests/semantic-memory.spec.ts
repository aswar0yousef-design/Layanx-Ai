import {MemoryEngine} from "../src/core/memory.js";
import {ContextFabric} from "../src/core/context-fabric.js";

const memory=new MemoryEngine();
memory.remember({missionId:"m1",projectId:"p1",kind:"fact",summary:"Database uses PostgreSQL",content:{database:"PostgreSQL"},confidence:0.9,tags:["database","postgres"]});
memory.remember({missionId:"m2",projectId:"p1",kind:"decision",summary:"Use PostgreSQL for production persistence",content:{reason:"reliability"},confidence:1,tags:["database","postgres","production"]});
memory.remember({missionId:"m3",projectId:"p1",kind:"failure",summary:"PostgreSQL migration failed because of schema mismatch",content:{error:"schema mismatch"},confidence:1,tags:["database","migration","failure"]});
memory.remember({missionId:"m4",projectId:"p2",kind:"decision",summary:"Different project decision",content:{database:"SQLite"},confidence:1,tags:["database"]});

const recalled=memory.recall("PostgreSQL migration schema",10,"p1");
if(!recalled.length||recalled[0]?.kind!=="failure")throw new Error("Semantic memory ranking failed.");
if(recalled.some(item=>item.projectId==="p2"))throw new Error("Project memory isolation failed.");

const mission={id:"m5",goal:"database migration",status:"running",risk:"medium",requiredPermission:"L3_MODIFY" as const,steps:[],projectId:"p1",createdAt:new Date().toISOString()};
const context=new ContextFabric(memory).build({projectId:"p1",mission,query:"PostgreSQL migration",limit:3,maxChars:5000});
if(!context.memories.length||context.memories[0]?.kind!=="failure")throw new Error("Context prioritization failed.");
if(context.text.length>5000)throw new Error("Context budget failed.");
console.log("Semantic memory and context fabric tests passed.");
