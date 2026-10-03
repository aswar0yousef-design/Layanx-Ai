import type { MarketCandle } from "./scalping-signal.js";

export interface CandleQualityIssue {
  type: "duplicate" | "non-monotonic" | "invalid-range" | "gap";
  index: number;
  message: string;
}

export interface CandleQualityReport {
  valid: boolean;
  candles: number;
  issues: CandleQualityIssue[];
  expectedIntervalMs?: number;
}

export function inspectCandleQuality(
  candles: MarketCandle[],
  expectedIntervalMs?: number,
): CandleQualityReport {
  const issues: CandleQualityIssue[] = [];

  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];
    if (!(candle.high >= Math.max(candle.open, candle.close) &&
      candle.low <= Math.min(candle.open, candle.close) &&
      candle.high >= candle.low)) {
      issues.push({
        type: "invalid-range",
        index: i,
        message: `Invalid OHLC range at ${candle.timestamp}`,
      });
    }

    if (i === 0) continue;

    const previous = candles[i - 1];
    const delta = Date.parse(candle.timestamp) - Date.parse(previous.timestamp);

    if (delta <= 0) {
      issues.push({
        type: delta === 0 ? "duplicate" : "non-monotonic",
        index: i,
        message: `Timestamp order violation at ${candle.timestamp}`,
      });
    } else if (expectedIntervalMs !== undefined && delta > expectedIntervalMs) {
      issues.push({
        type: "gap",
        index: i,
        message: `Candle gap of ${delta}ms before ${candle.timestamp}`,
      });
    }
  }

  return {
    valid: issues.length === 0,
    candles: candles.length,
    issues,
    expectedIntervalMs,
  };
}
