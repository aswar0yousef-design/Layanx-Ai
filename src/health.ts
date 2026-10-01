import {LayanXCore} from "./core/orchestrator.js";
import {startHealthServer} from "./release/health-server.js";

const core=new LayanXCore();
core.registerAgent({
  agentId:"health",
  purpose:"Runtime health verification.",
  allowedTools:[],
  forbiddenResources:["secrets","security-controls"],
  requiredPermission:"L1_READ",
  maxToolCalls:1,
  maxRuntimeMs:5000,
  successCriteria:["runtime ready"],
  stopCondition:"Stop after readiness verification."
});

const port=Number(process.env.PORT??3000);
startHealthServer({port,readiness:()=>core.isReady()});
console.log(JSON.stringify({system:"LayanX AI",status:core.isReady()?"healthy":"unhealthy",port}));
