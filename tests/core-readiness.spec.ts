import {LayanXCore} from "../src/core/orchestrator.js";

const core=new LayanXCore();
if(core.isReady())throw new Error("Core reported ready before its runtime agent was registered.");

core.registerAgent({
  agentId:"readiness-test",
  purpose:"Verify runtime readiness.",
  allowedTools:[],
  forbiddenResources:["secrets","security-controls"],
  requiredPermission:"L1_READ",
  maxToolCalls:1,
  maxRuntimeMs:5000,
  successCriteria:["runtime ready"],
  stopCondition:"Stop after readiness verification."
});

if(!core.isReady())throw new Error("Core did not report ready after required runtime initialization.");
console.log("Core readiness contract passed.");
