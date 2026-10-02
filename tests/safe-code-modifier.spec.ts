import {mkdir,readFile,rm,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {SafeCodeModifier} from "../src/core/safe-code-modifier.js";

const root=resolve(process.cwd(),"tmp-safe-modifier-test");
await rm(root,{recursive:true,force:true});
await mkdir(resolve(root,"p"),{recursive:true});
await writeFile(resolve(root,"p","example.ts"),"export const value=1;","utf8");

const mission={id:"m1",goal:"update example",status:"planned",risk:"low",requiredPermission:"L3_MODIFY",steps:[],createdAt:new Date().toISOString(),projectId:"p"};
const core={
  projectIsolation:{normalize:(id:string)=>id,assertMissionProject:()=>{}},
  missions:{get:(id:string)=>id==="m1"?structuredClone(mission):undefined},
  projectGraph:{scan:async()=>({projectId:"p",generatedAt:new Date().toISOString(),truncated:false,nodes:[{id:"example.ts",kind:"file",path:"example.ts",category:"typescript"}],edges:[],entryPoints:[],routes:[],tests:["tests/example.test.ts"],dependencies:{}})},
  impactAnalyzer:{analyze:()=>({projectId:"p",query:"example.ts",generatedAt:new Date().toISOString(),matchedFiles:["example.ts"],affectedFiles:["example.ts"],affectedTests:[],affectedRoutes:[],affectedEntries:[],dependencyPackages:[],risk:"low",score:6,reasons:[],recommendations:[]})},
  testSelector:{select:()=>({tests:[]})},
  projectIntelligence:{invalidate:()=>{}},
  runSelectedTests:async()=>({ok:true}),
  audit:{append:()=>{}},
  executionRuntime:{approvals:{authorize:()=>({allowed:true,reason:"Approval valid."})}}
} as any;

const modifier=new SafeCodeModifier(core,root);
const result=await modifier.apply({projectId:"p",missionId:"m1",changes:[{path:"example.ts",content:"export const value=2;"}]});
if(!result.ok)throw new Error(result.error??"Safe modification failed.");
const updated=await readFile(resolve(root,"p","example.ts"),"utf8");
if(updated!=="export const value=2;")throw new Error("Code change was not applied.");
let rejected=false;
try{await modifier.apply({projectId:"p",missionId:"m1",changes:[{path:"../escape.ts",content:"x"}]});}catch{rejected=true;}
if(!rejected)throw new Error("Unsafe path was accepted.");
await rm(root,{recursive:true,force:true});
console.log("Safe code modifier tests passed.");
