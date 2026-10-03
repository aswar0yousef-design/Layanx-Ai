import type { MarketCandle } from "./scalping-signal.js";

export interface BacktestSplit {
  train: MarketCandle[];
  test: MarketCandle[];
  trainEnd: string;
  testStart: string;
  testEnd: string;
}

export function splitChronologically(
  candles: MarketCandle[],
  trainRatio = 0.7,
): BacktestSplit {
  if (candles.length < 2) throw new Error("At least two candles are required.");
  if (!(trainRatio > 0 && trainRatio < 1)) {
    throw new Error("trainRatio must be between 0 and 1.");
  }

  const splitIndex = Math.max(1, Math.min(candles.length - 1, Math.floor(candles.length * trainRatio)));
  const train = candles.slice(0, splitIndex);
  const test = candles.slice(splitIndex);

  return {
    train,
    test,
    trainEnd: train[train.length - 1]!!.timestamp,
    testStart: test[0]!!.timestamp,
    testEnd: test[test.length - 1]!!.timestamp,
  };
}
