import {ModelRegistry} from "../src/models/registry.js";
import {ModelRouter} from "../src/core/model-router.js";

const models=new ModelRegistry();
models.register({id:"cloud-reasoning",provider:"cloud",capabilities:["reasoning"],local:false,enabled:true,priority:2,qualityScore:90,costPer1kInputUsd:0.01,costPer1kOutputUsd:0.03,latencyClass:"slow",tags:["reasoning","quality"]});
models.register({id:"local-fast",provider:"ollama",capabilities:["reasoning"],local:true,enabled:true,priority:1,qualityScore:70,costPer1kInputUsd:0,costPer1kOutputUsd:0,latencyClass:"fast",tags:["local","fast"]});
models.register({id:"cloud-fast-priority",provider:"cloud",capabilities:["reasoning"],local:false,enabled:true,priority:0,qualityScore:5,costPer1kInputUsd:0.02,costPer1kOutputUsd:0.02,latencyClass:"slow",tags:["cloud-only"]});
models.register({id:"disabled",provider:"disabled",capabilities:["reasoning"],local:true,enabled:false,priority:0});

const router=new ModelRouter(models);
if(router.select("reasoning",{preferLocal:true}).id!=="local-fast")throw new Error("Local preference routing failed even when a cloud model has a numerically better priority.");
if(router.select("reasoning",{preferLocal:true,preferredModelId:"cloud-reasoning"}).id!=="local-fast")throw new Error("A preferred cloud model must not bypass local-first routing.");
if(router.select("reasoning",{preferLocal:true,preferredModelId:"local-fast"}).id!=="local-fast")throw new Error("Preferred local model selection failed.");
if(router.select("reasoning",{preferLocal:false}).local)throw new Error("Cloud preference routing failed.");
if(router.select("reasoning",{latencySensitive:true}).id!=="local-fast")throw new Error("Latency-sensitive routing failed.");
if(router.select("reasoning",{minQualityScore:85}).id!=="cloud-reasoning")throw new Error("Quality constraint routing failed.");
if(router.select("reasoning",{maxCostUsd:0}).id!=="local-fast")throw new Error("Cost constraint routing failed.");
if(router.select("reasoning",{tags:["quality"]}).id!=="cloud-reasoning")throw new Error("Tag-aware routing failed.");
console.log("Model routing policy tests passed.");