import type { MarketCandle } from "./scalping-signal.js";
import { runPaperScalping, type PaperTradingConfig, type PaperTradingResult } from "./paper-scalping.js";
import { buildBacktestReport, type BacktestReport } from "./backtest-report.js";
import { importHistoricalCsv, importHistoricalJson } from "./historical-data.js";

export interface HistoricalBacktestInput {
  symbol: string;
  timeframe: string;
  source: string;
  candles: MarketCandle[];
  config: PaperTradingConfig;
}

export interface HistoricalBacktestResult {
  source: string;
  symbol: string;
  timeframe: string;
  candles: number;
  simulation: PaperTradingResult;
  report: BacktestReport;
}

export function runHistoricalBacktest(input: HistoricalBacktestInput): HistoricalBacktestResult {
  const simulation = runPaperScalping(input.candles, input.config);
  return {
    source: input.source,
    symbol: input.symbol,
    timeframe: input.timeframe,
    candles: input.candles.length,
    simulation,
    report: buildBacktestReport(simulation.initialBalance, simulation.analyses),
  };
}

export function runCsvBacktest(
  csv: string,
  metadata: { source?: string; symbol: string; timeframe: string },
  config: PaperTradingConfig,
): HistoricalBacktestResult {
  const data = importHistoricalCsv(csv, metadata);
  return runHistoricalBacktest({
    source: data.source,
    symbol: data.symbol,
    timeframe: data.timeframe,
    candles: data.candles,
    config,
  });
}

export function runJsonBacktest(
  input: string | unknown[],
  metadata: { source?: string; symbol: string; timeframe: string },
  config: PaperTradingConfig,
): HistoricalBacktestResult {
  const data = importHistoricalJson(input, metadata);
  return runHistoricalBacktest({
    source: data.source,
    symbol: data.symbol,
    timeframe: data.timeframe,
    candles: data.candles,
    config,
  });
}
