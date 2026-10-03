import assert from "node:assert/strict";
import { BinanceSpotClient } from "../src/trading/binance-spot-client.js";

const client=new BinanceSpotClient({baseUrl:"https://testnet.binance.vision",apiKey:"test-key",apiSecret:"test-secret"});
await assert.rejects(
  client.placeOrder({symbol:"BTCUSDT",side:"BUY",type:"MARKET",quantity:0.001}),
  /trading is disabled/
);
const liveGuard=new BinanceSpotClient({baseUrl:"https://api.binance.com",apiKey:"x",apiSecret:"y",allowTrading:true});
await assert.rejects(
  liveGuard.placeOrder({symbol:"BTCUSDT",side:"BUY",type:"MARKET",quantity:0.001}),
  /Production Binance order submission is intentionally disabled/
);
console.log("binance-safety-boundary: ok");
