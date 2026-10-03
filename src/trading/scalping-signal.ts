export interface MarketCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface ScalpingSignalConfig {
  fastEmaPeriod: number;
  slowEmaPeriod: number;
  rsiPeriod: number;
  atrPeriod: number;
  minimumScore: number;
}

export interface ScalpingSignal {
  action: "long" | "short" | "neutral";
  score: number;
  confidence: number;
  reasons: string[];
  indicators: {
    fastEma?: number;
    slowEma?: number;
    rsi?: number;
    atr?: number;
  };
  candleTimestamp?: string;
}

const DEFAULT_CONFIG: ScalpingSignalConfig = {
  fastEmaPeriod: 9,
  slowEmaPeriod: 21,
  rsiPeriod: 14,
  atrPeriod: 14,
  minimumScore: 3,
};

export function generateScalpingSignal(
  candles: MarketCandle[],
  config: Partial<ScalpingSignalConfig> = {}
): ScalpingSignal {
  const rules = { ...DEFAULT_CONFIG, ...config };
  const closes = candles.map(c => c.close);
  const fastEma = ema(closes, rules.fastEmaPeriod);
  const slowEma = ema(closes, rules.slowEmaPeriod);
  const rsiValue = rsi(closes, rules.rsiPeriod);
  const atrValue = atr(candles, rules.atrPeriod);

  const reasons: string[] = [];
  let score = 0;

  if (fastEma !== undefined && slowEma !== undefined) {
    if (fastEma > slowEma) {
      score += 1;
      reasons.push("Fast EMA is above slow EMA.");
    } else if (fastEma < slowEma) {
      score -= 1;
      reasons.push("Fast EMA is below slow EMA.");
    }
  }

  if (rsiValue !== undefined) {
    if (rsiValue >= 50 && rsiValue <= 70) {
      score += 1;
      reasons.push("RSI supports bullish momentum without being above 70.");
    } else if (rsiValue <= 50 && rsiValue >= 30) {
      score -= 1;
      reasons.push("RSI supports bearish momentum without being below 30.");
    } else if (rsiValue > 70) {
      reasons.push("RSI is above 70; bullish momentum may be extended.");
    } else if (rsiValue < 30) {
      reasons.push("RSI is below 30; bearish momentum may be extended.");
    }
  }

  const last = candles[candles.length - 1];
  if (last && fastEma !== undefined && slowEma !== undefined) {
    if (last.close > fastEma && fastEma > slowEma) {
      score += 1;
      reasons.push("Price is above fast EMA while trend alignment is bullish.");
    } else if (last.close < fastEma && fastEma < slowEma) {
      score -= 1;
      reasons.push("Price is below fast EMA while trend alignment is bearish.");
    }
  }

  const absScore = Math.abs(score);
  const confidence = Math.min(1, absScore / Math.max(1, rules.minimumScore));
  const action = score >= rules.minimumScore
    ? "long"
    : score <= -rules.minimumScore
      ? "short"
      : "neutral";

  return {
    action,
    score,
    confidence,
    reasons,
    indicators: { fastEma, slowEma, rsi: rsiValue, atr: atrValue },
    candleTimestamp: last?.timestamp,
  };
}

export function ema(values: number[], period: number): number | undefined {
  if (period <= 0 || values.length < period) return undefined;
  const seed = average(values.slice(0, period));
  if (seed === undefined) return undefined;
  const multiplier = 2 / (period + 1);
  let result = seed;
  for (let i = period; i < values.length; i++) {
    result = (values[i] - result) * multiplier + result;
  }
  return result;
}

export function rsi(values: number[], period: number): number | undefined {
  if (period <= 0 || values.length <= period) return undefined;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    const gain = Math.max(0, delta);
    const loss = Math.max(0, -delta);
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }

  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

export function atr(candles: MarketCandle[], period: number): number | undefined {
  if (period <= 0 || candles.length <= period) return undefined;
  const ranges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];
    ranges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    ));
  }
  if (ranges.length < period) return undefined;
  return average(ranges.slice(-period));
}

function average(values: number[]): number | undefined {
  if (!values.length) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
