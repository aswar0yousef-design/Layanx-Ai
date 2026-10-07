import assert from "node:assert/strict";
import {buildModelPlan,discoverOllama,parseParamsB,recommendNumCtx,recommendedPull,heuristicCapabilities} from "../src/providers/ollama-discovery.js";
import {AdaptiveOllama,NoSuitableModelError,extractJson} from "../src/providers/adaptive-ollama.js";
import {GB,startMockOllama} from "./fixtures/mock-ollama.js";

const machine16={totalMemBytes:16*GB,freeMemBytes:8*GB};
const machine8={totalMemBytes:8*GB,freeMemBytes:4*GB};

// --- parsing helpers
assert.equal(parseParamsB("7.6B","qwen2.5:7b"),7.6);
assert.ok(Math.abs(parseParamsB("494.03M","x")-0.494)<0.001);
assert.equal(parseParamsB("","llama3.2:3b-instruct-q4_K_M"),3);
assert.equal(parseParamsB("","nomic-embed-text:latest"),0);
assert.deepEqual(heuristicCapabilities("nomic-embed-text:latest"),["embedding"]);
assert.ok(heuristicCapabilities("llava:7b").includes("vision"));
assert.ok(heuristicCapabilities("qwen2.5:7b").includes("tools"));
assert.ok(!heuristicCapabilities("gemma3:1b").includes("vision"));
assert.equal(recommendedPull(machine8),"qwen3.5:4b");
assert.equal(recommendedPull(machine16),"qwen3.5:9b");

// --- discovery against a mock server that mixes reported and missing capabilities
const ollama=await startMockOllama([
  {name:"qwen2.5:7b",size:4.7*GB,parameter_size:"7.6B",family:"qwen2",capabilities:["completion","tools"],context:32768},
  {name:"qwen2.5-coder:7b",size:4.7*GB,parameter_size:"7.6B",family:"qwen2",capabilities:["completion","tools","insert"],context:32768},
  {name:"llama3.2:3b",size:2.0*GB,parameter_size:"3.2B",family:"llama",capabilities:["completion","tools"],context:131072},
  {name:"llava:7b",size:4.7*GB,parameter_size:"7B",family:"llama",capabilities:["completion","vision"],context:4096},
  {name:"nomic-embed-text:latest",size:0.27*GB,parameter_size:"137M",family:"nomic-bert",capabilities:["embedding"]},
  {name:"old-model:13b",size:7.4*GB,parameter_size:"13B",family:"llama"},          // no capabilities -> heuristic
  {name:"huge:70b",size:40*GB,parameter_size:"70B",family:"llama",capabilities:["completion","tools"]}
]);
try{
  const discovery=await discoverOllama(ollama.url);
  assert.equal(discovery.reachable,true);
  assert.equal(discovery.version,"0.12.0");
  assert.equal(discovery.models.length,7);
  const old=discovery.models.find(m=>m.name==="old-model:13b")!;
  assert.equal(old.capabilitySource,"heuristic");
  assert.equal(discovery.models.find(m=>m.name==="qwen2.5:7b")!.contextLength,32768);

  const plan=buildModelPlan(discovery,machine16);
  assert.equal(plan.assignments.coding,"qwen2.5-coder:7b","coder model should win coding");
  assert.equal(plan.assignments.vision,"llava:7b","only vision model should win vision");
  assert.equal(plan.assignments.embedding,"nomic-embed-text:latest");
  assert.equal(plan.assignments.fast,"llama3.2:3b","smallest tool model should be fast");
  assert.notEqual(plan.assignments.planning,"huge:70b","a 40 GB model must not be picked on a 16 GB machine");
  assert.equal(plan.assignments.planning,"qwen2.5:7b");

  const pinnedMissing=buildModelPlan(discovery,machine16,{planning:"qwen2.5-coder:7b-not-installed"});
  assert.equal(pinnedMissing.assignments.planning,"qwen2.5:7b");
  assert.ok(pinnedMissing.warnings.some(w=>w.includes("not installed")));
  const pinnedOk=buildModelPlan(discovery,machine16,{general:"llama3.2"});
  assert.equal(pinnedOk.assignments.general,"llama3.2:3b","pin without tag resolves to installed tag");

  // num_ctx is always explicit and bounded by the model
  assert.equal(recommendNumCtx({contextLength:32768,paramsB:7.6},machine16),8192);
  assert.equal(recommendNumCtx({contextLength:4096,paramsB:7},machine16),4096);
  assert.equal(recommendNumCtx({contextLength:0,paramsB:3},machine8),4096);

  // --- adaptive client
  const client=new AdaptiveOllama({baseUrl:ollama.url,machine:machine16});
  ollama.replies.set("qwen2.5:7b",["404"]);              // planned model disappears
  ollama.replies.set("qwen2.5-coder:7b",["fallback answer"]);
  const fallback=await client.chat({task:"planning",messages:[{role:"user",content:"plan"}]});
  assert.equal(fallback.content,"fallback answer");
  assert.equal(fallback.attempts.length,2,"should fall back to the next installed model");
  const chatCall=ollama.calls.filter(c=>c.path==="/api/chat").at(-1)!;
  assert.equal((chatCall.body.options as {num_ctx:number}).num_ctx,8192,"num_ctx must be sent");

  // thinking blocks stripped, fenced JSON parsed, one repair attempt
  ollama.replies.set("qwen2.5:7b",["<think>hmm</think>```json\n{\"steps\":[1,2]}\n```"]);
  const fresh=new AdaptiveOllama({baseUrl:ollama.url,machine:machine16});
  const json=await fresh.json<{steps:number[]}>({task:"planning",messages:[{role:"user",content:"x"}]});
  assert.deepEqual(json.value.steps,[1,2]);
  ollama.replies.set("qwen2.5:7b",["not json at all","{\"ok\":true}"]);
  const repaired=await fresh.json<{ok:boolean}>({task:"planning",messages:[{role:"user",content:"x"}]});
  assert.equal(repaired.value.ok,true);

  // native tools when supported
  ollama.replies.set("qwen2.5:7b",[{tool_calls:[{function:{name:"files.read",arguments:{path:"README.md"}}}]}]);
  const tools=[{name:"files.read",description:"read a file",parameters:{type:"object",properties:{path:{type:"string"}}}}];
  const native=await fresh.chat({task:"planning",messages:[{role:"user",content:"read readme"}],tools});
  assert.equal(native.usedNativeTools,true);
  assert.deepEqual(native.toolCalls,[{name:"files.read",arguments:{path:"README.md"}}]);

  // JSON tool protocol for a model without tool support (forced)
  ollama.replies.set("old-model:13b",['{"tool":"files.read","arguments":{"path":"a.txt"}}']);
  const viaJson=await fresh.chat({model:"old-model:13b",messages:[{role:"user",content:"read a.txt"}],tools});
  assert.equal(viaJson.usedNativeTools,false);
  assert.deepEqual(viaJson.toolCalls,[{name:"files.read",arguments:{path:"a.txt"}}]);

  // Ollama says "does not support tools" -> retry same model with JSON protocol
  const rejecting=await startMockOllama([{name:"liar:7b",size:4*GB,parameter_size:"7B",capabilities:["completion","tools"]}],{toolRejecting:["liar:7b"]});
  try{
    const c=new AdaptiveOllama({baseUrl:rejecting.url,machine:machine16});
    rejecting.replies.set("liar:7b",['{"tool":"files.read","arguments":{"path":"b"}}']);
    const r=await c.chat({messages:[{role:"user",content:"x"}],tools});
    assert.equal(r.usedNativeTools,false);
    assert.equal(r.toolCalls[0]?.arguments.path,"b");
  }finally{await rejecting.close();}

  // images route to the vision model automatically
  ollama.replies.set("llava:7b",["a cat"]);
  const seen=await fresh.chat({messages:[{role:"user",content:"what is this?",images:["aGVsbG8="]}]});
  assert.equal(seen.model,"llava:7b");

  const emb=await fresh.embed(["hello"]);
  assert.equal(emb.model,"nomic-embed-text:latest");
}finally{await ollama.close();}

