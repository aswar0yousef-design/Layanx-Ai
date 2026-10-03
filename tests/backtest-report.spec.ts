import assert from "node:assert/strict";
import { buildBacktestReport } from "../src/trading/backtest-report.js";

const report = buildBacktestReport(1000, [
  {
    id: "1",
    symbol: "XAUUSD",
    side: "long",
    quantity: 1,
    entry: { fillPrice: 100 },
    exit: { fillPrice: 101 },
    openedAt: "2026-10-03T08:00:00Z",
    closedAt: "2026-10-03T08:01:00Z",
    strategy: "paper-scalping",
    timeframe: "M1",
    session: "London",
    commission: 0.1,
    swap: 0,
    grossPnl: 1,
    executionCost: 0.05,
    executionCostPct: 5,
    netPnlAfterExecutionCosts: 0.95,
    trueNetPnl: 0.85,
    executionQuality: "excellent",
    warnings: [],
  },
  {
    id: "2",
    symbol: "XAUUSD",
    side: "long",
    quantity: 1,
    entry: { fillPrice: 101 },
    exit: { fillPrice: 100.5 },
    openedAt: "2026-10-03T08:02:00Z",
    closedAt: "2026-10-03T08:03:00Z",
    strategy: "paper-scalping",
    timeframe: "M1",
    session: "London",
    commission: 0.1,
    swap: 0,
    grossPnl: -0.5,
    executionCost: 0.05,
    executionCostPct: 10,
    netPnlAfterExecutionCosts: -0.55,
    trueNetPnl: -0.65,
    executionQuality: "good",
    warnings: [],
  },
]);

assert.equal(report.trades, 2);
assert.equal(report.wins, 1);
assert.equal(report.losses, 1);
assert.equal(report.netPnl, 0.2);
assert.equal(report.returnPct, 0.02);
assert.equal(report.maxDrawdown, 0.65);
assert.equal(report.costErasedTrades, 0);
assert.equal(report.commissions, 0.2);
assert.equal(report.executionCosts, 0.1);
assert.equal(report.intrabarAmbiguousExits, 0);
assert.equal(report.gapThroughExits, 0);

console.log("Backtest report tests passed");
