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
  zeroExpectancyWindows: number;
  totalTestTrades: number;
  pooledTestNetPnl: number;
  pooledTestExpectancyPerTrade: number;
  pooledTestReturnOnStartingBalancesPct: number;
  warnings: string[];
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
  const flatWindows = active.filter(report => report.netPnl === 0).length;

  const totalTestTrades = reports.reduce((sum, report) => sum + report.trades, 0);
  const pooledTestNetPnl = reports.reduce((sum, report) => sum + report.netPnl, 0);
  const pooledStartingBalance = reports.reduce((sum, report) => sum + report.initialBalance, 0);
  const warnings: string[] = [];

  if (reports.length === 0) warnings.push("No out-of-sample windows were produced.");
  if (active.length < reports.length) warnings.push("One or more OOS windows contained no trades.");
  if (active.length > 0 && profitableWindows < active.length / 2) {
    warnings.push("Fewer than half of active OOS windows were profitable; inspect window-level results.");
  }
  if (active.length > 0 && Math.abs(Math.min(...returns)) > Math.max(...returns, 0)) {
    warnings.push("Negative OOS movement is larger in magnitude than the positive OOS movement; inspect dispersion.");
  }

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
    zeroExpectancyWindows: active.filter(report => report.expectancyPerTrade === 0).length,
    totalTestTrades,
    pooledTestNetPnl,
    pooledTestExpectancyPerTrade: totalTestTrades === 0 ? 0 : pooledTestNetPnl / totalTestTrades,
    pooledTestReturnOnStartingBalancesPct: pooledStartingBalance === 0
      ? 0
      : (pooledTestNetPnl / pooledStartingBalance) * 100,
    warnings,
  };
}
