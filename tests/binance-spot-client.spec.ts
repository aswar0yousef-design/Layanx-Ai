import assert from "node:assert/strict";
import { BinanceSpotClient } from "../src/trading/binance-spot-client.js";
import { createBinanceLiveOrderToolAdapter, registerBinanceMarketDataTool, BINANCE_MARKET_DATA_TOOL } from "../src/trading/agent-integration.js";
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
  /Production Binance trading requires BINANCE_LIVE_TRADING_ENABLED=true/
);
console.log("binance-safety-boundary: ok");\n
assert.throws(() => new BinanceSpotClient({recvWindowMs:60001}), /between 1 and 60000/);
assert.throws(() => new BinanceSpotClient({timeoutMs:0}), /timeoutMs must be positive/);
console.log("binance-client-config-validation: ok");


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

{
  const originalFetch = globalThis.fetch;
  let observedMethod = "";
  globalThis.fetch = (async (_input, init) => {
    observedMethod = String(init?.method ?? "GET");
    return new Response(JSON.stringify({orderId:42,clientOrderId:"cid",status:"NEW"}), {status:200});
  }) as typeof fetch;
  try {
    const client = new BinanceSpotClient({baseUrl:"https://api.binance.com",allowTrading:true,liveTradingEnabled:true,apiKey:"k",apiSecret:"s"});
    const result = await client.placeOrder({symbol:"BTCUSDT",side:"BUY",type:"MARKET",quantity:0.001,clientOrderId:"cid"});
    assert.equal(result.submitted,true);
    assert.equal(result.testnet,false);
    assert.equal(result.orderId,42);
    assert.equal(observedMethod,"POST");
  } finally { globalThis.fetch = originalFetch; }
}
console.log("binance-production-order-client: ok");
{
  const unsafe = new BinanceSpotClient({baseUrl:"http://127.0.0.1:9999",allowTrading:true,liveTradingEnabled:true,apiKey:"k",apiSecret:"s"});
  await assert.rejects(
    unsafe.placeOrder({symbol:"BTCUSDT",side:"BUY",type:"MARKET",quantity:0.001}),
    /HTTPS api\.binance\.com/,
  );
}
console.log("binance-endpoint-safety: ok");



{
  const originalFlag = process.env.BINANCE_LIVE_TRADING_ENABLED;
  const originalMax = process.env.BINANCE_MAX_ORDER_NOTIONAL;
  const originalBase = process.env.BINANCE_BASE_URL;
  const originalFetch = globalThis.fetch;
  process.env.BINANCE_LIVE_TRADING_ENABLED = "true";
  process.env.BINANCE_MAX_ORDER_NOTIONAL = "200";
  process.env.BINANCE_BASE_URL = "https://api.binance.com";
  const calls: Array<{ method: string; url: string }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push({ method: String(init?.method ?? "GET"), url });
    if (url.includes("/ticker/24hr")) {
      return new Response(JSON.stringify({symbol:"BTCUSDT",bidPrice:"100",askPrice:"101",lastPrice:"100.5",closeTime:123}), {status:200});
    }
    if (url.includes("/exchangeInfo")) {
      return new Response(JSON.stringify({symbols:[{symbol:"BTCUSDT",status:"TRADING",baseAsset:"BTC",quoteAsset:"USDT",filters:[{filterType:"LOT_SIZE",minQty:"0.001",maxQty:"100",stepSize:"0.001"},{filterType:"MIN_NOTIONAL",minNotional:"5"}]}]}), {status:200});
    }
    return new Response(JSON.stringify({orderId:43,clientOrderId:"runtime-id",status:"NEW"}), {status:200});
  }) as typeof fetch;
  try {
    const adapter = createBinanceLiveOrderToolAdapter(async () => ({apiKey:"k",apiSecret:"s"}));
    const result = await adapter.execute({
      missionId:"m",
      agentId:"a",
      tool:"trading.binance.order",
      action:"place-order",
      permission:"L4_EXECUTE",
      idempotencyKey:"runtime-id",
      payload:{symbol:"BTCUSDT",side:"BUY",type:"MARKET",quantity:0.001},
    } as any);
    assert.equal((result as any).submitted, true);
    assert.equal((result as any).preflight.notional, 0.101);
    assert.equal(calls.some(call => call.method === "POST" && call.url.includes("/api/v3/order?")), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalFlag === undefined) delete process.env.BINANCE_LIVE_TRADING_ENABLED; else process.env.BINANCE_LIVE_TRADING_ENABLED = originalFlag;
    if (originalMax === undefined) delete process.env.BINANCE_MAX_ORDER_NOTIONAL; else process.env.BINANCE_MAX_ORDER_NOTIONAL = originalMax;
    if (originalBase === undefined) delete process.env.BINANCE_BASE_URL; else process.env.BINANCE_BASE_URL = originalBase;
  }
}

console.log("binance-live-adapter-preflight: ok");


