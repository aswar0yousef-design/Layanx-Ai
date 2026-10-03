import type { MarketCandle } from "./scalping-signal.js";
import type { BrokerSymbolSpecification } from "./broker-symbol-spec.js";
import { validateBrokerSymbolSpecification } from "./broker-symbol-spec.js";
import { normalizeMt5Timeframe, filterCompletedMt5Candles, type Mt5SymbolSnapshot, type Mt5CandleRequest } from "./mt5-adapter.js";

export interface Mt5ReadOnlyTransport {
  getSymbolSnapshot(symbol: string): Promise<Mt5SymbolSnapshot>;
  getCandles(request: Mt5CandleRequest): Promise<MarketCandle[]>;
  getSymbolSpecification(symbol: string): Promise<BrokerSymbolSpecification>;
}

export interface Mt5ReadOnlyMarketData {
  snapshot: Mt5SymbolSnapshot;
  candles: MarketCandle[];
  specification: BrokerSymbolSpecification;
  excludedFormingCandle: boolean;
}

export async function readMt5MarketData(
  transport: Mt5ReadOnlyTransport,
  symbol: string,
  timeframe: string,
  limit: number,
  endTime?: string,
): Promise<Mt5ReadOnlyMarketData> {
  if (!symbol.trim()) throw new Error("MT5 symbol is required.");
  if (!Number.isInteger(limit) || limit <= 0) throw new Error("Candle limit must be a positive integer.");

  const normalizedTimeframe = normalizeMt5Timeframe(timeframe);
  const [snapshot, candles, specification] = await Promise.all([
    transport.getSymbolSnapshot(symbol),
    transport.getCandles({ symbol, timeframe: normalizedTimeframe, limit, endTime }),
    transport.getSymbolSpecification(symbol),
  ]);

  if (snapshot.symbol !== symbol) throw new Error("MT5 snapshot symbol does not match requested symbol.");
  if (Number.isNaN(Date.parse(snapshot.timestamp))) throw new Error("MT5 snapshot timestamp is invalid.");
  if (!Number.isFinite(snapshot.bid) || !Number.isFinite(snapshot.ask) || snapshot.bid <= 0 || snapshot.ask <= 0) {
    throw new Error("MT5 snapshot bid and ask must be positive finite values.");
  }
  if (snapshot.ask < snapshot.bid) throw new Error("MT5 snapshot ask cannot be below bid.");
  if (specification.symbol !== symbol) throw new Error("MT5 symbol specification does not match requested symbol.");
  const specErrors = validateBrokerSymbolSpecification(specification);
  if (specErrors.length) throw new Error(`Invalid MT5 symbol specification: ${specErrors.join(" ")}`);
  if (!Array.isArray(candles) || candles.length === 0) throw new Error("MT5 returned no candles.");
  const historicalCandles = filterCompletedMt5Candles(candles, snapshot.timestamp, normalizedTimeframe);
  const excludedFormingCandle = historicalCandles.length < candles.length;

  return { snapshot, candles: historicalCandles, specification, excludedFormingCandle };
}


function mt5TimeframeIntervalMs(timeframe: string): number {
  const match = /^(M|H|D|W)(\d+)$/.exec(timeframe);
  if (!match) throw new Error(`Unsupported MT5 timeframe for completed-candle filtering: ${timeframe}`);
  const value = Number(match[2]);
  const unitMs = match[1] === "M" ? 60_000 : match[1] === "H" ? 3_600_000 : match[1] === "D" ? 86_400_000 : 604_800_000;
  return value * unitMs;
}
