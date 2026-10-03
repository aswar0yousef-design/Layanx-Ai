import assert from "node:assert/strict";
import {Mt5LiveAdapter} from "../src/trading/mt5-live-adapter.js";
import {Mt5AutoScalper} from "../src/trading/mt5-auto-scalper.js";

process.env.MT5_LIVE_TRADING_ENABLED="false";
const adapter=new Mt5LiveAdapter({bridgePath:"scripts/mt5-bridge.py"});
await assert.rejects(
 () => adapter.placeOrder({symbol:"XAUUSD",side:"long",quantity:0.01}),
 /MT5 live execution is disabled/,
);

const scalper=new Mt5AutoScalper({symbol:"XAUUSD",timeframe:"M1",intervalMs:60_000,statePath:".layanx/test-mt5-scalper.json"});
assert.equal(scalper.status().running,false);
assert.equal(scalper.status().symbol,"XAUUSD");
assert.equal(scalper.status().timeframe,"M1");
console.log("MT5 live execution safety tests passed");
