import {AgentManager} from "../src/core/agent-manager.js";
import {ModelRegistry} from "../src/models/registry.js";
import {ModelRouter} from "../src/core/model-router.js";
import {TaskRouter} from "../src/core/task-router.js";

const agents=new AgentManager();
agents.register({agentId:"researcher",purpose:"research",allowedTools:[],forbiddenResources:[],requiredPermission:"L2_ANALYZE",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["analysis"],stopCondition:"stop",profile:{role:"researcher",description:"Research",preferredCapabilities:["embedding"],memoryTags:["research"]}});
agents.register({agentId:"developer",purpose:"development",allowedTools:[],forbiddenResources:[],requiredPermission:"L3_MODIFY",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["code"],stopCondition:"stop",profile:{role:"developer",description:"Developer",preferredCapabilities:["coding"],memoryTags:["code"]}});

const models=new ModelRegistry();
models.register({id:"local-code",provider:"ollama",capabilities:["coding"],local:true,enabled:true,priority:1,qualityScore:75,tags:["coding","developer"]});
models.register({id:"cloud-reasoning",provider:"openai",capabilities:["reasoning"],local:false,enabled:true,priority:1,qualityScore:90,tags:["reasoning","orchestrator"]});
models.register({id:"local-embedding",provider:"ollama",capabilities:["embedding"],local:true,enabled:true,priority:1,tags:["embedding","researcher"]});

const router=new TaskRouter(agents,new ModelRouter(models));
const result=router.assign({goal:"build and research",tasks:[
{id:"research",description:"Research",capability:"embedding",permission:"L2_ANALYZE",dependencies:[],successCriteria:["analysis"]},
{id:"code",description:"Implement",capability:"coding",permission:"L3_MODIFY",dependencies:["research"],successCriteria:["code"]}
]});
if(result[0]?.agentId!=="researcher"||result[0]?.modelId!=="local-embedding")throw new Error("Research routing failed.");
if(result[1]?.agentId!=="developer"||result[1]?.modelId!=="local-code")throw new Error("Developer routing failed.");

const restricted=new AgentManager();
restricted.register({agentId:"read-only",purpose:"read",allowedTools:[],forbiddenResources:[],requiredPermission:"L1_READ",maxToolCalls:5,maxRuntimeMs:1000,successCriteria:["read"],stopCondition:"stop"});
try{new TaskRouter(restricted,new ModelRouter(models)).assign({goal:"modify",tasks:[{id:"modify",description:"Modify",capability:"coding",permission:"L3_MODIFY",dependencies:[],successCriteria:["done"]}]});throw new Error("Expected permission routing rejection.");}
catch(error){if(!(error instanceof Error)||!error.message.includes("sufficient permission"))throw error;}
console.log("Task-to-agent/model routing tests passed.");