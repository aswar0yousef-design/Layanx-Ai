import type { ToolDefinition } from "../tools/registry.js";
import type { ToolAdapter } from "../tools/executor.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolAdapterRegistry } from "../tools/adapters.js";
import type { MarketCandle } from "./scalping-signal.js";
import { runPaperScalping, type PaperTradingConfig } from "./paper-scalping.js";
import { createXauUsdPaperConfig } from "./xauusd-scalping-profile.js";
import { BinanceSpotClient } from "./binance-spot-client.js";
import { localSecret } from "../security/local-secret-vault.js";

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
 * Binance market-data access is read-only and does not require API credentials.
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

export const BINANCE_LIVE_ORDER_TOOL = "trading.binance.order";

const BINANCE_LIVE_ORDER_DEFINITION: ToolDefinition = {
  name: BINANCE_LIVE_ORDER_TOOL,
  description: "Submit an approved Binance Spot order. L4 execution: requires explicit runtime approval and BINANCE_LIVE_TRADING_ENABLED=true for production.",
  permission: "L4_EXECUTE",
  dangerous: true,
  actions: ["place-order"],
  tags: ["trading", "binance", "execution", "live"],
};

export function createBinanceLiveOrderToolAdapter(
  loadCredentials: (() => Promise<{apiKey:string;apiSecret:string}>) | undefined = undefined,
): ToolAdapter {
  return {
    async execute(request) {
      if (process.env.BINANCE_LIVE_TRADING_ENABLED !== "true") {
        throw new Error("Binance live execution is disabled. Set BINANCE_LIVE_TRADING_ENABLED=true only after approval and deployment readiness checks.");
      }
      const payload = request.payload as Partial<import("./binance-spot-client.js").BinanceOrderRequest> & { maxNotional?: unknown };
      if (typeof payload.symbol !== "string" || (payload.side !== "BUY" && payload.side !== "SELL") || (payload.type !== "MARKET" && payload.type !== "LIMIT")) throw new Error("Invalid Binance order payload.");
      if (typeof payload.quantity !== "number" || !Number.isFinite(payload.quantity) || payload.quantity <= 0) throw new Error("Order quantity must be positive.");
      if (payload.type === "LIMIT" && (typeof payload.price !== "number" || !Number.isFinite(payload.price) || payload.price <= 0)) throw new Error("Limit price must be positive.");
      const credentials=loadCredentials
        ? await loadCredentials()
        : (() => {
            const apiKey=localSecret("binance.apiKey",process.env.BINANCE_API_KEY);
            const apiSecret=localSecret("binance.apiSecret",process.env.BINANCE_API_SECRET);
            if(!apiKey||!apiSecret) throw new Error("Binance credentials are not configured in the encrypted local vault or deployment environment.");
            return {apiKey,apiSecret};
          })();
      const client = new BinanceSpotClient({
        apiKey: credentials.apiKey,
        apiSecret: credentials.apiSecret,
        baseUrl: process.env.BINANCE_BASE_URL ?? "https://api.binance.com",
        allowTrading: true,
        liveTradingEnabled: true,
      });
      const [ticker, rules] = await Promise.all([
        client.getTicker(payload.symbol),
        client.getSymbolRules(payload.symbol),
      ]);
      if (rules.status !== "TRADING") throw new Error(`Binance symbol is not trading: ${payload.symbol} (${rules.status}).`);
      const minQty = payload.type === "MARKET" ? (rules.marketMinQty ?? rules.minQty) : rules.minQty;
      const maxQty = payload.type === "MARKET" ? (rules.marketMaxQty ?? rules.maxQty) : rules.maxQty;
      const stepSize = payload.type === "MARKET" ? (rules.marketStepSize ?? rules.stepSize) : rules.stepSize;
      if (minQty !== undefined && payload.quantity < minQty) throw new Error("Order quantity is below Binance minimum quantity.");
      if (maxQty !== undefined && payload.quantity > maxQty) throw new Error("Order quantity exceeds Binance maximum quantity.");
      if (stepSize !== undefined && stepSize > 0) {
        const steps = payload.quantity / stepSize;
        if (Math.abs(steps - Math.round(steps)) > 1e-9) throw new Error("Order quantity does not match Binance quantity step size.");
      }
      if (payload.type === "LIMIT" && rules.tickSize !== undefined && rules.tickSize > 0 && payload.price !== undefined) {
        const ticks = payload.price / rules.tickSize;
        if (Math.abs(ticks - Math.round(ticks)) > 1e-9) throw new Error("Limit price does not match Binance price tick size.");
      }
      const referencePrice = payload.price ?? (payload.side === "BUY" ? ticker.askPrice : ticker.bidPrice);
      const notional = payload.quantity * referencePrice;
      if (rules.minNotional !== undefined && Number.isFinite(rules.minNotional) && notional < rules.minNotional) {
        throw new Error("Order notional is below Binance minimum notional.");
      }
      if (rules.maxNotional !== undefined && Number.isFinite(rules.maxNotional) && notional > rules.maxNotional) {
        throw new Error("Order notional exceeds Binance exchange maximum notional.");
      }
      const configuredMax = Number(process.env.BINANCE_MAX_ORDER_NOTIONAL ?? 0);
      if (!Number.isFinite(configuredMax) || configuredMax <= 0) throw new Error("BINANCE_MAX_ORDER_NOTIONAL must be a positive limit for live execution.");
      const requestedMax = typeof payload.maxNotional === "number" && Number.isFinite(payload.maxNotional) && payload.maxNotional > 0
        ? payload.maxNotional
        : configuredMax;
      const effectiveMax = Math.min(configuredMax, requestedMax);
      if (notional > effectiveMax) throw new Error("Order exceeds configured Binance maximum notional.");

      const clientOrderId = payload.clientOrderId ?? request.idempotencyKey;
      try {
        const result = await client.placeOrder({symbol:payload.symbol,side:payload.side,type:payload.type,quantity:payload.quantity,price:payload.price,clientOrderId});
        return { ...result, preflight: {referencePrice, notional, maxNotional: effectiveMax}, reconciliation: {status: "confirmed-by-submit"} };
      } catch (error) {
        try {
          const reconciled = await client.getOrder(payload.symbol, clientOrderId);
          return {
            submitted: true,
            testnet: false,
            orderId: reconciled.orderId,
            clientOrderId: reconciled.clientOrderId,
            status: reconciled.status,
            raw: reconciled.raw,
            preflight: {referencePrice, notional, maxNotional: effectiveMax},
            reconciliation: {status: "confirmed-by-lookup"},
          };
        } catch (lookupError) {
          throw new Error(
            `Binance order status is UNKNOWN for clientOrderId ${clientOrderId}; do not retry automatically. Original error: ${error instanceof Error ? error.message : "unknown"}; lookup error: ${lookupError instanceof Error ? lookupError.message : "unknown"}`,
          );
        }
      }
    },
  };
}

export function registerBinanceLiveOrderTool(tools: ToolRegistry, adapters: ToolAdapterRegistry): void {
  if (tools.list().some(tool => tool.name === BINANCE_LIVE_ORDER_TOOL)) return;
  tools.register(BINANCE_LIVE_ORDER_DEFINITION);
  adapters.register(BINANCE_LIVE_ORDER_TOOL, createBinanceLiveOrderToolAdapter());
}

export const LIVE_TRADING_TOOLS: readonly string[] = [BINANCE_LIVE_ORDER_TOOL];