// no models / not running -> actionable error
const empty=await startMockOllama([]);
try{
  const c=new AdaptiveOllama({baseUrl:empty.url,machine:machine8});
  await assert.rejects(c.chat({messages:[{role:"user",content:"hi"}]}),(e:unknown)=>e instanceof NoSuitableModelError&&/ollama pull qwen3\.5:4b/.test((e as Error).message));
}finally{await empty.close();}
const down=await discoverOllama("http://127.0.0.1:9",{timeoutMs:500});
assert.equal(down.reachable,false);
assert.match(down.error??"",/not reachable/);

assert.deepEqual(extractJson('Sure! {"a":"}{","b":[1]} trailing'),{a:"}{",b:[1]});

// ---------- the owner's PC: GTX 1660 Super 6 GB + 32 GB RAM
const pc={totalMemBytes:32*GB,freeMemBytes:20*GB,gpuVramBytes:6*GB};
const owned={reachable:true,baseUrl:"x",loaded:[],discoveredAt:new Date().toISOString(),models:[
  {name:"qwen3.5:9b",sizeBytes:6.6e9,family:"qwen35",parameterSize:"9B",paramsB:9,quantization:"Q4_K_M",capabilities:["completion","vision","tools","thinking"],capabilitySource:"ollama" as const,contextLength:262144},
  {name:"qwen3.5:4b",sizeBytes:3.3e9,family:"qwen35",parameterSize:"4B",paramsB:4,quantization:"Q4_K_M",capabilities:["completion","vision","tools","thinking"],capabilitySource:"ollama" as const,contextLength:262144},
  {name:"qwen2.5-coder:7b",sizeBytes:4.7e9,family:"qwen2",parameterSize:"7.6B",paramsB:7.6,quantization:"Q4_K_M",capabilities:["completion","tools","insert"],capabilitySource:"ollama" as const,contextLength:32768},
  {name:"bge-m3:latest",sizeBytes:1.2e9,family:"bert",parameterSize:"567M",paramsB:0.567,quantization:"F16",capabilities:["embedding"],capabilitySource:"ollama" as const,contextLength:8192}
]};
const pcPlan=buildModelPlan(owned,pc).assignments;
assert.deepEqual(pcPlan,{general:"qwen3.5:9b",planning:"qwen3.5:9b",coding:"qwen2.5-coder:7b",vision:"qwen3.5:9b",embedding:"bge-m3:latest",fast:"qwen3.5:4b"});
assert.equal(recommendNumCtx(owned.models[0]!,pc),8192,"9b spills past 6 GB: keep the context modest");
assert.equal(recommendNumCtx(owned.models[1]!,pc),16384,"4b fits in VRAM with room for a long context");
assert.equal(recommendNumCtx(owned.models[2]!,pc),9216,"coder: context sized to what is left of the 6 GB");

console.log("local-ollama: all assertions passed");
