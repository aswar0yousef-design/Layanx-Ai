import type { TradeSide } from "./execution-quality.js";
import type { MarketCandle } from "./scalping-signal.js";
import {roundDecimal} from "./numeric.js";

export interface Mt5SymbolSnapshot {
  symbol: string;
  bid: number;
  ask: number;
  timestamp: string;
}

export interface Mt5CandleRequest {
  symbol: string;
  timeframe: string;
  limit: number;
  endTime?: string;
}

export interface Mt5OrderRequest {
  symbol: string;
  side: TradeSide;
  quantity: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  clientOrderId?: string;
}

export interface Mt5OrderResult {
  accepted: boolean;
  brokerOrderId?: string;
  executedPrice?: number;
  executedQuantity?: number;
  message?: string;
}

export interface Mt5Adapter {
  getSymbolSnapshot(symbol: string): Promise<Mt5SymbolSnapshot>;
  getCandles(request: Mt5CandleRequest): Promise<MarketCandle[]>;
  placeOrder(request: Mt5OrderRequest): Promise<Mt5OrderResult>;
}

export function toPreTradeMarketSnapshot(
  snapshot: Mt5SymbolSnapshot,
  timeframe: string,
  atr?: number,
  expectedSlippage?: number
) {
  if (!snapshot.symbol.trim()) throw new Error("MT5 symbol is required.");
  if (!Number.isFinite(snapshot.bid) || !Number.isFinite(snapshot.ask)) throw new Error("MT5 bid and ask must be finite.");
  if (snapshot.bid <= 0 || snapshot.ask <= 0) throw new Error("MT5 bid and ask must be positive.");
  if (snapshot.ask < snapshot.bid) throw new Error("MT5 ask cannot be below bid.");

  return {
    symbol: snapshot.symbol,
    timeframe,
    bid: snapshot.bid,
    ask: snapshot.ask,
    spread: roundDecimal(Math.abs(snapshot.ask - snapshot.bid)),
    atr,
    expectedSlippage,
    timestamp: snapshot.timestamp,
  };
}

export function normalizeMt5Timeframe(timeframe: string): string {
  const normalized = timeframe.trim().toUpperCase();
  if (!normalized) throw new Error("MT5 timeframe is required.");
  return normalized;
}


export function filterCompletedMt5Candles(
  candles: MarketCandle[],
  snapshotTimestamp: string,
  timeframe: string,
): MarketCandle[] {
  const snapshotTime = Date.parse(snapshotTimestamp);
  if (!Number.isFinite(snapshotTime)) throw new Error("MT5 snapshot timestamp is invalid.");
  const intervalMs = mt5TimeframeIntervalMs(normalizeMt5Timeframe(timeframe));
  if (!Array.isArray(candles) || candles.length === 0) throw new Error("MT5 returned no candles.");

  let completedEnd = candles.length;
  while (completedEnd > 0) {
    const lastTime = Date.parse(candles[completedEnd - 1]!.timestamp);
    if (!Number.isFinite(lastTime) || lastTime + intervalMs > snapshotTime) completedEnd -= 1;
    else break;
  }
  const completed = candles.slice(0, completedEnd);
  if (!completed.length) throw new Error("MT5 returned no completed candles.");

  for (let index = 0; index < completed.length; index += 1) {
    const candle = completed[index]!;
    const time = Date.parse(candle.timestamp);
    if (!Number.isFinite(time)) throw new Error("MT5 returned a candle with an invalid timestamp.");
    if (![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)) {
      throw new Error("MT5 returned a candle with non-finite OHLC values.");
    }
    if (candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close) || candle.high < candle.low) {
      throw new Error(`MT5 returned an invalid OHLC range at ${candle.timestamp}.`);
    }
    if (index > 0 && Date.parse(completed[index - 1]!.timestamp) >= time) {
      throw new Error("MT5 candles must be strictly chronological with no duplicate timestamps.");
    }
  }

  return completed;
}

function mt5TimeframeIntervalMs(timeframe: string): number {
  const match = /^(M|H|D|W)(\d+)$/.exec(timeframe);
  if (!match) throw new Error(`Unsupported MT5 timeframe: ${timeframe}`);
  const value = Number(match[2]);
  const unitMs = match[1] === "M" ? 60_000 : match[1] === "H" ? 3_600_000 : match[1] === "D" ? 86_400_000 : 604_800_000;
  return value * unitMs;
}
