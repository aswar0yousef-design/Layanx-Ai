import assert from "node:assert/strict";
import { runPaperScalping } from "../src/trading/paper-scalping.js";
import type { MarketCandle } from "../src/trading/scalping-signal.js";

const candles: MarketCandle[] = Array.from({ length: 40 }, (_, i) => {
  const close = 100 + i * 0.2;
  return {
    timestamp: new Date(Date.parse("2026-10-03T08:00:00Z") + i * 60_000).toISOString(),
    open: close - 0.05,
    high: close + 0.10,
    low: close - 0.10,
    close,
  };
});

const result = runPaperScalping(candles, {
  symbol: "XAUUSD",
  timeframe: "M1",
  initialBalance: 1000,
  riskPercent: 1,
  stopLossDistance: 1,
  signalConfig:{minimumScore:1},
  spread: 0.05,
  slippage: 0.02,
});

assert.equal(result.analyses.length, result.trades.length);
for (const trade of result.trades) {
  assert.ok(trade.closedAt);
}
assert.ok(result.blockedSignals >= 0);
assert.ok(result.finalBalance > 0);

for (const trade of result.trades) {
  assert.notEqual(trade.openedAt, trade.metadata?.signalTimestamp);
  assert.ok(trade.closedAt >= trade.openedAt);
}

for (const trade of result.trades) {
  if (trade.side === "long") {
    assert.ok(trade.exit.fillPrice < trade.entry.fillPrice);
  } else {
    assert.ok(trade.exit.fillPrice > trade.entry.fillPrice);
  }
}

console.log("Paper scalping tests passed");


const quoteCandles = candles.map((candle) => ({
  ...candle,
  bidOpen: candle.open - 0.01,
  askOpen: candle.open + 0.01,
  bid: candle.close - 0.02,
  ask: candle.close + 0.02,
}));
const quotedResult = runPaperScalping(quoteCandles, {
  symbol: "XAUUSD",
  timeframe: "M1",
  initialBalance: 1000,
  riskPercent: 1,
  stopLossDistance: 1,
  spread: 0.05,
  slippage: 0.02,
});
for (const trade of quotedResult.trades) {
  assert.equal(trade.entry.spread, 0.02);
}


const forcedCloseResult = runPaperScalping(candles, {
  symbol: "XAUUSD",
  timeframe: "M1",
  initialBalance: 1000,
  riskPercent: 1,
  stopLossDistance: 1000,
  spread: 0.05,
  slippage: 0.02,
  endOfDataPolicy: "close",
});

assert.ok(forcedCloseResult.trades.some((trade) => trade.metadata?.exitReason === "end-of-data"));
assert.equal(forcedCloseResult.analyses.length, forcedCloseResult.trades.length);

const excludedResult = runPaperScalping(candles, {
  symbol: "XAUUSD",
  timeframe: "M1",
  initialBalance: 1000,
  riskPercent: 1,
  stopLossDistance: 1000,
  spread: 0.05,
  slippage: 0.02,
  endOfDataPolicy: "exclude",
});

assert.ok(excludedResult.trades.every((trade) => trade.metadata?.exitReason !== "end-of-data"));


const trailingCandles = Array.from({ length: 45 }, (_, i) => {
  const close = 100 + i * 0.25;
  return {
    timestamp: new Date(Date.parse("2026-10-03T10:00:00Z") + i * 60_000).toISOString(),
    open: close - 0.02,
    high: close + 0.50,
    low: close - 0.02,
    close,
  };
});

const trailingResult = runPaperScalping(trailingCandles, {
  symbol: "XAUUSD",
  timeframe: "M1",
  initialBalance: 1000,
  riskPercent: 1,
  stopLossDistance: 0.5,
  signalConfig:{minimumScore:1},
  spread: 0.02,
  slippage: 0,
  trailingStopDistance: 0.2,
});

assert.equal(trailingResult.analyses.length, trailingResult.trades.length);
for (const trade of trailingResult.trades) {
  assert.ok(trade.metadata?.exitReason !== undefined);
}
