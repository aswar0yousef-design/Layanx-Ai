import type { BacktestReport } from "./backtest-report.js";
import type { MultiWindowWalkForwardResult } from "./multi-window-walk-forward.js";

export interface OutOfSampleStability {
  windows: number;
  testWindowsWithTrades: number;
  profitableWindows: number;
  losingWindows: number;
  flatWindows: number;
  profitableWindowRate: number;
  averageReturnPct: number;
  medianReturnPct: number;
  minReturnPct: number;
  maxReturnPct: number;
  averageExpectancyPerTrade: number;
  medianExpectancyPerTrade: number;
  worstDrawdownPct: number;
  averageProfitFactor: number;
  positiveExpectancyWindows: number;
  negativeExpectancyWindows: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function finiteProfitFactor(report: BacktestReport): number {
  return Number.isFinite(report.profitFactor) ? report.profitFactor : 0;
}

export function analyzeOosStability(
  result: MultiWindowWalkForwardResult,
): OutOfSampleStability {
  const reports = result.windows.map(window => window.test);
  const active = reports.filter(report => report.trades > 0);
  const returns = active.map(report => report.returnPct);
  const expectancies = active.map(report => report.expectancyPerTrade);

  const profitableWindows = active.filter(report => report.netPnl > 0).length;
  const losingWindows = active.filter(report => report.netPnl < 0).length;
  const flatWindows = active.length - profitableWindows - losingWindows;

  return {
    windows: reports.length,
    testWindowsWithTrades: active.length,
    profitableWindows,
    losingWindows,
    flatWindows,
    profitableWindowRate: active.length === 0 ? 0 : (profitableWindows / active.length) * 100,
    averageReturnPct: returns.length === 0 ? 0 : returns.reduce((a, b) => a + b, 0) / returns.length,
    medianReturnPct: median(returns),
    minReturnPct: returns.length === 0 ? 0 : Math.min(...returns),
    maxReturnPct: returns.length === 0 ? 0 : Math.max(...returns),
    averageExpectancyPerTrade: expectancies.length === 0
      ? 0
      : expectancies.reduce((a, b) => a + b, 0) / expectancies.length,
    medianExpectancyPerTrade: median(expectancies),
    worstDrawdownPct: active.length === 0 ? 0 : Math.max(...active.map(report => report.maxDrawdownPct)),
    averageProfitFactor: active.length === 0
      ? 0
      : active.reduce((sum, report) => sum + finiteProfitFactor(report), 0) / active.length,
    positiveExpectancyWindows: active.filter(report => report.expectancyPerTrade > 0).length,
    negativeExpectancyWindows: active.filter(report => report.expectancyPerTrade < 0).length,
  };
}
