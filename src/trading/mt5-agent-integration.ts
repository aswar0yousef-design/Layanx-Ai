import type {ToolDefinition} from "../tools/registry.js";
import type {ToolRegistry} from "../tools/registry.js";
import type {ToolAdapterRegistry} from "../tools/adapters.js";
import {Mt5LiveAdapter} from "./mt5-live-adapter.js";
import {Mt5AutoScalper} from "./mt5-auto-scalper.js";
import {runStrategyTest,type TesterRequest} from "./mt5-strategy-tester.js";

export const MT5_ACCOUNT_TOOL="trading.mt5.account";
export const MT5_AUTO_START_TOOL="trading.mt5.autoscalper.start";
export const MT5_AUTO_STOP_TOOL="trading.mt5.autoscalper.stop";
export const MT5_AUTO_STATUS_TOOL="trading.mt5.autoscalper.status";
export const MT5_POSITIONS_TOOL="trading.mt5.positions";
export const MT5_QUOTE_TOOL="trading.mt5.quote";
export const MT5_CANDLES_TOOL="trading.mt5.candles";
export const MT5_HISTORY_TOOL="trading.mt5.history";
export const MT5_TESTER_TOOL="trading.mt5.tester.run";
/** Every MT5 tool, for the agent grants (runtime.ts) and the duplicate check. */
export const MT5_TOOLS=[MT5_ACCOUNT_TOOL,MT5_POSITIONS_TOOL,MT5_QUOTE_TOOL,MT5_CANDLES_TOOL,MT5_HISTORY_TOOL,MT5_AUTO_STATUS_TOOL,MT5_AUTO_START_TOOL,MT5_AUTO_STOP_TOOL,MT5_TESTER_TOOL];

