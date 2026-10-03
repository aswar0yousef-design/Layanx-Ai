import type { MarketCandle } from "./scalping-signal.js";
import type { PaperTradingConfig } from "./paper-scalping.js";
import { runPaperScalping } from "./paper-scalping.js";
import { buildBacktestReport, type BacktestReport } from "./backtest-report.js";
import { buildBacktestSegmentReport, type BacktestSegmentReport } from "./backtest-segmentation.js";
import { splitChronologically, type BacktestSplit } from "./walk-forward.js";

export interface OutOfSampleBacktestResult {
  split: BacktestSplit;
  train: {
    report: BacktestReport;
    segments: BacktestSegmentReport;
  };
  test: {
    report: BacktestReport;
    segments: BacktestSegmentReport;
  };
}

export function runOutOfSampleBacktest(
  candles: MarketCandle[],
  config: PaperTradingConfig,
  trainRatio = 0.7,
): OutOfSampleBacktestResult {
  const split = splitChronologically(candles, trainRatio);
  if (split.train.length < 31 || split.test.length < 31) {
    throw new Error("Both train and test sets need at least 31 candles for the current paper engine.");
  }

  const trainSimulation = runPaperScalping(split.train, config);
  const testSimulation = runPaperScalping(split.test, config);

  return {
    split,
    train: {
      report: buildBacktestReport(trainSimulation.initialBalance, trainSimulation.analyses),
      segments: buildBacktestSegmentReport(trainSimulation.initialBalance, trainSimulation.analyses),
    },
    test: {
      report: buildBacktestReport(testSimulation.initialBalance, testSimulation.analyses),
      segments: buildBacktestSegmentReport(testSimulation.initialBalance, testSimulation.analyses),
    },
  };
}
