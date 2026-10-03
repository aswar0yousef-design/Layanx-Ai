import type { MultiWindowWalkForwardResult } from "./multi-window-walk-forward.js";
import { analyzeOosStability, type OutOfSampleStability } from "./oos-stability.js";

export interface OosStabilityWithContext {
  stability: OutOfSampleStability;
  windows: MultiWindowWalkForwardResult["windows"];
  pooledTest: MultiWindowWalkForwardResult["pooledTest"];
}

export function buildOosStabilityReport(
  result: MultiWindowWalkForwardResult,
): OosStabilityWithContext {
  return {
    stability: analyzeOosStability(result),
    windows: result.windows,
    pooledTest: result.pooledTest,
  };
}
