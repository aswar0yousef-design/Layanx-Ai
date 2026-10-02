import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {createProjectVerifyToolAdapter} from "../src/tools/fabric.js";
import type {ToolRequest} from "../src/core/types.js";

const root=await mkdtemp(join(process.cwd(),"verify-tool-test-"));
const project="project-a";
await writeFile(join(root,project+".tmp"),"","utf8").catch(()=>{});
const {mkdir}=await import("node:fs/promises");
await mkdir(join(root,project),{recursive:true});
await writeFile(join(root,project,"package.json"),JSON.stringify({scripts:{test:"echo test",typecheck:"echo typecheck",build:"echo build"}}),"utf8");

const adapter=createProjectVerifyToolAdapter({root});
const base:ToolRequest={missionId:"m",agentId:"core",projectId:project,tool:"project.verify",action:"verify project",permission:"L4_EXECUTE",idempotencyKey:"verify",payload:{script:"test"}};
const result=await adapter.execute(base) as {passed:boolean;exitCode:number;script:string};
if(!result.passed||result.exitCode!==0||result.script!=="test")throw new Error("Project verification did not pass.");
await adapter.execute({...base,payload:{script:"npm install"}}).then(()=>{throw new Error("Unbounded verification script was accepted.");}).catch(error=>{if(!String(error).includes("one of"))throw error;});
await rm(root,{recursive:true,force:true});
console.log("Project verification tests passed.");
