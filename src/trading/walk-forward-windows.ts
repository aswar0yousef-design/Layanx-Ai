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
  if (windows.length < 2) {
    return {
      windows: windows.length,
      testOverlap: false,
      testOverlapCandles: 0,
      testCoveredCandles: windows[0]?.test.length ?? 0,
    };
  }

  const testIntervals = windows.map(window => ({
    start: Date.parse(window.testStart),
    end: Date.parse(window.testEnd),
    length: window.test.length,
  })).sort((a, b) => a.start - b.start);

  let overlapCandles = 0;
  let coveredCandles = 0;
  let previousEnd = Number.NaN;

  for (const interval of testIntervals) {
    if (Number.isNaN(interval.start) || Number.isNaN(interval.end)) {
      throw new Error("Invalid walk-forward test timestamp.");
    }
    const overlap = Number.isFinite(previousEnd) && interval.start <= previousEnd;
    if (overlap) overlapCandles += Math.min(interval.length, 1);
    coveredCandles += interval.length;
    previousEnd = Math.max(previousEnd, interval.end);
  }

  return {
    windows: windows.length,
    testOverlap: overlapCandles > 0,
    testOverlapCandles: overlapCandles,
    testCoveredCandles: coveredCandles - overlapCandles,
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
      trainStart: train[0].timestamp,
      trainEnd: train[train.length - 1].timestamp,
      testStart: test[0].timestamp,
      testEnd: test[test.length - 1].timestamp,
    });
  }

  return windows;
}
