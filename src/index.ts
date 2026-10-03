import {LayanXCore} from "./core/orchestrator.js";
import {PAPER_TRADING_TOOL,BINANCE_MARKET_DATA_TOOL} from "./trading/agent-integration.js";
import type {AgentContract} from "./core/contracts.js";
const core=new LayanXCore();
const systemAgent:AgentContract={
 agentId:"core",
 purpose:"Safely orchestrate LayanX missions.",
 allowedTools:[PAPER_TRADING_TOOL,BINANCE_MARKET_DATA_TOOL],
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
core.registerAgent({
 agentId:"trading-executor",
 purpose:"Execute explicitly approved Binance Spot orders under LayanX runtime controls.",
 allowedTools:["trading.binance.order"],
 forbiddenResources:["secrets","security-controls"],
 requiredPermission:"L4_EXECUTE",
 maxToolCalls:20,
 maxRuntimeMs:30000,
 successCriteria:["approved execution request handled","execution auditable"],
 stopCondition:"Stop on approval denial, Sentinel block, risk limit, or broker error.",
 profile:{role:"analyst",description:"Dedicated execution agent; never bypasses LayanX approval or risk controls.",preferredCapabilities:["reasoning"],memoryTags:["trading","execution","binance"]}
});
const mission=core.startMission("Bootstrap LayanX AI foundation");
console.log(JSON.stringify({system:"LayanX AI",status:"foundation-ready",mission,verification:core.verifier.verify(mission)},null,2));
