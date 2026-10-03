import type { MarketCandle } from "./scalping-signal.js";
import { inspectCandleQuality } from "./candle-quality.js";

export interface WalkForwardWindow {
  index: number;
  train: MarketCandle[];
  test: MarketCandle[];
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
}

export interface WalkForwardWindowSummary {
  windows: number;
  testOverlap: boolean;
  testOverlapCandles: number;
  testCoveredCandles: number;
}

export function summarizeWalkForwardWindows(
  windows: WalkForwardWindow[],
): WalkForwardWindowSummary {
  const seen = new Set<string>();
  let totalTestCandles = 0;
  let duplicateTestCandles = 0;

  for (const window of windows) {
    for (const candle of window.test) {
      if (seen.has(candle.timestamp)) duplicateTestCandles += 1;
      else seen.add(candle.timestamp);
      totalTestCandles += 1;
    }
  }

  return {
    windows: windows.length,
    testOverlap: duplicateTestCandles > 0,
    testOverlapCandles: duplicateTestCandles,
    testCoveredCandles: seen.size,
  };
}

export function createWalkForwardWindows(
  candles: MarketCandle[],
  trainSize: number,
  testSize: number,
  stepSize = testSize,
): WalkForwardWindow[] {
  if (trainSize < 31 || testSize < 31 || stepSize < 1) {
    throw new Error("trainSize and testSize must be at least 31; stepSize must be positive.");
  }
  if (candles.length < trainSize + testSize) {
    throw new Error("Not enough candles for one walk-forward window.");
  }

  const quality = inspectCandleQuality(candles);
  if (!quality.valid) throw new Error("Candle data quality validation failed.");

  const windows: WalkForwardWindow[] = [];
  for (let start = 0; start + trainSize + testSize <= candles.length; start += stepSize) {
    const train = candles.slice(start, start + trainSize);
    const test = candles.slice(start + trainSize, start + trainSize + testSize);
    windows.push({
      index: windows.length + 1,
      train,
      test,
      trainStart: train[0]!.timestamp,
      trainEnd: train[train.length - 1]!.timestamp,
      testStart: test[0]!.timestamp,
      testEnd: test[test.length - 1]!.timestamp,
    });
  }

  return windows;
}
