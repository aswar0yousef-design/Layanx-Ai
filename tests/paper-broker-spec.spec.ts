import assert from "node:assert/strict";
import { runPaperScalping } from "../src/trading/paper-scalping.js";

const candles = Array.from({ length: 45 }, (_, i) => {
  const close = 2000 + i * 0.5;
  return {
    timestamp: new Date(Date.UTC(2026, 9, 3, 11, i)).toISOString(),
    open: close - 0.05,
    high: close + 0.7,
    low: close - 0.2,
    close,
  };
});

const result = runPaperScalping(candles, {
  symbol: "XAUUSD",
  timeframe: "M1",
  initialBalance: 1000,
  riskPercent: 1,
  stopLossDistance: 1,
  takeProfitDistance: 0.5,
  spread: 0.2,
  slippage: 0.05,
  signalConfig:{minimumScore:1},
  brokerSymbol: {
    broker: "CFI",
    accountType: "CFI2-Real",
    symbol: "XAUUSD",
    volumeMin: 0.01,
    volumeStep: 0.01,
    volumeMax: 50,
    tickSize: 0.01,
    tickValue: 1,
    commissionPerUnit: 0.02,
    swapLongPerUnit: -0.01,
    swapShortPerUnit: -0.02,
  },
});

assert.ok(result.trades.length > 0);
const analysis = result.analyses[0];
assert.ok(analysis);
assert.equal(analysis.commission, result.trades[0].quantity * 0.02);
assert.ok(analysis.trueNetPnl <= analysis.netPnlAfterExecutionCosts);

console.log("Paper broker specification tests passed");