{
  const originalFlag=process.env.BINANCE_LIVE_TRADING_ENABLED;
  const originalMax=process.env.BINANCE_MAX_ORDER_NOTIONAL;
  const originalBase=process.env.BINANCE_BASE_URL;
  const originalFetch=globalThis.fetch;
  process.env.BINANCE_LIVE_TRADING_ENABLED="true";
  process.env.BINANCE_MAX_ORDER_NOTIONAL="200";
  process.env.BINANCE_BASE_URL="https://api.binance.com";
  globalThis.fetch=(async (input,init)=>{
    const url=String(input);
    const method=String(init?.method??"GET");
    if(url.includes("/ticker/24hr")) return new Response(JSON.stringify({symbol:"BTCUSDT",bidPrice:"100",askPrice:"101",lastPrice:"100.5",closeTime:123}),{status:200});
    if(url.includes("/exchangeInfo")) return new Response(JSON.stringify({symbols:[{symbol:"BTCUSDT",status:"TRADING",baseAsset:"BTC",quoteAsset:"USDT",filters:[{filterType:"LOT_SIZE",minQty:"0.001",maxQty:"100",stepSize:"0.001"},{filterType:"MIN_NOTIONAL",minNotional:"5"}]}]}),{status:200});
    if(method==="POST") return new Response("network timeout",{status:503});
    return new Response(JSON.stringify({symbol:"BTCUSDT",orderId:77,clientOrderId:"runtime-reconcile",status:"NEW"}),{status:200});
  }) as typeof fetch;
  try {
    const adapter=createBinanceLiveOrderToolAdapter(async()=>({apiKey:"k",apiSecret:"s"}));
    const result=await adapter.execute({missionId:"m",agentId:"a",tool:"trading.binance.order",action:"place-order",permission:"L4_EXECUTE",idempotencyKey:"runtime-reconcile",payload:{symbol:"BTCUSDT",side:"BUY",type:"MARKET",quantity:0.001}} as any);
    assert.equal((result as any).submitted,true);
    assert.equal((result as any).orderId,77);
    assert.equal((result as any).reconciliation.status,"confirmed-by-lookup");
  } finally {
    globalThis.fetch=originalFetch;
    if(originalFlag===undefined) delete process.env.BINANCE_LIVE_TRADING_ENABLED; else process.env.BINANCE_LIVE_TRADING_ENABLED=originalFlag;
    if(originalMax===undefined) delete process.env.BINANCE_MAX_ORDER_NOTIONAL; else process.env.BINANCE_MAX_ORDER_NOTIONAL=originalMax;
    if(originalBase===undefined) delete process.env.BINANCE_BASE_URL; else process.env.BINANCE_BASE_URL=originalBase;
  }
}
console.log("binance-order-reconciliation: ok");

{
  const originalFlag=process.env.BINANCE_LIVE_TRADING_ENABLED;
  const originalMax=process.env.BINANCE_MAX_ORDER_NOTIONAL;
  const originalBase=process.env.BINANCE_BASE_URL;
  const originalFetch=globalThis.fetch;
  process.env.BINANCE_LIVE_TRADING_ENABLED="true";
  process.env.BINANCE_MAX_ORDER_NOTIONAL="200";
  process.env.BINANCE_BASE_URL="https://api.binance.com";
  globalThis.fetch=(async (input,init)=>{
    const url=String(input);
    const method=String(init?.method??"GET");
    if(url.includes("/ticker/24hr")) return new Response(JSON.stringify({symbol:"BTCUSDT",bidPrice:"100",askPrice:"101",lastPrice:"100.5",closeTime:123}),{status:200});
    if(url.includes("/exchangeInfo")) return new Response(JSON.stringify({symbols:[{symbol:"BTCUSDT",status:"TRADING",baseAsset:"BTC",quoteAsset:"USDT",filters:[{filterType:"LOT_SIZE",minQty:"0.001",maxQty:"100",stepSize:"0.001"},{filterType:"MIN_NOTIONAL",minNotional:"5"}]}]}),{status:200});
    if(method==="POST") return new Response("network timeout",{status:503});
    return new Response("order not found",{status:404});
  }) as typeof fetch;
  try {
    const adapter=createBinanceLiveOrderToolAdapter(async()=>({apiKey:"k",apiSecret:"s"}));
    await assert.rejects(
      adapter.execute({missionId:"m",agentId:"a",tool:"trading.binance.order",action:"place-order",permission:"L4_EXECUTE",idempotencyKey:"runtime-unknown",payload:{symbol:"BTCUSDT",side:"BUY",type:"MARKET",quantity:0.001}} as any),
      /status is UNKNOWN.*do not retry automatically/,
    );
  } finally {
    globalThis.fetch=originalFetch;
    if(originalFlag===undefined) delete process.env.BINANCE_LIVE_TRADING_ENABLED; else process.env.BINANCE_LIVE_TRADING_ENABLED=originalFlag;
    if(originalMax===undefined) delete process.env.BINANCE_MAX_ORDER_NOTIONAL; else process.env.BINANCE_MAX_ORDER_NOTIONAL=originalMax;
    if(originalBase===undefined) delete process.env.BINANCE_BASE_URL; else process.env.BINANCE_BASE_URL=originalBase;
  }
}
console.log("binance-order-unknown-safety: ok");
