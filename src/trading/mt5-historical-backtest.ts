import type { PaperTradingConfig } from "./paper-scalping.js";
import { runHistoricalBacktest, type HistoricalBacktestResult } from "./historical-backtest.js";
import { assertMt5HistoricalReady, type Mt5HistoricalImportResult } from "./mt5-historical-import.js";
import { XAUUSD_SCALPING_PROFILE } from "./xauusd-scalping-profile.js";

export interface Mt5HistoricalBacktestOptions {
  data: Mt5HistoricalImportResult;
  config: PaperTradingConfig;
  requireBidAsk?: boolean;
}

export function runMt5HistoricalBacktest(
  options: Mt5HistoricalBacktestOptions,
): HistoricalBacktestResult {
  const requireBidAsk = options.requireBidAsk ?? XAUUSD_SCALPING_PROFILE.historicalBacktest.requireBidAsk;
  if (
    options.data.symbol === XAUUSD_SCALPING_PROFILE.symbol &&
    options.data.timeframe === XAUUSD_SCALPING_PROFILE.timeframe &&
    options.config.symbol !== XAUUSD_SCALPING_PROFILE.symbol
  ) {
    throw new Error("XAUUSD data requires an XAUUSD paper-trading configuration.");
  }

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
