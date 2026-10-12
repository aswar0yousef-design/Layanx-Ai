import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Mt5AutoScalper} from "../src/trading/mt5-auto-scalper.js";
import {Mt5UnknownOutcomeError,type Mt5LiveAdapter,type Mt5ClosedDeal} from "../src/trading/mt5-live-adapter.js";

// The auto-scalper's day: limits survive a restart, start again at midnight (UTC), and a losing streak
// pauses trading. Before the fix tradesToday lived only in memory (a restart reset it), nothing was
// reset at midnight, and consecutiveLosses was never updated.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-scalper-"));
const statePath=path.join(dir,"state.json");
let equity=10000;let deals:Mt5ClosedDeal[]=[];let open=0;let found:string|null=null;const calls:string[]=[];let working:unknown[]=[];
const adapter={
  async connect(){calls.push("connect");return{login:1,server:"Demo",balance:equity,equity,tradeMode:"demo"};},
  async history(){calls.push("history");return deals;},
  async findOrder(id:string){calls.push("find:"+id);return id===found?{found:true,ticket:"55",price:1,quantity:0.01}:{found:false};},
  async positions(){calls.push("positions");return Array.from({length:open},(_,i)=>({ticket:String(i),symbol:"XAUUSD",side:"long",quantity:0.01,price:1,profit:0}));},
  async orders(){calls.push("orders");return working;},
  async getSymbolSnapshot(){throw new Error("not reached in this test");},
  dispose(){calls.push("dispose");}
} as unknown as Mt5LiveAdapter;
const deal=(ticket:number,profit:number,day:string):Mt5ClosedDeal=>({ticket:String(ticket),positionId:String(ticket),symbol:"XAUUSD",closedAt:`${day}T10:00:00+00:00`,quantity:0.01,price:1,profit,commission:-0.5,swap:0,magic:2601004,comment:""});
let now=new Date("2026-10-12T09:00:00Z");
const make=()=>new Mt5AutoScalper({adapter,statePath,intervalMs:60_000,now:()=>now});
open=1;

// 1. First check of the day: today's equity is the starting point; old deals are not counted as a streak.
deals=[deal(100,-10,"2026-10-11"),deal(101,-10,"2026-10-11")];
let s=await make().checkOnce();
assert.equal(s.lastAction,"position already open; no new entry",JSON.stringify(s));
assert.equal(s.consecutiveLosses,0,"deals from before LayanX looked are history, not a streak");
let saved=JSON.parse(fs.readFileSync(statePath,"utf8"));
assert.deepEqual([saved.date,saved.startEquity,saved.lastDealTicket],["2026-10-12",10000,101]);

// 2. Three losing LayanX trades today (fees count) pause trading; a win would have reset the count.
//    106 carries the broker server's date (UTC+3: already "tomorrow"); it still counts.
deals.push(deal(102,-3,"2026-10-12"),deal(103,2,"2026-10-12"),deal(105,-2,"2026-10-12"),deal(106,-4,"2026-10-13"),deal(104,0.2,"2026-10-12"));
s=await make().checkOnce();
assert.equal(s.consecutiveLosses,3,"102 lost, 103 won (reset), 104 lost after fees (0.2 - 0.5), 105 and 106 lost: "+s.consecutiveLosses);
assert.match(s.lastAction!,/3 losing trades in a row; trading paused until tomorrow/);

// 3. Trades counted today survive a restart.
saved=JSON.parse(fs.readFileSync(statePath,"utf8"));fs.writeFileSync(statePath,JSON.stringify({...saved,tradesToday:20,consecutiveLosses:0,lastDealTicket:106}));
s=await make().checkOnce();
assert.equal(s.tradesToday,20);
assert.equal(s.lastAction,"daily trade limit reached; trading paused until tomorrow","a restart does not reset the limit");

// 4. Midnight: a new day, new limits, today's equity as the start.
now=new Date("2026-10-13T00:00:30Z");equity=9800;
s=await make().checkOnce();
assert.deepEqual([s.tradesToday,s.consecutiveLosses,s.dailyPnl],[0,0,0]);
assert.equal(s.lastAction,"position already open; no new entry","trading allowed again");
assert.equal(JSON.parse(fs.readFileSync(statePath,"utf8")).startEquity,9800);

// 5. Daily loss limit (2% of the day's starting equity, fees and open trades included).
equity=9800*0.979;
s=await make().checkOnce();
assert.equal(s.lastAction,"daily loss limit reached; trading paused until tomorrow");
equity=9800;

// 6. An order whose answer was lost is checked on the account before any new entry.
saved=JSON.parse(fs.readFileSync(statePath,"utf8"));fs.writeFileSync(statePath,JSON.stringify({...saved,pendingClientOrderId:"lxabc"}));
found="lxabc";
s=await make().checkOnce();
assert.match(s.lastAction!,/earlier order lxabc confirmed on the account \(ticket 55\); no new entry this check/);
assert.equal(s.tradesToday,1,"counted once");
assert.equal(JSON.parse(fs.readFileSync(statePath,"utf8")).pendingClientOrderId,undefined);
saved=JSON.parse(fs.readFileSync(statePath,"utf8"));fs.writeFileSync(statePath,JSON.stringify({...saved,pendingClientOrderId:"lxgone"}));
s=await make().checkOnce();
assert.match(s.lastAction!,/waiting to confirm earlier order lxgone; no new entry yet/,"a late fill gets a second look");
s=await make().checkOnce();
assert.equal(s.tradesToday,1,"not on the account after two checks: not counted, and the scalper goes on");
assert.equal(s.lastAction,"position already open; no new entry");
assert.equal(JSON.parse(fs.readFileSync(statePath,"utf8")).pendingClientOrderId,undefined);

