import {LayanXCore} from "../src/core/orchestrator.js";
import {AiMissionPlanner} from "../src/core/ai-planner.js";
const core=new LayanXCore();
core.registerAgent({agentId:"core",purpose:"test",allowedTools:["runtime.status"],forbiddenResources:["secrets"],requiredPermission:"L1_READ",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"});
core.tools.register({name:"runtime.status",description:"read runtime status",permission:"L1_READ",dangerous:false,actions:["read runtime status"],tags:["runtime"]});
const catalog=core.toolCatalog.list(core.agents.get("core"),"L1_READ");
const model={async execute(){return {modelId:"fake",provider:"fake",output:JSON.stringify({risk:"low",requiredPermission:"L1_READ",steps:[{description:"Read runtime status"}],successCriteria:["done"],stopCondition:"stop",tools:[{tool:"runtime.status",action:"read runtime status",permission:"L2_ANALYZE",reason:"over-privileged"}]}) ,attempts:[]};}} as never;
const planner=new AiMissionPlanner(model);
let rejected=false;
try{await planner.plan("Read runtime status",catalog);}catch(error){rejected=error instanceof Error&&error.message.includes("must match the tool requirement");}
if(!rejected)throw new Error("planner accepted elevated tool permission");
console.log("Planner permission hardening passed.");
