import {LayanXCore} from "../src/core/orchestrator.js";
import {runtimeHealth} from "../src/runtime.js";
import type {ModelProviderAdapter} from "../src/models/inference.js";

const core=new LayanXCore();
core.registerAgent({
  agentId:"health-test-agent",
  purpose:"health test",
  allowedTools:[],
  forbiddenResources:[],
  requiredPermission:"L1_READ",
  maxToolCalls:1,
  maxRuntimeMs:1000,
  successCriteria:["ok"],
  stopCondition:"stop"
});

const provider:ModelProviderAdapter={
  name:"health-test",
  async health(){return{provider:"health-test",available:true,latencyMs:7,updatedAt:"2026-10-01T00:00:00.000Z"};},
  async generate(){return{provider:"health-test",modelId:"health-test-model",output:"ok"};}
};
core.providers.register(provider);

const health=await runtimeHealth({core,providers:core.providers} as ReturnType<typeof createRuntimeHealthFixture>);
if(!health.ready)throw new Error("Health runtime should be ready.");
if(!health.healthy)throw new Error("Healthy provider was reported unhealthy.");
if(health.providers.length!==1||health.providers[0].provider!=="health-test")throw new Error("Provider health result is incorrect.");
if(health.providers[0].latencyMs!==7)throw new Error("Provider latency was not preserved.");

console.log("Provider health CLI runtime test passed.");

type createRuntimeHealthFixture={core:LayanXCore;providers:typeof core.providers};
