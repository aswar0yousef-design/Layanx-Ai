import assert from "node:assert/strict";
import test from "node:test";
import {FREE_LLM_DIRECTORY,inspectFreeLlmDirectory} from "../src/providers/free-llm-directory.js";

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
