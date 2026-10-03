import type { MarketCandle } from "./scalping-signal.js";
import type { PaperTradingConfig } from "./paper-scalping.js";
import { runPaperScalping } from "./paper-scalping.js";
import { buildBacktestReport, type BacktestReport } from "./backtest-report.js";
import { createWalkForwardWindows, type WalkForwardWindow } from "./walk-forward-windows.js";
import { assertBacktestConfigMatchesData } from "./xauusd-scalping-profile.js";

export interface WalkForwardResult {
  window: WalkForwardWindow;
  train: BacktestReport;
  test: BacktestReport;
}

export interface MultiWindowWalkForwardResult {
  windows: WalkForwardResult[];
  aggregateTest: BacktestReport;
}

export function runMultiWindowWalkForward(
  candles: MarketCandle[],
  config: PaperTradingConfig,
  trainSize: number,
  testSize: number,
  stepSize = testSize,
): MultiWindowWalkForwardResult {
  assertBacktestConfigMatchesData(config.symbol, config.timeframe, config);
  const windows = createWalkForwardWindows(candles, trainSize, testSize, stepSize);
  const testAnalyses = [];

  const results = windows.map(window => {
    const train = runPaperScalping(window.train, config);
    const test = runPaperScalping(window.test, config);
    testAnalyses.push(...test.analyses);
    return {
      window,
      train: buildBacktestReport(train.initialBalance, train.analyses),
      test: buildBacktestReport(test.initialBalance, test.analyses),
    };
  });

  return {
    windows: results,
    aggregateTest: buildBacktestReport(config.initialBalance, testAnalyses),
  };
}
