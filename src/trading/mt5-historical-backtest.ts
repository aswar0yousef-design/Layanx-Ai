import type { PaperTradingConfig } from "./paper-scalping.js";
import { runHistoricalBacktest, type HistoricalBacktestResult } from "./historical-backtest.js";
import { assertMt5HistoricalReady, type Mt5HistoricalImportResult } from "./mt5-historical-import.js";

export interface Mt5HistoricalBacktestOptions {
  data: Mt5HistoricalImportResult;
  config: PaperTradingConfig;
  requireBidAsk?: boolean;
}

export function runMt5HistoricalBacktest(
  options: Mt5HistoricalBacktestOptions,
): HistoricalBacktestResult {
  const requireBidAsk = options.requireBidAsk ?? true;
  if (requireBidAsk && options.data.quoteCoverage.percentage < 100) {
    throw new Error(
      `MT5 backtest requires complete Bid/Ask coverage; received ${options.data.quoteCoverage.percentage.toFixed(2)}%.`,
    );
  }

  assertMt5HistoricalReady({
    ...options.data,
    readyForBacktest: options.data.readyForBacktest &&
      (!requireBidAsk || options.data.quoteCoverage.percentage === 100),
  });

  return runHistoricalBacktest({
    source: options.data.source,
    symbol: options.data.symbol,
    timeframe: options.data.timeframe,
    candles: options.data.candles,
    config: options.config,
  });
}
