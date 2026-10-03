import type { ToolDefinition } from "../tools/registry.js";
import type { ToolAdapter } from "../tools/executor.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolAdapterRegistry } from "../tools/adapters.js";
import type { MarketCandle } from "./scalping-signal.js";
import { runPaperScalping, type PaperTradingConfig } from "./paper-scalping.js";
import { createXauUsdPaperConfig } from "./xauusd-scalping-profile.js";
import { BinanceSpotClient } from "./binance-spot-client.js";

export const PAPER_TRADING_TOOL = "trading.paper.backtest";

export interface PaperTradingToolPayload {
  candles: MarketCandle[];
  config: Omit<PaperTradingConfig, "symbol" | "timeframe" | "intrabarResolution">;
}

const PAPER_TRADING_DEFINITION: ToolDefinition = {
  name: PAPER_TRADING_TOOL,
  description: "Run XAUUSD M1 paper trading against supplied historical candles. Analysis-only: never submits a broker or exchange order.",
  permission: "L2_ANALYZE",
  dangerous: false,
  actions: ["paper-backtest"],
  tags: ["trading", "paper", "xauusd", "m1", "analysis"],
};

function parsePayload(payload: unknown): PaperTradingToolPayload {
  if (!payload || typeof payload !== "object") throw new Error("Paper trading payload must be an object.");
  const value = payload as Record<string, unknown>;
  if (!Array.isArray(value.candles)) throw new Error("Paper trading requires candles.");
  if (!value.config || typeof value.config !== "object") throw new Error("Paper trading requires a config.");
  return {
    candles: value.candles as MarketCandle[],
    config: value.config as PaperTradingToolPayload["config"],
  };
}

export function createPaperTradingToolAdapter(): ToolAdapter {
  return {
    async execute(request) {
      const payload = parsePayload(request.payload);
      const config = createXauUsdPaperConfig(payload.config);
      const result = runPaperScalping(payload.candles, config);
      return {
        mode: "paper",
        liveOrderSubmitted: false,
        exchangeOrderSubmitted: false,
        result,
      };
    },
  };
}

export function registerPaperTradingAgentTool(
  tools: ToolRegistry,
  adapters: ToolAdapterRegistry,
): void {
  if (tools.list().some(tool => tool.name === PAPER_TRADING_TOOL)) return;
  tools.register(PAPER_TRADING_DEFINITION);
  adapters.register(PAPER_TRADING_TOOL, createPaperTradingToolAdapter());
}

/**
 * Deliberately empty: no live-broker, Binance, or real-money execution tool is
 * registered by the trading layer. Adding one requires a separate security review.
 */
export const BINANCE_MARKET_DATA_TOOL = "trading.binance.market-data";

const BINANCE_MARKET_DATA_DEFINITION: ToolDefinition = {
  name: BINANCE_MARKET_DATA_TOOL,
  description: "Read Binance Spot market data and exchange symbol rules. No order submission.",
  permission: "L1_READ",
  dangerous: false,
  actions: ["market-data"],
  tags: ["trading", "binance", "market-data"],
};

export function registerBinanceMarketDataTool(tools: ToolRegistry, adapters: ToolAdapterRegistry): void {
  if (tools.list().some(tool => tool.name === BINANCE_MARKET_DATA_TOOL)) return;
  tools.register(BINANCE_MARKET_DATA_DEFINITION);
  adapters.register(BINANCE_MARKET_DATA_TOOL, {
    async execute(request) {
      const payload = request.payload as { symbol?: unknown };
      if (typeof payload?.symbol !== "string" || !payload.symbol) throw new Error("Binance market data requires a symbol.");
      const client = new BinanceSpotClient({
        apiKey: process.env.BINANCE_API_KEY,
        apiSecret: process.env.BINANCE_API_SECRET,
        baseUrl: process.env.BINANCE_BASE_URL ?? "https://api.binance.com",
      });
      const [ticker, rules] = await Promise.all([
        client.getTicker(payload.symbol),
        client.getSymbolRules(payload.symbol),
      ]);
      return { submitted: false, marketDataOnly: true, ticker, rules };
    },
  });
}

export const LIVE_TRADING_TOOLS: readonly string[] = [];
