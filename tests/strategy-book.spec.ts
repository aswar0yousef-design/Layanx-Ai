import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Mt5AutoScalper} from "../src/trading/mt5-auto-scalper.js";
import {DEFAULT_MT5_MAGIC,type Mt5LiveAdapter} from "../src/trading/mt5-live-adapter.js";
import {STRATEGIES} from "../src/trading/strategies.js";
import {enabledStrategies,loadStrategyBook,saveStrategyBook,type StrategyBook} from "../src/trading/strategy-book.js";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-book-"));
const stats={trades:30,winRate:50,netR:5,profitFactor:1.3,maxDrawdownR:-3,avgR:0.1};
const book:StrategyBook={measuredAt:"2026-11-13T10:00:00Z",source:"test",keepRule:{},entries:[
  {symbol:"XAUUSD",timeframe:"H1",strategy:"donchian-breakout",firstHalf:stats,secondHalf:stats,quartersPositive:3},
  {symbol:"ETHUSD",timeframe:"M5",strategy:"asian-mean-reversion",firstHalf:stats,secondHalf:stats,quartersPositive:4}]};
// The book is written and read back; the broker's "XAUUSD_" matches the plain name; other markets get nothing.
const file=path.join(dir,"book.json");saveStrategyBook(book,file);
assert.equal(loadStrategyBook(file)!.entries.length,2);
assert.deepEqual(enabledStrategies(book,"XAUUSD_","H1"),["donchian-breakout"]);
assert.deepEqual(enabledStrategies(book,"XAUUSD","M5"),[]);
assert.deepEqual(enabledStrategies(null,"XAUUSD","H1"),[]);

process.env.MT5_LIVE_TRADING_ENABLED="true";
const t0=Date.parse("2026-11-12T00:00:00Z");
const candles=Array.from({length:1200},(_,i)=>{const c=2400+i*0.05;return{timestamp:new Date(t0-(1200-i)*3600_000).toISOString(),open:c,high:c+1,low:c-1,close:c};});
let open:any[]=[];const orders:any[]=[];const closes:string[]=[];let now=new Date("2026-11-13T10:00:05Z");
const adapter={
  async connect(){return{login:1,server:"Demo",balance:50000,equity:50000,tradeMode:"demo"};},
  async history(){return[];},async findOrder(){return{found:false};},
  async positions(){return open;},async orders(){return[];},
  async getSymbolSnapshot(){return{symbol:"XAUUSD_",bid:2460,ask:2460.1,timestamp:now.toISOString()};},
  async getCandles(r:any){assert.equal(r.timeframe,"H1","only the book's timeframe is read");return candles;},
  async getSymbolSpecification(){return{broker:"Fake",accountType:"demo",symbol:"XAUUSD_",volumeMin:0.01,volumeStep:0.01,volumeMax:100,tickSize:0.01,tickValue:1};},
  async placeOrder(r:any){orders.push(r);return{accepted:true,brokerOrderId:"8001",clientOrderId:r.clientOrderId};},
  async closePosition(t:string){closes.push(t);open=[];return{accepted:true};},
  async modifyStopLoss(){return{accepted:false};},
  dispose(){}
} as unknown as Mt5LiveAdapter;
const statePath=path.join(dir,"s.json");

// No strategy fires: nothing is sent, and the same candle is not asked twice.
const original=STRATEGIES["donchian-breakout"];
let asked=0;STRATEGIES["donchian-breakout"]=(x,i)=>{asked++;return null;};
const robot=new Mt5AutoScalper({adapter,statePath,symbol:"XAUUSD",book,now:()=>now});
let s=await robot.checkOnce();assert.match(s.lastAction!,/no entry now from donchian-breakout H1/);
s=await robot.checkOnce();assert.equal(asked,1,"each closed candle is judged once");
// A market with no measured strategy opens nothing.
s=await new Mt5AutoScalper({adapter,statePath:path.join(dir,"o.json"),symbol:"EURUSD",book,now:()=>now}).checkOnce();
assert.match(s.lastAction!,/no measured strategy for EURUSD/);
// The strategy fires on a new candle: the order carries its stop (and no target: the trailing stop manages it).
candles.push({timestamp:new Date(Date.parse(candles.at(-1)!.timestamp)+3600_000).toISOString(),open:2460,high:2461,low:2459,close:2460});
STRATEGIES["donchian-breakout"]=()=>({action:"long",stopDistance:8,trail:true,closeHourUtc:21,reason:"test"});
s=await robot.checkOnce();
assert.match(s.lastAction!,/long order accepted \(donchian-breakout H1\): 8001/);
assert.equal(orders.length,1);assert.ok(Math.abs(orders[0].stopLossPrice-2452.1)<1e-9);assert.equal(orders[0].takeProfitPrice,undefined);
const st=JSON.parse(fs.readFileSync(statePath,"utf8"));assert.deepEqual(st.openedBy["8001"],{strategy:"donchian-breakout",timeframe:"H1",closeHourUtc:21});
// At the end of its session the trade is closed.
open=[{ticket:"8001",symbol:"XAUUSD_",side:"long",quantity:0.01,price:2460.1,stopLoss:2452.1,profit:1,magic:DEFAULT_MT5_MAGIC,openedAt:"2026-11-13T10:00:00Z"}];
now=new Date("2026-11-13T21:05:00Z");
s=await robot.checkOnce();assert.deepEqual(closes,["8001"]);assert.match(s.lastAction!,/closed at the end of its session/);
STRATEGIES["donchian-breakout"]=original;
fs.rmSync(dir,{recursive:true,force:true});
console.log("strategy-book: only measured strategies trade, each candle judged once, stop from the strategy, session close");
