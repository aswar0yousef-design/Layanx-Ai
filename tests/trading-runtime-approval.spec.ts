import assert from "node:assert/strict";
import { LayanXCore } from "../src/core/orchestrator.js";
import { registerBinanceLiveOrderTool, BINANCE_LIVE_ORDER_TOOL } from "../src/trading/agent-integration.js";
import type { AgentContract } from "../src/core/contracts.js";
import type { Mission } from "../src/core/types.js";

const core = new LayanXCore();
const agent: AgentContract = {
  agentId: "trading-executor-test",
  purpose: "Test controlled trading execution approval.",
  allowedTools: [BINANCE_LIVE_ORDER_TOOL],
  forbiddenResources: ["secrets", "security-controls"],
  requiredPermission: "L4_EXECUTE",
  maxToolCalls: 5,
  maxRuntimeMs: 30000,
  successCriteria: ["execution auditable"],
  stopCondition: "Stop on approval denial.",
  profile: {
    role: "analyst",
    description: "Test execution agent.",
    preferredCapabilities: ["reasoning"],
    memoryTags: ["trading", "test"],
  },
};
core.registerAgent(agent);

const mission = core.startMission("Controlled Binance execution approval test") as Mission;
mission.projectId = "default";
mission.requiredPermission = "L4_EXECUTE";
mission.tools = [{
  tool: BINANCE_LIVE_ORDER_TOOL,
  action: "place-order",
  permission: "L4_EXECUTE",
  reason: "Test explicit approval boundary.",
  payload: { symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 0.001 },
}];

const adapter = {
  async execute() {
    return { submitted: false, testOnly: true };
  },
};

const request = {
  missionId: mission.id,
  agentId: agent.agentId,
  projectId: "default",
  tool: BINANCE_LIVE_ORDER_TOOL,
  action: "place-order",
  permission: "L4_EXECUTE" as const,
  idempotencyKey: crypto.randomUUID(),
  payload: mission.tools[0].payload,
  planIndex: 0,
};

const capability = core.capabilities.issue({
  missionId: mission.id,
  agentId: agent.agentId,
  projectId: "default",
  resource: BINANCE_LIVE_ORDER_TOOL,
  permission: "L4_EXECUTE",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});

const first = await core.executionRuntime.run(
  mission,
  request,
  adapter,
  undefined,
  { projectId: "default", capabilityId: capability.id },
);
assert.equal(first.ok, false);
assert.equal(first.approvalId !== undefined, true);
assert.match(first.error ?? "", /approval/i);

const approvalId = first.approvalId!;
core.executionRuntime.approvals.approve(approvalId);

const second = await core.executionRuntime.run(
  mission,
  request,
  adapter,
  approvalId,
  { projectId: "default", capabilityId: capability.id },
);
assert.equal(second.ok, true);
assert.equal(second.verified, true);

console.log("trading-runtime-approval: ok");
