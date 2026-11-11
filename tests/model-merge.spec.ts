import assert from "node:assert/strict";
import {buildMergePrompt,mergeModels,type MergeAsk} from "../src/core/model-merge.js";

const reply=(map:Record<string,string|Error>):MergeAsk=>async(_input,model)=>{const value=map[model];if(value instanceof Error)throw value;return{output:value??""};};
// Answers are merged by the chosen model, and each source is reported.
{
  const seen:string[]=[];
  const ask:MergeAsk=async(input,model)=>{seen.push(model);return{output:input.startsWith("Several")?'{"answer":"391","agreement":"partial","disagreements":["one said 381"]}':model==="a"?"391":"381"};};
  const result=await mergeModels({question:"17*23",models:["a","b"],merger:"a",ask});
  assert.equal(result.answer,"391");assert.equal(result.merged,true);assert.equal(result.mergedBy,"a");assert.deepEqual(result.disagreements,["one said 381"]);
  assert.deepEqual(seen,["a","b","a"]);assert.deepEqual(result.sources.map(s=>s.answer),["391","381"]);
}
// A model that fails is reported, and a single survivor is not called a merge.
{
  const result=await mergeModels({question:"q",models:["a","b"],ask:reply({a:new Error("timed out"),b:"only answer"})});
  assert.equal(result.merged,false);assert.equal(result.agreement,"single");assert.equal(result.answer,"only answer");assert.match(result.sources[0]!.error!,/timed out/);
}
// A merger that returns nonsense falls back honestly.
{
  const result=await mergeModels({question:"q",models:["a","b"],ask:async(input,model)=>({output:input.startsWith("Several")?"not json":model+" says"})});
  assert.equal(result.merged,false);assert.equal(result.answer,"a says");assert.match(result.disagreements[0]!,/could not be merged/);
}
// The merger cannot be a model that failed to answer.
{
  const asked:string[]=[];
  await mergeModels({question:"q",models:["a","b","c"],merger:"a",ask:async(input,model)=>{asked.push(model);if(model==="a")throw new Error("down");return{output:input.startsWith("Several")?'{"answer":"x"}':"ans"};}});
  assert.deepEqual(asked,["a","b","c","b"]);
}
// All failed: an error, never an empty answer.
await assert.rejects(mergeModels({question:"q",models:["a"],ask:reply({a:new Error("down")})}),/No model answered/);
await assert.rejects(mergeModels({question:"q",models:[],ask:reply({})}),/No model is available/);
// The merger does not see whose answer is whose.
assert.equal(buildMergePrompt("q",["x"]).includes("gpt-oss"),false);
console.log("model-merge: one answer from several models, disagreement kept, and failures reported honestly");
