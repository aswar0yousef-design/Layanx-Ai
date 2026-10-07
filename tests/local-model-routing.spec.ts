import assert from "node:assert/strict";
import http from "node:http";
import {configureProviders,loadProviderConfig,ollamaTaskModels} from "../src/config/providers.js";
import {VoiceService,LocalTranscriber} from "../src/voice/service.js";
import {ollamaThinkingOff,ollamaNumCtx} from "../src/providers/ollama-provider.js";

// Plan chosen by the local host on a GTX 1660 Super 6 GB + 32 GB RAM
const plan={general:"qwen3.5:9b",planning:"qwen3.5:9b",coding:"qwen2.5-coder:7b",vision:"qwen3.5:9b",embedding:"bge-m3:latest",fast:"qwen3.5:4b"};
const env={LAYANX_AI_MODE:"local",OLLAMA_MODEL:"qwen3.5:9b",OLLAMA_VISION_MODEL:"qwen3.5:9b"};
process.env.LAYANX_OLLAMA_MODEL_PLAN=JSON.stringify(plan);
delete process.env.LAYANX_OLLAMA_ROUTING;
const {models}=configureProviders(loadProviderConfig(env as NodeJS.ProcessEnv));
const pick=(capability:any,opts:any={})=>models.select({capability,preferLocal:true,...opts}).map(m=>m.id);

assert.equal(pick("reasoning")[0],"qwen3.5:9b","agent planning uses the strong main model");
assert.equal(pick("reasoning",{latencySensitive:true})[0],"qwen3.5:4b","spoken replies use the fast model");
assert.equal(pick("reasoning",{latencySensitive:true})[1],"qwen3.5:9b","and fall back to the main model");
assert.equal(pick("chat")[0],"qwen3.5:9b");
assert.equal(pick("coding")[0],"qwen2.5-coder:7b","code work goes to the coder model");
assert.equal(pick("coding")[1],"qwen3.5:9b","main model is the coding fallback");
assert.equal(pick("vision")[0],"qwen3.5:9b","a multimodal main model handles images itself (no extra swap)");
assert.equal(pick("embedding")[0],"bge-m3:latest");

// a separate general model wins chat but never planning
const sep=ollamaTaskModels(JSON.stringify({...plan,general:"gemma4:e4b",fast:"gemma4:e4b"}),"qwen3.5:9b","qwen3.5:9b");
const g=sep.find(m=>m.id==="gemma4:e4b")!;
assert.deepEqual(g.capabilities.sort(),["chat"],"general+fast on one model must not take over planning");
assert.equal(g.priority,0);

process.env.LAYANX_OLLAMA_ROUTING="single";
const single=configureProviders(loadProviderConfig(env as NodeJS.ProcessEnv)).models.list().filter(m=>m.provider==="ollama").map(m=>m.id);
assert.deepEqual(single,["qwen3.5:9b"],"single mode keeps one model (fewest swaps)");
delete process.env.LAYANX_OLLAMA_ROUTING;
assert.deepEqual(ollamaTaskModels("not json","a","b"),[]);

// thinking off for listed thinking models, per-model context sizes
assert.equal(ollamaThinkingOff("qwen3.5:9b",{LAYANX_OLLAMA_THINKING_MODELS:"qwen3.5:9b,qwen3.5:4b"}),true);
assert.equal(ollamaThinkingOff("qwen2.5-coder:7b",{LAYANX_OLLAMA_THINKING_MODELS:"qwen3.5:9b"}),false);
assert.equal(ollamaThinkingOff("qwen3.5:9b",{LAYANX_OLLAMA_THINKING_MODELS:"qwen3.5:9b",LAYANX_OLLAMA_THINK:"on"}),false);
assert.equal(ollamaNumCtx("qwen3.5:4b",{LAYANX_OLLAMA_CONTEXT:'{"qwen3.5:4b":16384}'}),16384);
assert.equal(ollamaNumCtx("other",{LAYANX_OLLAMA_CONTEXT:'{"qwen3.5:4b":16384}'}),8192);

// local Whisper: OpenAI-compatible multipart, no API key, language passed through
let seen:{auth?:string;body:string}={body:""};
const stt=http.createServer((req,res)=>{let b="";req.setEncoding("latin1");req.on("data",c=>b+=c);req.on("end",()=>{seen={...(req.headers.authorization?{auth:req.headers.authorization}:{}),body:b};
  res.writeHead(req.url==="/v1/audio/transcriptions"?200:404,{"content-type":"application/json"});res.end(JSON.stringify({text:" جارفيس كم الساعة "}));});});
await new Promise<void>(r=>stt.listen(0,"127.0.0.1",()=>r()));
try{
  const url=`http://127.0.0.1:${(stt.address() as any).port}/v1`;
  const voice=new VoiceService(undefined,new LocalTranscriber(url));
  assert.equal(voice.status().stt,"local");
  const text=await voice.transcribe(Buffer.from("RIFFfake"),"audio/wav","voice.wav","ar");
  assert.equal(text,"جارفيس كم الساعة");
  assert.equal(seen.auth,undefined,"no key is sent to the local server");
  assert.match(seen.body,/name="language"\r\n\r\nar/);
  assert.match(seen.body,/name="response_format"\r\n\r\njson/);
  await voice.transcribe(Buffer.from("x"),"audio/wav","v.wav","auto");
  assert.doesNotMatch(seen.body,/name="language"/,"auto lets Whisper detect the language");
  assert.equal(new VoiceService(undefined,null).status().stt,process.env.OPENAI_API_KEY?"openai":"none");
}finally{stt.close();}

console.log("local-model-routing: all assertions passed");