const obj=(p:unknown)=>(p&&typeof p==="object"?p:{}) as Record<string,unknown>;
const str=(v:unknown,max=40)=>typeof v==="string"&&v.trim()?v.trim().slice(0,max):undefined;
function symbolOf(p:Record<string,unknown>,required=true){
  const s=str(p.symbol,32);
  if(s&&!/^[A-Za-z0-9._#+\-]{1,32}$/.test(s))throw new Error("symbol must be a symbol name like XAUUSD.");
  if(!s&&required)throw new Error("payload.symbol is required (for example XAUUSD).");
  return s;
}

/**
 * MT5 tools. Reading (account, positions, prices, candles, closed trades) needs no approval. Starting or
 * stopping the auto-scalper and running the Strategy Tester are L4 and wait for the owner every time.
 * There is no tool here that sends a single order: real orders come only from the auto-scalper, which
 * the owner enables (MT5_LIVE_TRADING_ENABLED + MT5_AUTO_SCALPING_ENABLED) and starts.
 */
export function registerMt5TradingTools(tools:ToolRegistry,adapters:ToolAdapterRegistry,options:{adapter?:Mt5LiveAdapter;statePath?:string}={}):Mt5AutoScalper{
 // One bridge process shared by the tools and the auto-scalper.
 const adapter=options.adapter??new Mt5LiveAdapter();
 const scalper=new Mt5AutoScalper({adapter,...(options.statePath?{statePath:options.statePath}:{})});
 const defs:ToolDefinition[]=[
  {name:MT5_ACCOUNT_TOOL,description:"Read the MetaTrader 5 account: balance, equity, currency, leverage, whether it is a demo or real account, and whether Algo Trading is on.",permission:"L1_READ",dangerous:false,actions:["mt5-account"],tags:["trading","mt5","account"]},
  {name:MT5_POSITIONS_TOOL,description:"List open MetaTrader 5 positions (payload.symbol optional): side, size, open price, SL/TP, profit, and whether LayanX opened it (magic).",permission:"L1_READ",dangerous:false,actions:["mt5-positions"],tags:["trading","mt5","positions"]},
  {name:MT5_QUOTE_TOOL,description:"Read the current MetaTrader 5 bid/ask for payload.symbol (e.g. XAUUSD).",permission:"L1_READ",dangerous:false,actions:["mt5-quote"],tags:["trading","mt5","price","quote"]},
  {name:MT5_CANDLES_TOOL,description:"Read MetaTrader 5 candles: payload {symbol, timeframe M1|M5|M15|M30|H1|H4|D1|W1, limit up to 500}. The last candle may still be forming.",permission:"L1_READ",dangerous:false,actions:["mt5-candles"],tags:["trading","mt5","candles","ohlc"]},
  {name:MT5_HISTORY_TOOL,description:"Read closed MetaTrader 5 trades: payload {days up to 90, symbol?, onlyLayanX?}, with totals (net result, wins, losses). Times are the broker server's clock.",permission:"L1_READ",dangerous:false,actions:["mt5-history"],tags:["trading","mt5","history","deals"]},
  {name:MT5_AUTO_STATUS_TOOL,description:"Read MT5 auto-scalper status: running, last action, trades today, daily result, losing streak, demo/real account.",permission:"L1_READ",dangerous:false,actions:["mt5-scalper-status"],tags:["trading","mt5","scalping"]},
  {name:MT5_AUTO_START_TOOL,description:"Start the LayanX MT5 XAUUSD M1 auto-scalper. Live orders require MT5_LIVE_TRADING_ENABLED=true; a real (non-demo) account also needs MT5_ALLOW_REAL_ACCOUNT=true.",permission:"L4_EXECUTE",dangerous:true,actions:["start-mt5-autoscalper"],tags:["trading","mt5","scalping","live"]},
  {name:MT5_AUTO_STOP_TOOL,description:"Stop the LayanX MT5 auto-scalper.",permission:"L4_EXECUTE",dangerous:true,actions:["stop-mt5-autoscalper"],tags:["trading","mt5","scalping","live"]},
  {name:MT5_TESTER_TOOL,description:"Backtest an MQL5 robot (Expert Advisor) in the MetaTrader 5 Strategy Tester on history - no broker orders. payload {expert (name inside MQL5\\Experts), symbol, period H1, from YYYY-MM-DD, to YYYY-MM-DD, model ohlc_m1|open_prices|every_tick|real_ticks, deposit 10000, currency USD, leverage 100, inputs {name:value}}. Returns net profit, drawdown, profit factor, trades and month/year results. Uses the owner's separate tester terminal (MT5_TESTER_TERMINAL).",permission:"L4_EXECUTE",dangerous:true,actions:["mt5-strategy-tester","backtest mql5 robot"],tags:["trading","mt5","backtest","tester","expert advisor","روبوت"]},
 ];
 for(const def of defs)if(!tools.list().some(x=>x.name===def.name))tools.register(def);
 adapters.register(MT5_ACCOUNT_TOOL,{async execute(){return await adapter.connect();}});
 adapters.register(MT5_POSITIONS_TOOL,{async execute(request){const p=obj(request.payload);const positions=await adapter.positions(symbolOf(p,false));return{count:positions.length,positions};}});
 adapters.register(MT5_QUOTE_TOOL,{async execute(request){const q=await adapter.getSymbolSnapshot(symbolOf(obj(request.payload))!);return{...q,spread:Math.round((q.ask-q.bid)*1e6)/1e6};}});
 adapters.register(MT5_CANDLES_TOOL,{async execute(request){
  const p=obj(request.payload);
  const timeframe=(str(p.timeframe,4)??"M15").toUpperCase();
  const limit=Math.min(Math.max(Math.floor(Number(p.limit??100))||100,1),500);
  const candles=await adapter.getCandles({symbol:symbolOf(p)!,timeframe,limit});
  return{symbol:p.symbol,timeframe,count:candles.length,candles};
 }});
 adapters.register(MT5_HISTORY_TOOL,{async execute(request){
  const p=obj(request.payload);
  const deals=await adapter.history({days:Number(p.days??7),symbol:symbolOf(p,false),onlyLayanX:p.onlyLayanX===true});
  const nets=deals.map(d=>d.profit+d.commission+d.swap);
  return{count:deals.length,net:Math.round(nets.reduce((a,b)=>a+b,0)*100)/100,wins:nets.filter(n=>n>0).length,losses:nets.filter(n=>n<0).length,deals:deals.slice(-200)};
 }});
 adapters.register(MT5_AUTO_START_TOOL,{async execute(){if(process.env.MT5_AUTO_SCALPING_ENABLED!=="true")throw new Error("MT5 auto-scalping is disabled. Set MT5_AUTO_SCALPING_ENABLED=true.");return scalper.start();}});
 adapters.register(MT5_AUTO_STOP_TOOL,{async execute(){return scalper.stop();}});
 adapters.register(MT5_AUTO_STATUS_TOOL,{async execute(){return scalper.status();}});
 adapters.register(MT5_TESTER_TOOL,{async execute(request){
  const p=obj(request.payload);
  return await runStrategyTest({
   expert:String(p.expert??""),symbol:String(p.symbol??""),period:str(p.period,4),from:String(p.from??""),to:String(p.to??""),
   model:str(p.model,12) as TesterRequest["model"],deposit:p.deposit===undefined?undefined:Number(p.deposit),currency:str(p.currency,3),
   leverage:p.leverage===undefined?undefined:Number(p.leverage),inputs:p.inputs&&typeof p.inputs==="object"?p.inputs as TesterRequest["inputs"]:undefined,
   timeoutMinutes:p.timeoutMinutes===undefined?undefined:Number(p.timeoutMinutes)
  },{
   // When LayanX is already talking to a terminal, its folders must not be the tester's (the test closes it).
   // Not asked otherwise: asking would start MetaTrader 5 just to compare.
   liveTerminal:async()=>adapter.running?await adapter.terminalInfo():null
  });
 }});
 return scalper;
}
