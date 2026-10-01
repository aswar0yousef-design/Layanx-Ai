import {createRuntime} from "../src/runtime.js";

const runtime=createRuntime();
const names=runtime.core.tools.list().map(tool=>tool.name);
for(const name of ["runtime.status","mission.inspect","memory.recall","http.read","github.repo.read","github.issues.list","github.prs.list"]){
 if(!names.includes(name))throw new Error("Runtime did not register "+name);
}
const discovered=runtime.core.discoverTools("list GitHub issues", "L1_READ");
if(!discovered.some(tool=>tool.name==="github.issues.list"))throw new Error("Core agent cannot discover GitHub issues tool.");
console.log("Runtime connector registration and discovery passed.");
