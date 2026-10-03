import type { MarketCandle } from "./scalping-signal.js";

export interface HistoricalCandleSource {
  source: string;
  format: "csv" | "json";
  symbol: string;
  timeframe: string;
  candles: MarketCandle[];
}

function finiteNumber(value: unknown, field: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid ${field}: ${String(value)}`);
  return number;
}

function normalizeCandle(row: Record<string, unknown>): MarketCandle {
  const timestamp = String(row.timestamp ?? row.time ?? row.datetime ?? "");
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    throw new Error(`Invalid candle timestamp: ${timestamp}`);
  }

  const open = finiteNumber(row.open ?? row.o, "open");
  const high = finiteNumber(row.high ?? row.h, "high");
  const low = finiteNumber(row.low ?? row.l, "low");
  const close = finiteNumber(row.close ?? row.c, "close");
  const volumeValue = row.volume ?? row.vol ?? row.tick_volume;
  const volume = volumeValue === undefined ? undefined : finiteNumber(volumeValue, "volume");
  const bidValue = row.bid ?? row.bid_price ?? row.bidprice;
  const askValue = row.ask ?? row.ask_price ?? row.askprice;
  const bid = bidValue === undefined ? undefined : finiteNumber(bidValue, "bid");
  const ask = askValue === undefined ? undefined : finiteNumber(askValue, "ask");
  if ((bid !== undefined && bid <= 0) || (ask !== undefined && ask <= 0)) {
    throw new Error(`Bid and ask must be positive at ${timestamp}`);
  }
  if (bid !== undefined && ask !== undefined && ask < bid) {
    throw new Error(`Ask cannot be below bid at ${timestamp}`);
  }

  if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
    throw new Error(`Invalid OHLC range at ${timestamp}`);
  }

  return { timestamp: new Date(timestamp).toISOString(), open, high, low, close, volume, bid, ask };
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += char;
    }
  }

  if (quoted) throw new Error("Unclosed CSV quote.");
  values.push(value.trim());
  return values;
}

export function importHistoricalCsv(
  csv: string,
  metadata: { source?: string; symbol: string; timeframe: string },
): HistoricalCandleSource {
  const lines = csv.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error("CSV must contain a header and at least one row.");

  const headers = parseCsvLine(lines[0]).map(header => header.toLowerCase());
  const candles = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    if (values.length !== headers.length) throw new Error("CSV row does not match header length.");
    return normalizeCandle(Object.fromEntries(headers.map((header, index) => [header, values[index]])));
  });

  return {
    source: metadata.source ?? "csv",
    format: "csv",
    symbol: metadata.symbol,
    timeframe: metadata.timeframe,
    candles: sortAndValidateCandles(candles),
  };
}

export function importHistoricalJson(
  input: string | unknown[],
  metadata: { source?: string; symbol: string; timeframe: string },
): HistoricalCandleSource {
  const value = typeof input === "string" ? JSON.parse(input) : input;
  if (!Array.isArray(value)) throw new Error("Historical JSON must be an array.");

  const candles = value.map(row => {
    if (!row || typeof row !== "object") throw new Error("Each JSON candle must be an object.");
    return normalizeCandle(row as Record<string, unknown>);
  });

  return {
    source: metadata.source ?? "json",
    format: "json",
    symbol: metadata.symbol,
    timeframe: metadata.timeframe,
    candles: sortAndValidateCandles(candles),
  };
}

function sortAndValidateCandles(candles: MarketCandle[]): MarketCandle[] {
  const sorted = [...candles].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );

  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].timestamp === sorted[i - 1].timestamp) {
      throw new Error(`Duplicate candle timestamp: ${sorted[i].timestamp}`);
    }
  }

  return sorted;
}
