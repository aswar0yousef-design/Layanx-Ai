import type { TradeAnalysis } from "./trade-record.js";
import type { BacktestReport } from "./backtest-report.js";
import { buildBacktestReport } from "./backtest-report.js";

export type BacktestSegmentDimension = "session" | "side" | "quality" | "strategy";

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
      dimension === "quality" ? analysis.executionQuality :
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
  };
}
