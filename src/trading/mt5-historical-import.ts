import type { HistoricalCandleSource } from "./historical-data.js";
import { importHistoricalCsv, importHistoricalJson } from "./historical-data.js";
import { inspectCandleQuality, type CandleQualityReport } from "./candle-quality.js";
import type { MarketCandle } from "./scalping-signal.js";

export interface Mt5HistoricalImportOptions {
  symbol: string;
  timeframe: string;
  source?: string;
  expectedIntervalMs?: number;
  requireBidAsk?: boolean;
}

export interface Mt5HistoricalImportResult extends HistoricalCandleSource {
  quality: CandleQualityReport;
  quoteCoverage: { candlesWithBidAsk: number; candlesWithoutBidAsk: number; percentage: number };
  readyForBacktest: boolean;
}

function buildResult(data: HistoricalCandleSource, options: Mt5HistoricalImportOptions): Mt5HistoricalImportResult {
  const quality = inspectCandleQuality(data.candles, options.expectedIntervalMs);
  const candlesWithBidAsk = data.candles.filter(c => c.bid !== undefined && c.ask !== undefined).length;
  const candlesWithoutBidAsk = data.candles.length - candlesWithBidAsk;
  const percentage = data.candles.length === 0 ? 0 : (candlesWithBidAsk / data.candles.length) * 100;
  return { ...data, quality, quoteCoverage: { candlesWithBidAsk, candlesWithoutBidAsk, percentage },
    readyForBacktest: quality.valid && data.candles.length >= 31 &&
      (!options.requireBidAsk || candlesWithBidAsk === data.candles.length) };
}

export function importMt5HistoricalCsv(csv: string, options: Mt5HistoricalImportOptions): Mt5HistoricalImportResult {
  return buildResult(importHistoricalCsv(csv, { source: options.source ?? "MT5", symbol: options.symbol, timeframe: options.timeframe }), options);
}

export function importMt5HistoricalJson(input: string | unknown[], options: Mt5HistoricalImportOptions): Mt5HistoricalImportResult {
  return buildResult(importHistoricalJson(input, { source: options.source ?? "MT5", symbol: options.symbol, timeframe: options.timeframe }), options);
}

export function assertMt5HistoricalReady(data: Mt5HistoricalImportResult): asserts data is Mt5HistoricalImportResult & { candles: [MarketCandle, ...MarketCandle[]] } {
  if (!data.readyForBacktest) {
    const details = data.quality.issues.slice(0, 5).map(issue => issue.message).join("; ");
    throw new Error(`MT5 historical data is not ready for backtest. ${details || "Insufficient candles or Bid/Ask coverage."}`);
  }
}