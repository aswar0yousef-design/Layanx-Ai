import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Mt5AutoScalper} from "../src/trading/mt5-auto-scalper.js";
import {DEFAULT_MT5_MAGIC,type Mt5LiveAdapter,type Mt5ClosedDeal} from "../src/trading/mt5-live-adapter.js";
import {STRATEGIES} from "../src/trading/strategies.js";
import type {StrategyBook} from "../src/trading/strategy-book.js";
process.env.LAYANX_TRADE_JOURNAL=(await import("node:path")).join((await import("node:os")).tmpdir(),"lx-journal-"+process.pid+".jsonl");   // never the owner's journal
process.env.MT5_NEWS_FILTER="off";   // no network in this test (the news check has its own spec)

// Real-capital mode: on a big demo account the robot sizes and limits itself as if it held only the owner's real money,
// and counts only its own trades (other robots' losses on the same account do not move its limits).
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-capital-"));
process.env.MT5_LIVE_TRADING_ENABLED="true";process.env.MT5_SCALP_RISK_PERCENT="1";
const stats={trades:30,winRate:50,netR:5,profitFactor:1.3,maxDrawdownR:-3,avgR:0.1};
const book:StrategyBook={measuredAt:"x",source:"t",keepRule:{},entries:[{symbol:"BTCUSD",timeframe:"M15",strategy:"macd-momentum",firstHalf:stats,secondHalf:stats,quartersPositive:3}]};
const t0=Date.parse("2026-11-13T00:00:00Z");
const candles=Array.from({length:1200},(_,i)=>({timestamp:new Date(t0-(1200-i)*900_000).toISOString(),open:68000,high:68300,low:67700,close:68000}));
let equity=50_000,deals:Mt5ClosedDeal[]=[],open:any[]=[];const orders:any[]=[];
const adapter={
  async connect(){return{login:1,server:"Demo",balance:equity,equity,tradeMode:"demo"};},
  async history(){return deals;},async findOrder(){return{found:false};},
  async positions(){return open;},async orders(){return[];},
  async getSymbolSnapshot(){return{symbol:"BTCUSD",bid:68000,ask:68020,timestamp:new Date(t0+5000).toISOString()};},
  async getCandles(){return candles;},
  async getSymbolSpecification(){return{broker:"Fake",accountType:"demo",symbol:"BTCUSD",volumeMin:0.001,volumeStep:0.001,volumeMax:10,tickSize:0.01,tickValue:0.01};},
  async placeOrder(r:any){orders.push(r);return{accepted:true,brokerOrderId:String(9000+orders.length),clientOrderId:r.clientOrderId};},
  async modifyStopLoss(){return{accepted:false};},dispose(){}
} as unknown as Mt5LiveAdapter;
const original=STRATEGIES["macd-momentum"];
STRATEGIES["macd-momentum"]=()=>({action:"long",stopDistance:400,trail:true,reason:"test"});
const robot=new Mt5AutoScalper({adapter,statePath:path.join(dir,"s.json"),symbol:"BTCUSD",book,capital:320,now:()=>new Date(t0+5000)});
let s=await robot.checkOnce();
// 1% of 320 = 3.2 dollars at a 400-dollar stop: 0.008 BTC (on the 50,000 demo balance it would have been 1.25 BTC).
assert.equal(orders.length,1);assert.equal(orders[0].quantity,0.008,JSON.stringify(orders[0]));assert.equal(s.capitalEquity,320);
// Another robot loses 2,000 dollars on the same account: LayanX's limits do not move.
equity=48_000;candles.push({...candles.at(-1)!,timestamp:new Date(t0+900_000).toISOString()});
open=[{ticket:"9001",symbol:"BTCUSD",side:"long",quantity:0.008,price:68020,stopLoss:67620,profit:-1.5,magic:DEFAULT_MT5_MAGIC}];
s=await robot.checkOnce();assert.equal(s.dailyPnl,-1.5,"only its own open trade counts");assert.equal(s.capitalEquity,318.5);
// Its own losses do count (counting began at the first check): three losing closes, 9.7 > 2% of 320, stop new entries.
open=[];deals=[{ticket:"500",positionId:"9001",symbol:"BTCUSD",closedAt:"2026-11-13T01:00:00+00:00",quantity:0.008,price:67620,profit:-3.2,commission:0,swap:0,magic:DEFAULT_MT5_MAGIC,comment:""}];
deals.push({ticket:"501",positionId:"9002",symbol:"BTCUSD",closedAt:"2026-11-13T02:00:00+00:00",quantity:0.008,price:67620,profit:-3.2,commission:0,swap:0,magic:DEFAULT_MT5_MAGIC,comment:""},
           {ticket:"502",positionId:"9003",symbol:"BTCUSD",closedAt:"2026-11-13T03:00:00+00:00",quantity:0.008,price:67620,profit:-3.3,commission:0,swap:0,magic:DEFAULT_MT5_MAGIC,comment:""});
s=await robot.checkOnce();
assert.equal(s.capitalEquity,310.3);assert.match(s.lastAction!,/daily loss limit reached/);
// Another robot's trade on the same market (another magic number) does not stop LayanX from entering in this mode.
{
  const d2=fs.mkdtempSync(path.join(os.tmpdir(),"lx-capital2-"));
  open=[{ticket:"77",symbol:"BTCUSD",side:"short",quantity:0.5,price:68100,stopLoss:69000,profit:-4,magic:6660001,comment:"CM_MACD_M15"}];deals=[];
  const before=orders.length;
  const other=new Mt5AutoScalper({adapter,statePath:path.join(d2,"s.json"),symbol:"BTCUSD",book,capital:320,now:()=>new Date(t0+5000)});
  const s2=await other.checkOnce();
  assert.equal(orders.length,before+1,"entered beside the other robot's trade: "+s2.lastAction);
  fs.rmSync(d2,{recursive:true,force:true});
}
STRATEGIES["macd-momentum"]=original;delete process.env.MT5_SCALP_RISK_PERCENT;
fs.rmSync(dir,{recursive:true,force:true});
console.log("real-capital: sized on the owner's real capital, only LayanX's own trades move its limits");
