import {PullRequestGenerator} from "../src/core/pr-generator.js";
const generator=new PullRequestGenerator(process.cwd());
const codeReview={branch:"main",commit:"deadbeef",files:["x.ts"],findings:[],approved:true};
const securityReview={branch:"main",commit:"deadbeef",files:["x.ts"],findings:[],approved:true};
const draft=await generator.generate({missionId:"m",projectId:"p",baseBranch:"main",title:"test",goal:"test goal",codeReview,securityReview});
if(draft.ready)throw new Error("PR generator must block when head equals base.");
if(!draft.blockers.length)throw new Error("Expected PR blocker.");
console.log("PR generator tests passed.");
