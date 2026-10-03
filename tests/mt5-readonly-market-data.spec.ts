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
    return { symbol, bid: 2000.1, ask: 2000.3, timestamp: new Date(Date.parse(candles.at(-1)!.timestamp) + 60_000).toISOString() };
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
assert.equal(result.excludedFormingCandle, false);
assert.equal(result.specification.symbol, "XAUUSD");

await assert.rejects(
  () => readMt5MarketData(transport, "XAGUSD", "M1", 35),
  /specification does not match/,
);

const invalidChronologyTransport: Mt5ReadOnlyTransport = {
  ...transport,
  async getCandles() {
    return [candles[1], candles[0], ...candles.slice(2)];
  },
};
await assert.rejects(
  () => readMt5MarketData(invalidChronologyTransport, "XAUUSD", "M1", 35),
  /strictly chronological/,
);

const invalidSnapshotTransport: Mt5ReadOnlyTransport = {
  ...transport,
  async getSymbolSnapshot(symbol) {
    return { symbol, bid: 2000.3, ask: 2000.1, timestamp: candles.at(-1)!.timestamp };
  },
};
await assert.rejects(
  () => readMt5MarketData(invalidSnapshotTransport, "XAUUSD", "M1", 35),
  /ask cannot be below bid/,
);

console.log("MT5 read-only market data tests passed");


const formingCandles = [...candles, {
  timestamp: new Date(Date.parse(candles.at(-1)!.timestamp) + 60_000).toISOString(),
  open: 2004,
  high: 2004.4,
  low: 2003.9,
  close: 2004.2,
}];
const formingTransport: Mt5ReadOnlyTransport = {
  ...transport,
  async getCandles() { return formingCandles; },
  async getSymbolSnapshot(symbol) {
    return { symbol, bid: 2004.1, ask: 2004.3, timestamp: new Date(Date.parse(candles.at(-1)!.timestamp) + 90_000).toISOString() };
  },
};
const formingResult = await readMt5MarketData(formingTransport, "XAUUSD", "M1", 36);
assert.equal(formingResult.candles.length, 35);
assert.equal(formingResult.excludedFormingCandle, true);
