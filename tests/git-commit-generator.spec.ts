import {GitCommitGenerator} from "../src/core/git-commit-generator.js";

const generator=new GitCommitGenerator(process.cwd());
const status=await (generator as any).run?.(process.cwd(),["status","--porcelain"]).catch(()=>null);
if(status===undefined)throw new Error("Commit generator was not initialized.");
let rejected=false;
try{await generator.commit({missionId:"m",projectId:"p",message:"fixup! unsafe"});}catch{rejected=true;}
if(!rejected)throw new Error("Unsafe autonomous commit message was accepted.");
console.log("Git commit generator tests passed.");
