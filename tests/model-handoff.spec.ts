import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {classifyFailure,decideAfterFailure,diffFingerprints,failureSignature,firstUsableRung,projectFingerprint,renderHandoff,type ModelAttempt} from "../src/autonomy/model-handoff.js";
import {ModelRegistry} from "../src/models/registry.js";
import {ollamaModelLadders,ollamaTaskModels} from "../src/config/providers.js";
import {buildModelLadders} from "../src/providers/ollama-discovery.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-handoff-"));
process.env.LAYANX_WORKSPACE_ROOT=root;

// Failures are compared by meaning, not by their temp paths or line numbers.
assert.equal(failureSignature("Error at C:\\tmp\\a1\\x.js:10 port 4312"),failureSignature("Error at C:\\tmp\\b2\\x.js:99 port 5555"));
assert.notEqual(failureSignature("x is not defined"),failureSignature("y is not defined"));
assert.notEqual(failureSignature("a".repeat(600)+"\nSyntaxError: one"),failureSignature("a".repeat(600)+"\nSyntaxError: two"),"a long echoed source line must not hide the error after it");

assert.equal(classifyFailure({agentStopped:"All candidate model providers failed: ollama:This operation was aborted",failedChecks:[],changedFiles:false}),"unresponsive");
assert.equal(classifyFailure({agentStopped:"Adaptive planner returned invalid JSON.",failedChecks:[],changedFiles:false}),"unusable-output");
assert.equal(classifyFailure({failedChecks:["test"],changedFiles:false}),"claimed-done","finished, checks failed, nothing changed");
assert.equal(classifyFailure({failedChecks:["test"],changedFiles:true}),"failed","real work that still fails gets a normal retry");

const attempt=(over:Partial<ModelAttempt>):ModelAttempt=>({at:"t",session:0,milestone:0,model:"a",outcome:"failed",summary:"s",signature:"one",changedFiles:true,...over});
const decide=(over:Partial<Parameters<typeof decideAfterFailure>[0]>)=>decideAfterFailure({ladder:["a","b","c"],rung:0,unresponsive:[],earlierOnRung:[],attempt:attempt({}),...over});
assert.deepEqual(decide({}),{action:"retry"});
assert.equal(decide({earlierOnRung:[attempt({signature:"other"})],attempt:attempt({signature:"two"})}).action,"switch","the quota is two attempts per model");
const repeated=decide({earlierOnRung:[attempt({})]}) as {reason:string;model:string};
assert.match(repeated.reason,/same failure/);assert.equal(repeated.model,"b");
assert.equal((decide({attempt:attempt({outcome:"claimed-done"})}) as {model:string}).model,"b","a false 'done' changes the model at once");
assert.equal((decide({attempt:attempt({outcome:"unresponsive"}),unresponsive:["a","b"]}) as {model:string}).model,"c","a model that stopped answering is skipped");
assert.deepEqual(decide({rung:2,attempt:attempt({outcome:"unusable-output"})}),{action:"retry"},"one malformed reply does not end the job when nobody comes after this model");
assert.equal(decide({proven:["a"],attempt:attempt({outcome:"unusable-output"})}).action,"retry","or replace a proven model");
assert.equal(decide({rung:2,earlierOnRung:[attempt({outcome:"unusable-output"})],attempt:attempt({outcome:"unusable-output"})}).action,"exhausted","the same malformed reply twice does");
assert.equal(decide({rung:2,attempt:attempt({outcome:"unresponsive"}),unresponsive:["a"]}).action,"exhausted","a last model that stopped answering ends the job");
// The ladder must not cost the best model the tries it had without a ladder.
assert.deepEqual(decide({rung:2,earlierOnRung:[attempt({signature:"x"})],attempt:attempt({signature:"y"})}),{action:"retry"},"nobody comes after the last model, so it keeps the full budget");
assert.equal(decide({rung:2,earlierOnRung:[attempt({signature:"x"}),attempt({signature:"y"}),attempt({signature:"z"})],attempt:attempt({signature:"w"})}).action,"exhausted");
assert.equal(decide({rung:2,earlierOnRung:[attempt({})]}).action,"exhausted","even the last model stops on a repeated failure");
assert.deepEqual(decide({proven:["a"],earlierOnRung:[attempt({signature:"x"})],attempt:attempt({signature:"y"})}),{action:"retry"},"a proven model is not replaced early");
const provenSpent=decide({proven:["a"],earlierOnRung:[attempt({signature:"x"}),attempt({signature:"y"}),attempt({signature:"z"})],attempt:attempt({signature:"w"})}) as {action:string;reason:string};
assert.equal(provenSpent.action,"switch");assert.match(provenSpent.reason,/4 attempts/);
assert.equal(decide({proven:["a"],earlierOnRung:[attempt({})]}).action,"switch","a proven model that loops is still replaced");
assert.equal(firstUsableRung(["a","b"],["a"]),1);
assert.equal(firstUsableRung(["a"],["a"]),0);

