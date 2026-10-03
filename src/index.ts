import {LayanXCore} from "./core/orchestrator.js";
import {PAPER_TRADING_TOOL} from "./trading/agent-integration.js";
import type {AgentContract} from "./core/contracts.js";
const core=new LayanXCore();
const systemAgent:AgentContract={
 agentId:"core",
 purpose:"Safely orchestrate LayanX missions.",
 allowedTools:[PAPER_TRADING_TOOL],
 forbiddenResources:["secrets","security-controls"],
 requiredPermission:"L1_READ",
 maxToolCalls:100,
 maxRuntimeMs:30000,
 successCriteria:["mission created","execution auditable"],
 stopCondition:"Stop on policy denial or Sentinel block.",
 profile:{
  role:"orchestrator",
  description:"Coordinates missions and keeps bootstrap execution within LayanX policy.",
  preferredCapabilities:["reasoning","chat"],
  memoryTags:["orchestration","bootstrap"]
 }
};
core.registerAgent(systemAgent);
const mission=core.startMission("Bootstrap LayanX AI foundation");
console.log(JSON.stringify({system:"LayanX AI",status:"foundation-ready",mission,verification:core.verifier.verify(mission)},null,2));
