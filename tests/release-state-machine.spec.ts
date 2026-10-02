import {ReleaseStateMachine} from "../src/core/release-state-machine.js";

const machine=new ReleaseStateMachine();
const created=machine.create({id:"r1",missionId:"m1",projectId:"p1",branch:"feature/x",baseBranch:"main",commit:"abc",title:"Test"});
if(created.stage!=="DRAFT")throw new Error("Release must start in DRAFT.");
const reviewed=machine.transition("r1","REVIEWED");
if(reviewed.stage!=="REVIEWED")throw new Error("REVIEWED transition failed.");
let blocked=false;
try{machine.transition("r1","PR_READY",["security gate"]);}catch{blocked=true;}
if(!blocked)throw new Error("Blockers must prevent promotion.");
machine.transition("r1","SECURITY_APPROVED");
machine.transition("r1","PR_READY");
machine.transition("r1","HUMAN_APPROVAL");
machine.transition("r1","MERGE_ALLOWED");
console.log("Release state machine tests passed.");
