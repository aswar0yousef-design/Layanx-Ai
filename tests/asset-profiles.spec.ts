import assert from "node:assert/strict";
import {PROFILES,assetClassOf,inTradingWindow,newYorkClock,pastSessionClose} from "../src/trading/asset-profiles.js";
import {currenciesFor,newsBlock} from "../src/trading/news-filter.js";
import {buildContext} from "../src/trading/strategies.js";
import {sessionRules} from "../src/trading/strategy-backtest.js";

// Each broker symbol belongs to its kind of market.
const cases:Array<[string,string]>=[["XAUUSD_","gold"],["XAGUSD_","silver"],["WTI","oil"],["BRENT","oil"],["BTCUSD","crypto"],["ETHUSD","crypto"],
  ["EURUSD_","forex"],["USDJPY_","forex"],["AAPL.US","us-stocks"],["TSLA.OQ","us-stocks"],["US500_SPOT","us-indices"],["US100_Spot","us-indices"]];
for(const [s,c] of cases)assert.equal(assetClassOf(s),c,s);
assert.deepEqual(currenciesFor("AAPL.US"),["USD"],"a stock is not a currency pair");
// New York time, daylight saving included: 14:30 UTC in November is 09:30 New York, in July it is 10:30.
assert.equal(newYorkClock(new Date("2026-11-13T14:30:00Z")).minute,9*60+30);
assert.equal(newYorkClock(new Date("2026-07-15T14:30:00Z")).minute,10*60+30);
// Stocks: not in the first 15 minutes, yes at 10:00, not after 15:30; closed from 15:50; never on Saturday.
assert.equal(inTradingWindow("us-stocks",new Date("2026-11-13T14:35:00Z")),false);
assert.equal(inTradingWindow("us-stocks",new Date("2026-11-13T15:00:00Z")),true);
assert.equal(inTradingWindow("us-stocks",new Date("2026-11-13T20:40:00Z")),false);
assert.equal(pastSessionClose("us-stocks",new Date("2026-11-13T20:51:00Z")),true);
assert.equal(pastSessionClose("us-stocks",new Date("2026-11-13T19:00:00Z")),false);
assert.equal(inTradingWindow("us-stocks",new Date("2026-11-14T15:00:00Z")),false,"Saturday");
// Crypto trades on Saturday at 03:00; gold and forex do not trade in the quiet Asian hours (23:00 New York).
assert.equal(inTradingWindow("crypto",new Date("2026-11-14T08:00:00Z")),true);
assert.equal(inTradingWindow("gold",new Date("2026-11-13T04:00:00Z")),false);
assert.equal(inTradingWindow("gold",new Date("2026-11-13T09:00:00Z")),true);
assert.equal(pastSessionClose("gold",new Date("2026-11-13T21:00:00Z")),false,"gold has no forced close");
// Oil also stays out of the weekly crude inventories report, rated medium by the calendar.
const inv=[{title:"Crude Oil Inventories",country:"USD",date:"2026-11-11T10:30:00-05:00",impact:"Medium"}];
assert.equal(newsBlock("WTI",new Date("2026-11-11T15:20:00Z"),inv,30,30,PROFILES.oil.extraNews)?.title,"Crude Oil Inventories");
assert.equal(newsBlock("XAUUSD_",new Date("2026-11-11T15:20:00Z"),inv,30,30,PROFILES.gold.extraNews),null,"gold does not care");
// The backtest uses the same hours: stocks never open at 09:35 New York and close at 15:50.
const c=Array.from({length:200},(_,k)=>{const t=Date.parse("2026-11-13T14:00:00Z")+k*300_000;return{timestamp:new Date(t).toISOString(),open:100,high:101,low:99,close:100};});
const x=buildContext(c,5),rules=sessionRules(x,"us-stocks");
const at=(iso:string)=>c.findIndex(k=>k.timestamp===new Date(iso).toISOString());
assert.equal(rules.open(at("2026-11-13T14:35:00Z")),false);assert.equal(rules.open(at("2026-11-13T15:00:00Z")),true);
assert.equal(rules.close(at("2026-11-13T20:50:00Z")),true);assert.equal(rules.close(at("2026-11-13T20:00:00Z")),false);
console.log("asset-profiles: market kinds, New York hours with daylight saving, stock session close, oil inventories, same rules in the backtest");
