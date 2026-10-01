import {LayanXCore} from "../src/core/orchestrator.js";

const core=new LayanXCore();
core.registerAgent({
  agentId:"core",
  purpose:"tool discovery",
  allowedTools:["runtime.status","mission.inspect","memory.recall"],
  forbiddenResources:["secrets"],
  requiredPermission:"L1_READ",
  maxToolCalls:10,
  maxRuntimeMs:10000,
  successCriteria:["done"],
  stopCondition:"stop"
});
core.tools.register({
  name:"dangerous.write",
  description:"modify files",
  permission:"L3_MODIFY",
  dangerous:true,
  actions:["write file","modify file"],
  tags:["file","write","modify"]
});
core.tools.register({
  name:"reader",
  description:"read a file",
  permission:"L1_READ",
  dangerous:false,
  actions:["read file"],
  tags:["file","read"]
});

const discovered=core.discoverTools("read file", "L1_READ");
if(discovered.length!==1||discovered[0].name!=="reader")throw new Error("discovery did not rank the matching safe tool");
if("adapter" in discovered[0]||"execute" in discovered[0])throw new Error("discovery leaked runtime adapter details");

const blocked=core.discoverTools("write file", "L1_READ");
if(blocked.length!==0)throw new Error("permission filtering allowed a higher-risk tool");

const builtins=new LayanXCore();
builtins.registerAgent({
  agentId:"core",purpose:"builtins",
  allowedTools:["runtime.status","mission.inspect","memory.recall"],
  forbiddenResources:["secrets"],requiredPermission:"L1_READ",
  maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"
});
builtins.tools.register({
  name:"runtime.status",description:"read runtime status",permission:"L1_READ",dangerous:false,
  actions:["read runtime status"],tags:["runtime","status"]
});
builtins.tools.register({
  name:"mission.inspect",description:"inspect mission",permission:"L1_READ",dangerous:false,
  actions:["inspect mission"],tags:["mission"]
});
const runtime=builtins.discoverTools("read runtime status","L1_READ");
if(runtime[0]?.name!=="runtime.status")throw new Error("runtime status was not dynamically selected");

console.log("Tool catalog and discovery tests passed.");
