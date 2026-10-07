import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {CloudBudget} from "../src/models/cloud-budget.js";
import {RoutingMemory} from "../src/models/routing-memory.js";
import {fitSections,promptBudgetChars} from "../src/core/ai-planner.js";
import {LayanXCore} from "../src/core/orchestrator.js";
import type {ModelProviderAdapter} from "../src/models/inference.js";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-budget-"));
const claude={id:"claude-sonnet-5-5",provider:"anthropic",capabilities:["reasoning"] as any,local:false,enabled:true,priority:10};
const local={id:"qwen3.5:9b",provider:"ollama",capabilities:["reasoning"] as any,local:true,enabled:true,priority:1};

// 1. Budget: tokens and dollars per month; local and free models are never limited.
const budget=new CloudBudget(path.join(dir,"cloud-usage.json"),{LAYANX_CLOUD_MONTHLY_BUDGET_USD:"0.05",LAYANX_PRICE_ANTHROPIC_IN:"3",LAYANX_PRICE_ANTHROPIC_OUT:"15"});
assert.equal(budget.metered(local),false);
assert.equal(budget.metered({...claude,costPer1kInputUsd:0,costPer1kOutputUsd:0}),false,"free pool models are not metered");
budget.record(claude,{modelId:claude.id,provider:"anthropic",output:"ok",usage:{inputTokens:10000,outputTokens:1000}},0);
const st=budget.status();
assert.equal(st.providers.anthropic!.calls,1);assert.equal(st.totalTokens,11000);assert.equal(st.totalCostUsd,0.045);
assert.equal(budget.allow(claude),true,"under the cap");
budget.record(claude,{modelId:claude.id,provider:"anthropic",output:"x".repeat(400)},8000);
assert.equal(budget.status().exhausted,true,"estimated tokens count when the provider reports none");
assert.equal(budget.allow(claude),false);assert.equal(budget.allow(local),true);
assert.equal(new CloudBudget(path.join(dir,"cloud-usage.json"),{LAYANX_CLOUD_MONTHLY_BUDGET_USD:"0.05",LAYANX_PRICE_ANTHROPIC_IN:"3",LAYANX_PRICE_ANTHROPIC_OUT:"15"}).status().blocked,1,"usage persists");
const tokensOnly=new CloudBudget(null,{LAYANX_CLOUD_MONTHLY_TOKENS:"100"});
tokensOnly.record(claude,{modelId:claude.id,provider:"anthropic",output:"",usage:{inputTokens:90,outputTokens:20}},0);
assert.equal(tokensOnly.allow(claude),false,"token cap works without prices");

// 2. The router skips cloud models over budget and stays local.
const calls:string[]=[];
const provider=(name:string):ModelProviderAdapter=>({name,async health(){return{provider:name,available:true,updatedAt:new Date().toISOString()};},
  async generate(model){calls.push(model.id);if(name==="ollama")throw new Error("local model failed");return{provider:name,modelId:model.id,output:"cloud answer",usage:{inputTokens:5,outputTokens:5}};}});
const core=new LayanXCore();
core.models.register(local);core.models.register(claude);
core.providers.register(provider("ollama"));core.providers.register(provider("anthropic"));
core.modelExecution.budget=new CloudBudget(null,{LAYANX_CLOUD_MONTHLY_TOKENS:"10"});
assert.equal((await core.modelExecution.execute({capability:"reasoning",input:"hi"})).output,"cloud answer","local fails -> cloud");
await assert.rejects(core.modelExecution.execute({capability:"reasoning",input:"hi"}),/Monthly cloud budget reached/);
assert.deepEqual(calls,["qwen3.5:9b","claude-sonnet-5-5","qwen3.5:9b"],"no cloud call once the cap is reached");

// 3. Learned routing: two local planning failures on similar goals -> cloud first; a local success wins it back.
const memory=new RoutingMemory(path.join(dir,"routing-history.json"));
memory.record("refactor the payment module architecture in the shop","local_failed");
assert.equal(memory.suggestCloud("refactor payment module architecture for the shop"),false);
memory.record("refactor the payment module architecture of my shop","local_failed");
assert.equal(memory.suggestCloud("refactor payment module architecture for the shop"),true);
assert.equal(memory.suggestCloud("write a poem about the sea"),false,"unrelated goals stay local");
memory.record("refactor the payment module architecture in the shop","local_ok");
assert.equal(memory.suggestCloud("refactor payment module architecture for the shop"),false);
assert.equal(new RoutingMemory(path.join(dir,"routing-history.json")).similar("refactor payment module architecture shop").length,3,"history persists");

// 4. Prompts fit the local context window; the instructions are never pushed out.
assert.equal(promptBudgetChars({LAYANX_OLLAMA_CONTEXT:JSON.stringify({"qwen3.5:9b":8192,"qwen3.5:4b":16384})}),Math.floor(8192*3*0.7));
assert.equal(promptBudgetChars({LAYANX_PROMPT_BUDGET_CHARS:"9000"}),9000);
const [a,b,c]=fitSections(2000,[{text:"r".repeat(20000),weight:0.45,max:12000},{text:"m".repeat(300),weight:0.25,max:8000},{text:"p".repeat(20000),weight:0.3,max:6000}],12000);
assert.equal(b,"m".repeat(300),"short sections stay whole");
assert.ok(a!.length+b!.length+c!.length<=10000+80,"total fits the budget");
assert.match(a!,/trimmed to fit/);
fs.rmSync(dir,{recursive:true,force:true});
console.log("cloud-budget-routing: monthly cap, router enforcement, learned routing and prompt fitting verified");
