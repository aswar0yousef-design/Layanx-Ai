import {GitBranchManager} from "../src/core/git-branch-manager.js";

const manager=new GitBranchManager({root:process.cwd()});
const status=await manager.status();
if(!status.branch)throw new Error("Git branch status did not return a branch.");
let rejected=false;
try{await manager.createBranch("../unsafe");}catch{rejected=true;}
if(!rejected)throw new Error("Invalid branch name was accepted.");
console.log("Git branch manager tests passed.");
