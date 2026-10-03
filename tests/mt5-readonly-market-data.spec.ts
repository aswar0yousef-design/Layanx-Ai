import assert from "node:assert/strict";
import { readMt5MarketData, type Mt5ReadOnlyTransport } from "../src/trading/mt5-readonly-market-data.js";

const candles = Array.from({ length: 35 }, (_, i) => ({
  timestamp: new Date(Date.UTC(2026, 9, 3, 13, i)).toISOString(),
  open: 2000 + i * 0.1,
  high: 2000.3 + i * 0.1,
  low: 1999.9 + i * 0.1,
  close: 2000.2 + i * 0.1,
}));

const transport: Mt5ReadOnlyTransport = {
  async getSymbolSnapshot(symbol) {
    return { symbol, bid: 2000.1, ask: 2000.3, timestamp: candles.at(-1)!.timestamp };
  },
  async getCandles() {
    return candles;
  },
  async getSymbolSpecification(symbol) {
    return {
      broker: "CFI",
      accountType: "CFI2-Real",
      symbol,
      volumeMin: 0.01,
      volumeStep: 0.01,
      volumeMax: 50,
      tickSize: 0.01,
      tickValue: 1,
    };
  },
};

const result = await readMt5MarketData(transport, "XAUUSD", "M1", 35);
assert.equal(result.snapshot.symbol, "XAUUSD");
assert.equal(result.candles.length, 35);
assert.equal(result.specification.symbol, "XAUUSD");

await assert.rejects(
  () => readMt5MarketData(transport, "XAGUSD", "M1", 35),
  /specification does not match/,
);

console.log("MT5 read-only market data tests passed");
