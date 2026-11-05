import {strict as assert} from "node:assert";
import {test} from "node:test";
import {Supervisor} from "../src/autonomy/supervisor.js";

test("supervisor persists explicit acceptance criteria when creating a job",()=>{
  const criteria=[{id:"required-check",description:"The result must pass a real check",required:true}];
  const supervisor=new Supervisor({
    think:async()=>"",
    runAgent:async()=>({completed:false}),
    resumeAgent:async()=>({completed:false}),
    runTool:async()=>({ok:false}),
    isApproved:()=>false,
    cloudAvailable:()=>false,
    externalAgent:()=>null
  },{sleep:async()=>{}});
  supervisor.stop();
  const job=supervisor.create("Build a working sample", "acceptance-contract-test", {requiredAcceptance:criteria});
  assert.deepEqual(job.requiredAcceptance,criteria);
  criteria[0]!.description="changed outside the job";
  assert.equal(job.requiredAcceptance?.[0]?.description,"The result must pass a real check");
});
