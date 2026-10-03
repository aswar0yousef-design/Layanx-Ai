import assert from "node:assert/strict";
import { runPaperScalping } from "../src/trading/paper-scalping.js";

const candles = Array.from({ length: 35 }, (_, i) => {
  const close = 2000 + i * 0.2;
  return {
    timestamp: new Date(Date.UTC(2026, 9, 3, 12, i)).toISOString(),
    open: close,
    high: close + 0.3,
    low: close - 0.2,
    close,
  };
});

assert.throws(
  () => runPaperScalping(candles, {
    symbol: "XAUUSD",
    timeframe: "M1",
    initialBalance: 1000,
    riskPercent: 1,
    stopLossDistance: 1,
    spread: 0.1,
    brokerSymbol: {
      broker: "CFI",
      accountType: "CFI2-Real",
      symbol: "EURUSD",
      volumeMin: 0.01,
      volumeStep: 0.01,
      tickSize: 0.00001,
      tickValue: 1,
    },
  }),
  /does not match/,
);

console.log("Paper broker specification validation tests passed");
