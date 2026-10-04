import assert from "node:assert/strict";
import test from "node:test";
import {FREE_LLM_DIRECTORY,inspectFreeLlmDirectory} from "../src/providers/free-llm-directory.js";
import {ModelRegistry} from "../src/models/registry.js";
import {ModelProviderRegistry} from "../src/core/model-execution.js";
import {configureProviders} from "../src/config/providers.js";

test("free LLM catalog has unique providers and no embedded API secrets",()=>{
 const ids=FREE_LLM_DIRECTORY.map(x=>x.providerId);
 assert.equal(new Set(ids).size,ids.length);
 for(const entry of FREE_LLM_DIRECTORY){
  assert.match(entry.keyUrl,/^https:\/\//);
  assert.match(entry.baseUrl,/^https:\/\//);
  assert.ok(!entry.apiKey);
 }
});

test("free LLM inspection is safe when keys are absent",()=>{
 const entries=inspectFreeLlmDirectory();
 assert.equal(entries.length,FREE_LLM_DIRECTORY.length);
 for(const entry of entries)assert.ok(["vault","env","none"].includes(entry.keySource));
});


test("free providers are namespaced and do not collide with first-party providers",()=>{
 const models=new ModelRegistry();
 const providers=new ModelProviderRegistry();
 configureProviders({
  mode:"cloud",
  ollama:{enabled:false,baseUrl:"http://127.0.0.1:11434",model:"llama3.2:3b",visionModel:"moondream:1.8b"},
  openai:{enabled:false,baseUrl:"https://api.openai.com/v1/responses",healthUrl:"https://api.openai.com/v1/models",model:"gpt-5.6-luna"},
  anthropic:{enabled:false,baseUrl:"https://api.anthropic.com/v1/messages",healthUrl:"https://api.anthropic.com/v1/models",model:"claude-sonnet-4-5"},
  gemini:{enabled:true,apiKey:"test-gemini-key",baseUrl:"https://generativelanguage.googleapis.com/v1beta",healthUrl:"https://generativelanguage.googleapis.com/v1beta/models",model:"gemini-3.6-flash"},
  freePool:{enabled:true,configPath:".layanx/free-providers.json",providers:[{
   name:"Google Gemini",baseUrl:"https://generativelanguage.googleapis.com/v1beta",apiKey:"test-free-key",models:["gemini-3.6-flash"],capabilities:["chat","vision"],priority:50,tags:["free"]
  }]}
 },models,providers);
 assert.ok(providers.get("gemini"));
 assert.ok(providers.get("free:Google Gemini"));
 assert.equal(models.get("free:Google Gemini:gemini-3.6-flash").provider,"free:Google Gemini");
});

test("free pool remains opt-in and local mode stays local-only",()=>{
 const models=new ModelRegistry();
 const providers=new ModelProviderRegistry();
 configureProviders({
  mode:"local",
  ollama:{enabled:false,baseUrl:"http://127.0.0.1:11434",model:"llama3.2:3b",visionModel:"moondream:1.8b"},
  openai:{enabled:false,baseUrl:"https://api.openai.com/v1/responses",healthUrl:"https://api.openai.com/v1/models",model:"gpt-5.6-luna"},
  anthropic:{enabled:false,baseUrl:"https://api.anthropic.com/v1/messages",healthUrl:"https://api.anthropic.com/v1/models",model:"claude-sonnet-4-5"},
  gemini:{enabled:false,baseUrl:"https://generativelanguage.googleapis.com/v1beta",healthUrl:"https://generativelanguage.googleapis.com/v1beta/models",model:"gemini-3.6-flash"},
  freePool:{enabled:true,configPath:".layanx/free-providers.json",providers:[{
   name:"Groq",baseUrl:"https://api.groq.com/openai/v1",apiKey:"test-key",models:["test-model"],capabilities:["chat"],priority:10,tags:["free"]
  }]}
 },models,providers);
 assert.equal(providers.list().length,0);
 assert.equal(models.list().length,0);
});