// What changed comes from the disk.
const dir=path.join(root,"fp");fs.mkdirSync(path.join(dir,".layanx"),{recursive:true});fs.mkdirSync(path.join(dir,"node_modules"));
fs.writeFileSync(path.join(dir,"a.js"),"1");fs.writeFileSync(path.join(dir,"gone.js"),"1");fs.writeFileSync(path.join(dir,".layanx","x.md"),"1");fs.writeFileSync(path.join(dir,"node_modules","m.js"),"1");
const before=projectFingerprint(dir);
assert.deepEqual(Object.keys(before).sort(),["a.js","gone.js"],"bookkeeping and dependencies do not count");
assert.equal(diffFingerprints(before,projectFingerprint(dir)).any,false);
fs.writeFileSync(path.join(dir,"a.js"),"2");fs.rmSync(path.join(dir,"gone.js"));fs.writeFileSync(path.join(dir,"new.js"),"1");fs.writeFileSync(path.join(dir,".layanx","x.md"),"2");
const diff=diffFingerprints(before,projectFingerprint(dir));
assert.deepEqual([diff.added,diff.modified,diff.deleted],[["new.js"],["a.js"],["gone.js"]]);

const text=renderHandoff({goal:"Build it",acceptance:["works"],status:"transfer",from:"a",to:"b",reason:"the same failure happened again",current:1,
  milestones:[{title:"One",goal:"g1",status:"done"},{title:"Two",goal:"g2",status:"pending"},{title:"Three",goal:"g3",status:"pending"}],
  evidence:[{milestone:"One",checks:"build; by a"}],changes:diff,attempts:[attempt({summary:"tried X and it failed"}),attempt({outcome:"passed",summary:"build"})],lastFailure:"boom at line 3"});
for(const expected of ["Written by LayanX","From a to b","The work is not complete","tried X and it failed","boom at line 3","One (build; by a)","new.js (new)","a.js (modified)","gone.js (deleted)","- Two\n- Three","Do not redo finished steps","Only passing checks count"])assert.ok(text.includes(expected),expected);
assert.ok(!text.includes("- build"),"a passed attempt is not listed under what not to repeat");
assert.match(renderHandoff({goal:"g",acceptance:[],status:"blocked",from:"c",reason:"r",current:0,milestones:[],evidence:[],changes:diffFingerprints({},{}),attempts:[],lastFailure:""}),/STATUS: BLOCKED/);

// A ladder model answers only when named, so it never becomes a silent failover candidate.
const registry=new ModelRegistry();
registry.register({id:"main",provider:"ollama",capabilities:["chat","reasoning","coding"],local:true,enabled:true,priority:1});
for(const model of ollamaTaskModels(JSON.stringify({coding:"coder"}),"main","",{coding:["coder","spare"],planning:["main"]}))registry.register(model);
assert.deepEqual(registry.select({capability:"reasoning"}).map(m=>m.id),["main"]);
assert.deepEqual(registry.select({capability:"coding"}).map(m=>m.id).sort(),["coder","main"]);
assert.deepEqual(registry.select({capability:"reasoning",modelId:"spare"}).map(m=>m.id),["spare"]);
assert.deepEqual(registry.select({capability:"reasoning",modelId:"coder"}).map(m=>m.id),["coder"]);
assert.equal(ollamaModelLadders("not json"),undefined);
assert.deepEqual(ollamaModelLadders('{"coding":["a",1],"planning":[]}'),{coding:["a"],planning:[]});

const profile=(name:string,gb:number,paramsB:number)=>({name,sizeBytes:gb*2**30,paramsB,capabilities:["completion","tools"],contextLength:8192}) as any;
const ladders=buildModelLadders({models:[profile("gpt-oss:20b",13,20),profile("huge:90b",30,90),profile("small:3b",2,3)],loaded:[]},{totalMemBytes:32*2**30,freeMemBytes:20*2**30,gpuVramBytes:6*2**30});
assert.deepEqual(ladders.proven,["gpt-oss:20b"]);assert.deepEqual(ollamaModelLadders(JSON.stringify(ladders))?.proven,["gpt-oss:20b"]);
assert.equal(ladders.coding[0],"gpt-oss:20b");assert.equal(ladders.planning[0],"gpt-oss:20b","the planner that passed the evals leads");
assert.ok(!ladders.coding.includes("huge:90b"),"a model the machine cannot hold is left out");

