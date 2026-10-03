import type { MarketCandle } from "./scalping-signal.js";
import { inspectCandleQuality, type CandleQualityReport } from "./candle-quality.js";

export interface MarketDataDiagnostics {
  symbol: string;
  timeframe: string;
  candles: number;
  start?: string;
  end?: string;
  durationMs?: number;
  expectedIntervalMs?: number;
  actualIntervalMs?: {
    min: number;
    median: number;
    max: number;
  };
  gaps: number;
  quality: CandleQualityReport;
  quoteCoverage: {
    candlesWithBidAsk: number;
    candlesWithoutBidAsk: number;
    percentage: number;
  };
  spread?: {
    min: number;
    median: number;
    max: number;
    average: number;
    p95: number;
  };
  price?: {
    min: number;
    max: number;
    averageClose: number;
  };
  warnings: string[];
}

function percentile(sorted: number[], p: number): number | undefined {
  if (!sorted.length) return undefined;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function summary(values: number[]) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0],
    median: percentile(sorted, 0.5)!,
    max: sorted[sorted.length - 1],
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    p95: percentile(sorted, 0.95)!,
  };
}

export function diagnoseMarketData(
  symbol: string,
  timeframe: string,
  candles: MarketCandle[],
  expectedIntervalMs?: number,
): MarketDataDiagnostics {
  const quality = inspectCandleQuality(candles, expectedIntervalMs);
  const timestamps = candles.map(c => Date.parse(c.timestamp));
  const intervals: number[] = [];
  for (let i = 1; i < timestamps.length; i += 1) {
    const delta = timestamps[i] - timestamps[i - 1];
    if (delta > 0) intervals.push(delta);
  }

  const bidAskSpreads = candles
    .filter(c => c.bid !== undefined && c.ask !== undefined)
    .map(c => c.ask! - c.bid!);
  const closes = candles.map(c => c.close).filter(Number.isFinite);
  const spread = summary(bidAskSpreads);
  const intervalSummary = summary(intervals);
  const start = candles[0]?.timestamp;
  const end = candles[candles.length - 1]?.timestamp;
  const startMs = start ? Date.parse(start) : NaN;
  const endMs = end ? Date.parse(end) : NaN;

  const candlesWithBidAsk = bidAskSpreads.length;
  const candlesWithoutBidAsk = candles.length - candlesWithBidAsk;
  const warnings: string[] = [];

  if (!candles.length) warnings.push("Dataset contains no candles.");
  if (!quality.valid) warnings.push(`Candle quality has ${quality.issues.length} issue(s).`);
  if (candlesWithoutBidAsk > 0) warnings.push("Some candles do not contain both Bid and Ask.");
  if (spread && spread.max > spread.median * 3) warnings.push("Maximum spread is materially above the median spread.");
  if (intervalSummary && expectedIntervalMs && intervalSummary.max > expectedIntervalMs) {
    warnings.push("One or more intervals exceed the expected timeframe interval.");
  }

  return {
    symbol,
    timeframe,
    candles: candles.length,
    start,
    end,
    durationMs: Number.isFinite(startMs) && Number.isFinite(endMs) ? endMs - startMs : undefined,
    expectedIntervalMs,
    actualIntervalMs: intervalSummary ? {
      min: intervalSummary.min,
      median: intervalSummary.median,
      max: intervalSummary.max,
    } : undefined,
    gaps: quality.issues.filter(issue => issue.type === "gap").length,
    quality,
    quoteCoverage: {
      candlesWithBidAsk,
      candlesWithoutBidAsk,
      percentage: candles.length ? (candlesWithBidAsk / candles.length) * 100 : 0,
    },
    spread,
    price: closes.length ? {
      min: Math.min(...closes),
      max: Math.max(...closes),
      averageClose: closes.reduce((sum, value) => sum + value, 0) / closes.length,
    } : undefined,
    warnings,
  };
}
