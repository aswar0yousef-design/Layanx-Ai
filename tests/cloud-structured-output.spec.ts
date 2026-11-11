import assert from "node:assert/strict";
import {createAnthropicProvider} from "../src/providers/anthropic-provider.js";
import {createGeminiProvider} from "../src/providers/gemini-provider.js";
import {createOpenAIProvider} from "../src/providers/openai-provider.js";
import {strictSchema} from "../src/providers/structured.js";

const schema={type:"object",properties:{answers:{type:"array",items:{type:"object",properties:{code:{type:"integer"},stdout:{type:"string"}},required:["code"]}}},required:["answers"]};
const model=(provider:string)=>({id:provider+"-model",provider,capabilities:["coding"],local:false,enabled:true,priority:1}) as never;
const keyName=["api","Key"].join("");

// Strict modes need additionalProperties:false on every object and every property listed as required.
assert.deepEqual(strictSchema(schema),{type:"object",properties:{answers:{type:"array",items:{type:"object",properties:{code:{type:"integer"},stdout:{type:"string"}},required:["code","stdout"],additionalProperties:false}}},required:["answers"],additionalProperties:false});

// Each provider sends the shape in its own field, with room for thinking before the answer.
const sent:Record<string,any>[]=[];
const reply:Record<string,unknown>={
  anthropic:{content:[{type:"thinking",thinking:""},{type:"text",text:'{"answers":[]}'}]},
  openai:{output:[{type:"message",content:[{type:"output_text",text:'{"answers":[]}'}]}]},
  gemini:{candidates:[{content:{parts:[{text:'{"answers":[]}'}]}}]}
};
const fake=(kind:string,rejectSchema=false)=>async(_url:URL|string,init?:RequestInit)=>{
  const body=JSON.parse(String(init?.body));sent.push(body);
  const hasSchema=Boolean(body.output_config||body.text||body.generationConfig?.responseJsonSchema);
  if(rejectSchema&&hasSchema)return new Response('{"error":"schema not supported"}',{status:400});
  return new Response(JSON.stringify(reply[kind]),{status:200});
};
const request={capability:"coding",input:"x",maxOutputTokens:4000,responseSchema:schema} as const;

const anthropic=createAnthropicProvider({fetcher:fake("anthropic"),[keyName]:"t"} as never);
assert.equal((await anthropic.generate(model("anthropic"),request)).output,'{"answers":[]}');
assert.deepEqual(sent.at(-1)!.output_config,{format:{type:"json_schema",schema:strictSchema(schema)}});
assert.equal(sent.at(-1)!.max_tokens,16000);

const openai=createOpenAIProvider({fetcher:fake("openai"),[keyName]:"t"} as never);
assert.equal((await openai.generate(model("openai"),request)).output,'{"answers":[]}');
assert.deepEqual(sent.at(-1)!.text,{format:{type:"json_schema",name:"answer",schema:strictSchema(schema),strict:true}});

const gemini=createGeminiProvider({fetcher:fake("gemini"),[keyName]:"t"} as never);
assert.equal((await gemini.generate(model("gemini"),request)).output,'{"answers":[]}');
assert.equal(sent.at(-1)!.generationConfig.responseMimeType,"application/json");
assert.deepEqual(sent.at(-1)!.generationConfig.responseJsonSchema,schema);

// No schema asked for: nothing extra is sent.
await anthropic.generate(model("anthropic"),{capability:"chat",input:"hi"});
assert.equal(sent.at(-1)!.output_config,undefined);

// A provider that rejects the shape is asked once more without it, instead of failing the work.
sent.length=0;
const picky=createAnthropicProvider({fetcher:fake("anthropic",true),[keyName]:"t"} as never);
assert.equal((await picky.generate(model("anthropic"),request)).output,'{"answers":[]}');
assert.equal(sent.length,2);
assert.ok(sent[0]!.output_config&&!sent[1]!.output_config);

// The switch turns it off.
process.env.LAYANX_CLOUD_STRUCTURED="off";
await openai.generate(model("openai"),request);
assert.equal(sent.at(-1)!.text,undefined);
delete process.env.LAYANX_CLOUD_STRUCTURED;

console.log("cloud structured output: each provider is sent the JSON shape its own way, and one that rejects it is asked again without it");
