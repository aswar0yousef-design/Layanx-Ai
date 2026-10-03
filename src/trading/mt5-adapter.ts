import type { TradeSide } from "./execution-quality.js";
import type { MarketCandle } from "./scalping-signal.js";

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
  return {
    symbol: snapshot.symbol,
    timeframe,
    spread: Math.abs(snapshot.ask - snapshot.bid),
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
