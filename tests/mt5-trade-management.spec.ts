import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Mt5AutoScalper} from "../src/trading/mt5-auto-scalper.js";
import {DEFAULT_MT5_MAGIC,type Mt5LiveAdapter} from "../src/trading/mt5-live-adapter.js";

// The robot follows its open trades: breakeven at 1R, then a trailing stop that only moves forward; the owner's own trades
// (another magic number) are never touched.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-manage-"));
process.env.MT5_LIVE_TRADING_ENABLED="true";
let bid=2400,sl=2394;const modifies:Array<{ticket:string;stop:number}>=[];
// Candles 1 apart high-low: ATR = 1.
const candles=Array.from({length:60},(_,i)=>({timestamp:new Date(Date.UTC(2026,10,13,9,i)).toISOString(),open:2400,high:2400.5,low:2399.5,close:2400,volume:1}));
const positions=()=>[
  {ticket:"7001",symbol:"XAUUSD_",side:"long",quantity:0.01,price:2400,stopLoss:sl,takeProfit:2412,profit:0,magic:DEFAULT_MT5_MAGIC},
  {ticket:"9",symbol:"XAUUSD_",side:"long",quantity:0.5,price:2390,stopLoss:2385,profit:50,magic:0,comment:"owner's own trade"}
];
const adapter={
  async connect(){return{login:1,server:"Demo",balance:1000,equity:1000,tradeMode:"demo"};},
  async history(){return[];},
  async findOrder(){return{found:false};},
  async positions(){return positions();},
  async orders(){return[];},
  async getSymbolSnapshot(){return{symbol:"XAUUSD_",bid,ask:bid+0.2,timestamp:new Date().toISOString()};},
  async getCandles(){return candles;},
  async modifyStopLoss(ticket:string,stop:number){modifies.push({ticket,stop});sl=stop;return{accepted:true,stopLoss:stop};},
  dispose(){}
} as unknown as Mt5LiveAdapter;
const robot=new Mt5AutoScalper({adapter,statePath:path.join(dir,"s.json"),symbol:"XAUUSD",book:null});

// R = 6. At +3 nothing moves.
bid=2403;let s=await robot.checkOnce();
assert.match(s.lastAction!,/#7001 stop kept/);assert.equal(modifies.length,0);
// At +6.5 (1R): breakeven, entry plus spread.
bid=2406.5;s=await robot.checkOnce();
assert.equal(modifies.length,1);assert.ok(Math.abs(modifies[0]!.stop-2400.2)<1e-9);assert.match(s.lastAction!,/breakeven/);
// At +15: trails 1.5 ATR behind.
bid=2415;s=await robot.checkOnce();
assert.equal(modifies.at(-1)!.stop,2413.5);assert.match(s.lastAction!,/trail/);
// Price falls back: no move back.
bid=2414;s=await robot.checkOnce();
assert.equal(modifies.length,2,"the stop never goes back");
// The owner's trade was never touched.
assert.ok(modifies.every(m=>m.ticket==="7001"));
// The first stop survives a restart (R stays 6, not the locked stop).
const saved=JSON.parse(fs.readFileSync(path.join(dir,"s.json"),"utf8"));assert.equal(saved.initialStops["7001"],2394);
// Switched off: nothing is moved.
process.env.MT5_TRAILING_STOP="off";bid=2430;s=await robot.checkOnce();assert.equal(modifies.length,2);delete process.env.MT5_TRAILING_STOP;
fs.rmSync(dir,{recursive:true,force:true});
console.log("mt5-trade-management: breakeven at 1R, trailing stop forward only, the owner's trades untouched, first stop kept");