// Through the supervisor.
const {Supervisor}=await import("../src/autonomy/supervisor.js");
const terminal=["completed","failed","budget_exhausted","waiting_approval"];
const projectId="site";const project=path.join(root,projectId);
const run=async(opts:{agent:(model:string|undefined,goal:string,attempt:number)=>any;ladders?:{coding:string[];planning:string[]};milestones?:any[];withTests?:boolean})=>{
  fs.rmSync(project,{recursive:true,force:true});fs.mkdirSync(project,{recursive:true});fs.writeFileSync(path.join(project,"app.js"),"old");
  const models:Array<string|undefined>=[],goals:string[]=[],thinkModels:Array<string|undefined>=[];
  const deps:any={
    think:async(_p:string,o:any)=>{thinkModels.push(o?.model);return JSON.stringify({acceptance:["works"],milestones:opts.milestones??[{title:"Build",goal:"write it",kind:"code"},{title:"Finish",goal:"finish it",kind:"code"}],checks:{install:false,security:false}});},
    runAgent:async(goal:string,_p:string,_a:string,routing:any)=>{models.push(routing?.modelId);goals.push(goal);return opts.agent(routing?.modelId,goal,models.length);},
    resumeAgent:async()=>{throw new Error("unused");},
    runTool:async()=>({ok:true,data:{stdout:"",ok:true,exitCode:0}}),isApproved:()=>true,detect:()=>opts.withTests?{stack:"node",scripts:["test"],git:false}:{stack:"unknown",scripts:[],git:false},cloudAvailable:()=>false,externalAgent:()=>{throw new Error("no external agent while a ladder runs");},
    modelLadders:()=>opts.ladders??{coding:["weak","strong"],planning:["weak","strong"]}};
  const supervisor=new Supervisor(deps,{file:path.join(root,`jobs-${Math.random()}.json`),pollMs:5});
  const job=supervisor.create("Build the thing",projectId,{});
  for(let i=0;i<500&&!terminal.includes(supervisor.get(job.id)!.status);i++)await new Promise(r=>setTimeout(r,10));
  supervisor.stop();
  return{job:supervisor.get(job.id)!,models,goals,thinkModels};
};
const write=(content:string)=>fs.writeFileSync(path.join(project,"app.js"),content);

const handoffFile=path.join(project,".layanx","HANDOFF.md");
const transferred=await run({agent:(model,_g,n)=>{if(model==="weak")return{completed:false,reason:"Adaptive planner returned invalid JSON."};write("step"+n);return{completed:true};},withTests:true});
assert.equal(transferred.job.status,"completed",transferred.job.result);
assert.deepEqual(transferred.models,["weak","strong","strong"],"the second model takes over, and the next step stays with the model that delivered");
assert.equal(transferred.thinkModels[0],"weak","planning uses the ladder too");
assert.equal(transferred.job.modelRun?.handoffs.length,1);
assert.equal(transferred.job.modelRun?.handoffs[0]?.to,"strong");
assert.match(fs.readFileSync(handoffFile,"utf8"),/From weak to strong/);
assert.match(transferred.goals[1]!,/Handoff from the previous model/,"the next model receives the handoff");
assert.ok(!transferred.goals[0]!.includes("Handoff from"),"the first model gets none");
assert.ok(fs.existsSync(path.join(project,transferred.job.modelRun!.handoffs[0]!.file)),"each handoff is archived");

// A model that says it finished but changed nothing and proved nothing cannot pass a code step.
const liar=await run({agent:(model,_g,n)=>{if(model==="weak")return{completed:true};write("real"+n);return{completed:true};}});
assert.equal(liar.models[0],"weak");assert.equal(liar.models[1],"strong");
assert.match(liar.job.modelRun!.handoffs[0]!.reason,/reported completion/);
assert.equal(liar.job.milestones[0]!.status,"done");

// With every model exhausted the job stops, says so, and leaves a handoff for whoever continues.
const blocked=await run({agent:()=>({completed:false,reason:"All candidate model providers failed: ollama:This operation was aborted"}),ladders:{coding:["a","b","c"],planning:["a"]}});
assert.equal(blocked.job.status,"failed");
assert.deepEqual(blocked.models,["a","b","c"],"each model once, with no pointless repeats");
assert.match(blocked.job.result!,/every available model was tried/);assert.match(blocked.job.result!,/HANDOFF\.md/);
assert.match(fs.readFileSync(handoffFile,"utf8"),/STATUS: BLOCKED/);

// No ladder: the original behaviour is untouched.
const single=await run({agent:(_m,_g,n)=>{if(n<3)return{completed:false,reason:"some ordinary failure"};write("ok"+n);return{completed:true};},ladders:{coding:["only"],planning:["only"]}});
assert.equal(single.job.modelRun,undefined);assert.deepEqual([...new Set(single.models)],[undefined]);
console.log("model-handoff: rules, HANDOFF.md, registry pinning and supervisor transfers verified");
process.exit(0);
