import assert from "node:assert/strict";
import {assessOutcome,type OutcomeInput} from "../src/autonomy/outcome.js";

const base:OutcomeInput={
  jobId:"job-1",projectId:"project-1",acceptanceCriteria:["an invoice can be saved"],
  codeTask:true,checks:[],runtimeProofs:[],browserRequired:false,
  securityRequired:false,observedAt:"2026-10-30T00:00:00.000Z"
};
const assess=(patch:Partial<OutcomeInput>={})=>assessOutcome({...base,...patch});
assert.equal(assess().status,"blocked","Model confidence is not an execution proof.");
assert.match(assess().blockers.join(" "),/no successful non-skipped/);
assert.equal(assess({checks:[{name:"test",ok:true,skipped:true,summary:"not configured"}]}).status,"blocked","Skipped tests never count.");
const success=assess({checks:[{name:"test",ok:true,summary:"passed"}]});
assert.equal(success.status,"verified");
assert.equal(success.verificationScope,"automated-gates");
assert.deepEqual(success.acceptanceCriteria,["an invoice can be saved"],"Descriptive acceptance is not silently certified.");
assert.deepEqual(success.evidence.map(e=>e.reference),["project.run:test"]);
assert.equal(assess({checks:[{name:"test",ok:false,summary:"test failed"},{name:"build",ok:true,summary:"passed"}]}).status,"blocked");
assert.equal(assess({browserRequired:true,checks:[{name:"build",ok:true,summary:"passed"}]}).status,"blocked","Missing required browser test blocks completion.");
const browser={url:"http://127.0.0.1:3000/",ok:true,viewports:["desktop","mobile"],problems:[]};
assert.equal(assess({browserRequired:true,browser}).status,"verified");
assert.equal(assess({browserRequired:true,browser:{...browser,ok:false}}).status,"blocked");
assert.equal(assess({securityRequired:true,checks:[{name:"typecheck",ok:true,summary:"passed"}]}).status,"blocked");
assert.equal(assess({securityRequired:true,security:{score:100,blocked:false},checks:[{name:"typecheck",ok:true,summary:"passed"}]}).status,"verified");
assert.equal(assess({security:{score:20,blocked:true},checks:[{name:"typecheck",ok:true,summary:"passed"}]}).status,"blocked");
assert.equal(assess({codeTask:false}).status,"blocked","Non-code tasks also need a traceable execution result.");
assert.equal(assess({codeTask:false,runtimeProofs:[{missionId:"mission-1",milestone:"open app",observedAt:"2026-10-30T00:00:00.000Z"}]}).status,"verified");
console.log("outcome-engine: missing, skipped, failed, browser, security and runtime evidence validated");
