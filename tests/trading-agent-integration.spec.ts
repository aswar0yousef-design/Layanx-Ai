import assert from "node:assert/strict";
import { LayanXCore } from "../src/core/orchestrator.js";
import {
  LIVE_TRADING_TOOLS,
  PAPER_TRADING_TOOL,
  registerPaperTradingAgentTool,
} from "../src/trading/agent-integration.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { ToolAdapterRegistry } from "../src/tools/adapters.js";

{
  const core = new LayanXCore();
  const definition = core.tools.get(PAPER_TRADING_TOOL);
  assert.equal(definition.permission, "L2_ANALYZE");
  assert.equal(definition.dangerous, false);
  assert.equal(core.toolAdapters.has(PAPER_TRADING_TOOL), true);
}

{
  const tools = new ToolRegistry();
  const adapters = new ToolAdapterRegistry();
  registerPaperTradingAgentTool(tools, adapters);
  registerPaperTradingAgentTool(tools, adapters);
  assert.equal(tools.list().filter(tool => tool.name === PAPER_TRADING_TOOL).length, 1);
  assert.deepEqual(LIVE_TRADING_TOOLS, []);
  assert.equal(
    tools.list().some(tool => /binance|live|broker|real.?money/i.test(tool.name)),
    false,
  );
}

console.log("trading-agent-integration: ok");
