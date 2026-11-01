import {strict as assert} from "node:assert";
import {UnifiedModelCouncil} from "../src/core/unified-model-council.js";
import {ModelRegistry} from "../src/models/registry.js";
import {ModelProviderRegistry,ModelExecutionRouter} from "../src/core/model-execution.js";
const models=new ModelRegistry(),providers=new ModelProviderRegistry();
for(const [id,provider] of [["coder","anthropic"],["reviewer","gemini"],["final","openai"]] as const){
  models.register({id,provider,capabilities:["coding","reasoning"],local:false,enabled:true,priority:1});
  providers.register({name:provider,health:async()=>({provider,available:true,updatedAt:"2026-11-01"}),generate:async(model,request)=>({modelId:model.id,provider,output:id==="final"?"One unified result":String(request.input).slice(0,80)})});
}
const council=new UnifiedModelCouncil(new ModelExecutionRouter(models,providers));
const result=await council.execute({capability:"coding",input:"Build an app"},{specialists:[{provider:"anthropic",modelId:"coder",role:"implement"},{provider:"gemini",modelId:"reviewer",role:"review"}],synthesizer:{provider:"openai",modelId:"final"}});
assert.equal(result.output,"One unified result");
assert.equal(result.status,"complete");
assert.equal(result.sources.length,2);
await assert.rejects(()=>council.execute({capability:"coding",input:"x"},{specialists:[{provider:"anthropic",modelId:"coder",role:"a"},{provider:"anthropic",modelId:"coder",role:"b"}],synthesizer:{provider:"openai",modelId:"final"}}),/one specialist per provider/);
console.log("unified-model-council: PASS");
