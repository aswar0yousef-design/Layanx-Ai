import type { TradeAnalysis } from "./trade-record.js";
import type { BacktestReport } from "./backtest-report.js";
import { buildBacktestReport } from "./backtest-report.js";

export type BacktestSegmentDimension = "session" | "side" | "quality" | "strategy" | "trendRegime" | "volatilityRegime" | "entryTrendRegime" | "entryVolatilityRegime";

export interface BacktestSegment {
  key: string;
  dimension: BacktestSegmentDimension;
  report: BacktestReport;
}

export function segmentBacktestAnalyses(
  initialBalance: number,
  analyses: TradeAnalysis[],
  dimension: BacktestSegmentDimension,
): BacktestSegment[] {
  const groups = new Map<string, TradeAnalysis[]>();

  for (const analysis of analyses) {
    const key =
      dimension === "session" ? analysis.session ?? "unknown" :
      dimension === "side" ? analysis.side :
      dimension === "quality" ? analysis.quality :
      dimension === "trendRegime" ? analysis.trendRegime ?? "unknown" :
      dimension === "volatilityRegime" ? analysis.volatilityRegime ?? "unknown" :
      dimension === "entryTrendRegime" ? analysis.entryTrendRegime ?? "unknown" :
      dimension === "entryVolatilityRegime" ? analysis.entryVolatilityRegime ?? "unknown" :
      analysis.strategy ?? "unknown";

    const group = groups.get(key) ?? [];
    group.push(analysis);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => ({
      key,
      dimension,
      report: buildBacktestReport(initialBalance, group),
    }));
}

export interface BacktestSegmentReport {
  bySession: BacktestSegment[];
  bySide: BacktestSegment[];
  byQuality: BacktestSegment[];
  byStrategy: BacktestSegment[];
  byTrendRegime: BacktestSegment[];
  byVolatilityRegime: BacktestSegment[];
  byEntryTrendRegime: BacktestSegment[];
  byEntryVolatilityRegime: BacktestSegment[];
}

export function buildBacktestSegmentReport(
  initialBalance: number,
  analyses: TradeAnalysis[],
): BacktestSegmentReport {
  return {
    bySession: segmentBacktestAnalyses(initialBalance, analyses, "session"),
    bySide: segmentBacktestAnalyses(initialBalance, analyses, "side"),
    byQuality: segmentBacktestAnalyses(initialBalance, analyses, "quality"),
    byStrategy: segmentBacktestAnalyses(initialBalance, analyses, "strategy"),
    byTrendRegime: segmentBacktestAnalyses(initialBalance, analyses, "trendRegime"),
    byVolatilityRegime: segmentBacktestAnalyses(initialBalance, analyses, "volatilityRegime"),
    byEntryTrendRegime: segmentBacktestAnalyses(initialBalance, analyses, "entryTrendRegime"),
    byEntryVolatilityRegime: segmentBacktestAnalyses(initialBalance, analyses, "entryVolatilityRegime"),
  };
}
