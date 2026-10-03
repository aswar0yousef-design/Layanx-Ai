import assert from "node:assert/strict";
import { BinanceSpotClient } from "../src/trading/binance-spot-client.js";
import { registerBinanceMarketDataTool, BINANCE_MARKET_DATA_TOOL } from "../src/trading/agent-integration.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { ToolAdapterRegistry } from "../src/tools/adapters.js";

const client=new BinanceSpotClient({baseUrl:"https://testnet.binance.vision"});
await assert.rejects(
  client.placeOrder({symbol:"BTCUSDT",side:"BUY",type:"MARKET",quantity:0.001}),
  /trading is disabled/
);
const liveGuard=new BinanceSpotClient({baseUrl:"https://api.binance.com",allowTrading:true});
await assert.rejects(
  liveGuard.placeOrder({symbol:"BTCUSDT",side:"BUY",type:"MARKET",quantity:0.001}),
  /Production Binance order submission is intentionally disabled/
);
console.log("binance-safety-boundary: ok");

{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes("/ticker/24hr")) return new Response(JSON.stringify({symbol:"BTCUSDT",bidPrice:"100",askPrice:"101",lastPrice:"100.5",closeTime:123}), {status:200});
    if (url.includes("/exchangeInfo")) return new Response(JSON.stringify({symbols:[{symbol:"BTCUSDT",status:"TRADING",baseAsset:"BTC",quoteAsset:"USDT",filters:[{filterType:"LOT_SIZE",minQty:"0.001",maxQty:"100",stepSize:"0.001"},{filterType:"MIN_NOTIONAL",minNotional:"5"}]}]}), {status:200});
    return new Response("not found",{status:404});
  }) as typeof fetch;
  try {
    const tools = new ToolRegistry(); const adapters = new ToolAdapterRegistry();
    registerBinanceMarketDataTool(tools, adapters);
    const result = await adapters.get(BINANCE_MARKET_DATA_TOOL).execute({payload:{symbol:"BTCUSDT"}} as any);
    assert.equal((result as any).ticker.bidPrice, 100);
    assert.equal((result as any).rules.stepSize, 0.001);
  } finally { globalThis.fetch = originalFetch; }
}

console.log("binance-market-data-adapter: ok");
