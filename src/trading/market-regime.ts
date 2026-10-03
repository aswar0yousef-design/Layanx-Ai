export type MarketTrendRegime = "bullish-trend" | "bearish-trend" | "range";
export type MarketVolatilityRegime = "low-volatility" | "normal-volatility" | "high-volatility" | "unknown";

export interface MarketRegimeConfig {
  fastEmaPeriod?: number;
  slowEmaPeriod?: number;
  atrPeriod?: number;
  volatilityLookback?: number;
  trendThresholdAtr?: number;
  highVolatilityMultiplier?: number;
  lowVolatilityMultiplier?: number;
}

export interface MarketRegime {
  trend: MarketTrendRegime;
  volatility: MarketVolatilityRegime;
  atr?: number;
  atrBaseline?: number;
  atrRatio?: number;
  emaSpread?: number;
  emaSpreadAtrRatio?: number;
  candleTimestamp?: string;
  reasons: string[];
}

function average(values: number[]): number | undefined {
  if (!values.length) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ema(values: number[], period: number): number | undefined {
  if (period <= 0 || values.length < period) return undefined;
  const seed = average(values.slice(0, period));
  if (seed === undefined) return undefined;
  const multiplier = 2 / (period + 1);
  let result = seed;
  for (let i = period; i < values.length; i += 1) {
    result = (values[i] - result) * multiplier + result;
  }
  return result;
}

function atr(candles: Array<{ high:number; low:number; close:number }>, period: number): number | undefined {
  if (period <= 0 || candles.length <= period) return undefined;
  const ranges: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const previous = candles[i - 1];
    ranges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    ));
  }
  return ranges.length >= period ? average(ranges.slice(-period)) : undefined;
}

export function classifyMarketRegime(
  candles: Array<{ timestamp:string; high:number; low:number; close:number }>,
  config: MarketRegimeConfig = {},
): MarketRegime {
  const fastPeriod = config.fastEmaPeriod ?? 9;
  const slowPeriod = config.slowEmaPeriod ?? 21;
  const atrPeriod = config.atrPeriod ?? 14;
  const lookback = config.volatilityLookback ?? 50;
  const trendThresholdAtr = config.trendThresholdAtr ?? 0.25;
  const highMultiplier = config.highVolatilityMultiplier ?? 1.5;
  const lowMultiplier = config.lowVolatilityMultiplier ?? 0.67;

  const closes = candles.map(c => c.close);
  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);
  const currentAtr = atr(candles, atrPeriod);

  const atrHistory: number[] = [];
  const start = Math.max(atrPeriod + 1, candles.length - lookback);
  for (let i = start; i <= candles.length; i += 1) {
    const value = atr(candles.slice(0, i), atrPeriod);
    if (value !== undefined && Number.isFinite(value) && value > 0) atrHistory.push(value);
  }
  const atrBaseline = average(atrHistory);
  const atrRatio = currentAtr !== undefined && atrBaseline !== undefined && atrBaseline > 0
    ? currentAtr / atrBaseline
    : undefined;
  const emaSpread = fast !== undefined && slow !== undefined ? fast - slow : undefined;
  const emaSpreadAtrRatio = emaSpread !== undefined && currentAtr !== undefined && currentAtr > 0
    ? Math.abs(emaSpread) / currentAtr
    : undefined;

  let trend: MarketTrendRegime = "range";
  const reasons: string[] = [];
  if (emaSpreadAtrRatio !== undefined && emaSpreadAtrRatio >= trendThresholdAtr) {
    trend = emaSpread! > 0 ? "bullish-trend" : "bearish-trend";
    reasons.push(`EMA separation is ${emaSpreadAtrRatio.toFixed(2)} ATR.`);
  } else {
    reasons.push("EMA separation is below the trend threshold; classified as range.");
  }

  let volatility: MarketVolatilityRegime = "unknown";
  if (atrRatio !== undefined) {
    if (atrRatio >= highMultiplier) {
      volatility = "high-volatility";
      reasons.push(`ATR is ${atrRatio.toFixed(2)}x its recent baseline.`);
    } else if (atrRatio <= lowMultiplier) {
      volatility = "low-volatility";
      reasons.push(`ATR is ${atrRatio.toFixed(2)}x its recent baseline.`);
    } else {
      volatility = "normal-volatility";
      reasons.push("ATR is near its recent baseline.");
    }
  } else {
    reasons.push("ATR baseline is unavailable.");
  }

  return {
    trend,
    volatility,
    atr: currentAtr,
    atrBaseline,
    atrRatio,
    emaSpread,
    emaSpreadAtrRatio,
    candleTimestamp: candles[candles.length - 1]?.timestamp,
    reasons,
  };
}
