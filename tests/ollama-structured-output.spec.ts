import assert from "node:assert/strict";
import {AiMissionPlanner,missionPlanSchema,nextToolSchema} from "../src/core/ai-planner.js";
import {createOllamaProvider,ollamaFormat} from "../src/providers/ollama-provider.js";

const catalog=[
 {name:"files.write",description:"write",permission:"L3_MODIFY",dangerous:false,actions:["write file"],tags:[]},
 {name:"project.verify",description:"verify",permission:"L4_EXECUTE",dangerous:true,actions:["verify project"],tags:[]}
] as any;

// 1. The planner hands a schema to the model that only allows real tool/action/permission triples.
const seen:any[]=[];
const plan={risk:"medium",requiredPermission:"L4_EXECUTE",steps:[{description:"Write the page"}],successCriteria:["done"],stopCondition:"stop",tools:[{tool:"files.write",action:"write file",permission:"L3_MODIFY",reason:"page"}]};
const planner=new AiMissionPlanner({async execute(request:any){seen.push(request);return{modelId:"m",provider:"ollama",output:JSON.stringify(seen.length===1?plan:null),attempts:[]};}} as any);
await planner.plan("create the landing page file",catalog);
const schema=seen[0].responseSchema;
assert.ok(schema,"plan request carries a responseSchema");
assert.deepEqual(schema.required,["risk","requiredPermission","steps","successCriteria","stopCondition","tools"]);
const branches=schema.properties.tools.items.anyOf;
assert.deepEqual(branches.map((b:any)=>b.properties.tool.enum[0]).sort(),["files.write","project.verify"]);
assert.deepEqual(branches.find((b:any)=>b.properties.tool.enum[0]==="project.verify").properties.permission.enum,["L4_EXECUTE"]);
const next=await planner.nextTool({goal:"create the landing page file",result:{},tools:catalog,requiredPermission:"L4_EXECUTE",completedTools:[]});
assert.equal(next,null);
assert.equal(seen[1].responseSchema.anyOf[0].type,"null","adaptive planner may answer null");
assert.equal(nextToolSchema([]).anyOf.length,2);
assert.equal(missionPlanSchema([]).properties.tools.items.type,"object");

// 2. Ollama receives the schema in `format`; LAYANX_OLLAMA_STRUCTURED=off keeps plain JSON mode.
assert.deepEqual(ollamaFormat({capability:"reasoning",input:"x",responseSchema:{type:"object"}},{}),{format:{type:"object"}});
assert.deepEqual(ollamaFormat({capability:"reasoning",input:"x",responseSchema:{type:"object"}},{LAYANX_OLLAMA_STRUCTURED:"off"}),{format:"json"});
assert.deepEqual(ollamaFormat({capability:"text",input:"x"} as any,{}),{});

// 3. An Ollama build that rejects the schema gets one retry in plain JSON mode.
const bodies:any[]=[];
const fetcher=(async(_url:string,init:any)=>{
 const body=JSON.parse(init.body);bodies.push(body);
 if(typeof body.format==="object")return new Response("invalid JSON schema in format",{status:500});
 return new Response(JSON.stringify({message:{content:"{\"ok\":true}"}}),{status:200});
}) as unknown as typeof fetch;
const provider=createOllamaProvider({fetcher});
const result=await provider.generate({id:"qwen3.5:4b"} as any,{capability:"reasoning",input:"plan",responseSchema:{type:"object"}});
assert.equal(result.output,"{\"ok\":true}");
assert.equal(typeof bodies[0].format,"object");
assert.equal(bodies[1].format,"json");
assert.equal(bodies.length,2);
console.log("ollama-structured-output: planner schemas, format wiring and plain-JSON retry");