// 7. The order path, with a market that gives a long signal.
const t0=Date.parse("2026-10-13T08:00:00Z");
const candles=Array.from({length:120},(_,i)=>{const close=2400+i*0.3+(i%2?-0.35:0.35);return{timestamp:new Date(t0+i*60000).toISOString(),open:close-0.1,high:close+0.6,low:close-0.6,close};});
const market=adapter as any;open=0;
market.getSymbolSnapshot=async()=>({symbol:"XAUUSD",bid:candles.at(-1)!.close,ask:candles.at(-1)!.close+0.05,timestamp:new Date(t0+120*60000+5000).toISOString()});
market.getCandles=async()=>candles;
market.getSymbolSpecification=async()=>({broker:"Fake",accountType:"demo",symbol:"XAUUSD",volumeMin:0.01,volumeStep:0.01,volumeMax:100,tickSize:0.01,tickValue:1});
const fresh=()=>{const st=JSON.parse(fs.readFileSync(statePath,"utf8"));fs.writeFileSync(statePath,JSON.stringify({...st,tradesToday:0,consecutiveLosses:0,pendingClientOrderId:undefined,lastSignalTimestamp:undefined}));};
// a. The order's tag is saved before it is sent, and cleared when it is accepted.
fresh();let pendingAtSend:string|undefined;let sentId="";
market.placeOrder=async(r:any)=>{pendingAtSend=JSON.parse(fs.readFileSync(statePath,"utf8")).pendingClientOrderId;sentId=r.clientOrderId;return{accepted:true,brokerOrderId:"77",clientOrderId:r.clientOrderId};};
s=await make().checkOnce();
assert.equal(s.lastAction,"long order accepted: 77",JSON.stringify(s));
assert.equal(pendingAtSend,sentId,"saved before sending: a crash or stop while sending is checked on the next run");
assert.equal(JSON.parse(fs.readFileSync(statePath,"utf8")).pendingClientOrderId,undefined);
assert.equal(s.tradesToday,1);
// b. An unknown outcome keeps the tag for the next check.
fresh();market.placeOrder=async(r:any)=>{throw new Mt5UnknownOutcomeError(r.clientOrderId,"bridge stopped");};
s=await make().checkOnce();
assert.equal(s.lastAction,"order outcome unknown; it is checked on the account before any new entry");
assert.match(JSON.parse(fs.readFileSync(statePath,"utf8")).pendingClientOrderId,/^lx/);
// c. An explicit no from the broker: nothing pending, the error is reported.
fresh();market.placeOrder=async()=>({accepted:false,message:"Unsupported filling mode"});
s=await make().checkOnce();
assert.equal(s.lastError,"Unsupported filling mode");
assert.equal(JSON.parse(fs.readFileSync(statePath,"utf8")).pendingClientOrderId,undefined);
// c2. An order still being filled counts as open: no second entry.
fresh();working=[{ticket:"9",symbol:"XAUUSD",quantity:0.14,magic:2601004,comment:"LX:x"}];
s=await make().checkOnce();
assert.equal(s.lastAction,"an order is still being filled; no new entry");
working=[];
// d. Stop while a check is running: no order is sent after it (the review sent one after stop()).
// The adapter is asked again right before it writes the order (it may wait behind other requests).
fresh();let asked:boolean|undefined;
const sc0=make();market.getSymbolSpecification=async()=>({broker:"Fake",accountType:"demo",symbol:"XAUUSD",volumeMin:0.01,volumeStep:0.01,volumeMax:100,tickSize:0.01,tickValue:1});
market.placeOrder=async(_r:any,o:any)=>{sc0.stop();asked=o.beforeSend();throw new (await import("../src/trading/mt5-live-adapter.js")).Mt5BridgeError("Not sent: cancelled before it reached MetaTrader 5.");};
s=await sc0.checkOnce();
assert.equal(asked,false,"stopped while queued: the order is cancelled");
assert.equal(s.lastAction,"stopped before sending the order");
assert.equal(JSON.parse(fs.readFileSync(statePath,"utf8")).pendingClientOrderId,undefined);
fresh();let sent=0;market.placeOrder=async()=>{sent++;return{accepted:true};};
const sc=make();
market.getSymbolSpecification=async()=>{sc.stop();return{broker:"Fake",accountType:"demo",symbol:"XAUUSD",volumeMin:0.01,volumeStep:0.01,volumeMax:100,tickSize:0.01,tickValue:1};};
s=await sc.checkOnce();
assert.equal(s.lastAction,"stopped before sending the order");
assert.equal(sent,0);
assert.ok(!calls.includes("dispose"),"stop leaves the bridge open for the read tools");
fs.rmSync(dir,{recursive:true,force:true});
console.log("mt5-auto-scalper-day: limits survive restarts, a new day starts at midnight, losing streaks pause trading, lost answers are checked");
process.exit(0);
