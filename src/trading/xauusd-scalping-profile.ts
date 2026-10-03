import type { PreTradeExecutionPolicy } from "./pre-trade-execution-gate.js";
import type { PaperTradingConfig } from "./paper-scalping.js";

export interface XauUsdScalpingProfile {
  symbol: "XAUUSD";
  timeframe: "M1";
  executionPolicy: PreTradeExecutionPolicy;
  intrabarResolution: "conservative" | "optimistic";
  historicalBacktest: {
    requireBidAsk: true;
  };
}

export const XAUUSD_SCALPING_PROFILE: XauUsdScalpingProfile = {
  symbol: "XAUUSD",
  timeframe: "M1",
  executionPolicy: {
    maxSpreadAtrRatio: 0.20,
    maxExpectedSlippageAtrRatio: 0.10,
    requireSpread: true,
    requireAtr: true,
  },
  intrabarResolution: "conservative",
  historicalBacktest: {
    requireBidAsk: true,
  },
};

/**
 * Builds a paper configuration from the shared XAUUSD profile.
 * Risk, stop distance, spread, and slippage remain explicit inputs and are
 * intentionally not hard-coded as broker or profitability assumptions.
 */
export function assertBacktestConfigMatchesData(
  symbol: string,
  timeframe: string,
  config: PaperTradingConfig,
): void {
  if (symbol !== config.symbol) {
    throw new Error(`Backtest data symbol ${symbol} does not match config symbol ${config.symbol}.`);
  }
  if (timeframe !== config.timeframe) {
    throw new Error(`Backtest data timeframe ${timeframe} does not match config timeframe ${config.timeframe}.`);
  }
  assertXauUsdProfileConfig(config);
}

export function assertXauUsdProfileConfig(config: PaperTradingConfig): void {
  if (config.symbol !== XAUUSD_SCALPING_PROFILE.symbol || config.timeframe !== XAUUSD_SCALPING_PROFILE.timeframe) return;
  if (config.intrabarResolution !== undefined && config.intrabarResolution !== XAUUSD_SCALPING_PROFILE.intrabarResolution) {
    throw new Error("XAUUSD M1 backtest must use the shared XAUUSD intrabar resolution.");
  }
}

export function createXauUsdPaperConfig(
  input: Omit<PaperTradingConfig, "symbol" | "timeframe" | "intrabarResolution">,
): PaperTradingConfig {
  return {
    ...input,
    symbol: XAUUSD_SCALPING_PROFILE.symbol,
    timeframe: XAUUSD_SCALPING_PROFILE.timeframe,
    intrabarResolution: XAUUSD_SCALPING_PROFILE.intrabarResolution,
  };
}
