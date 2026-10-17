import type {LayanXCore} from "../core/orchestrator.js";
import {runSingleTool} from "../autonomy/runtime-deps.js";
import {capabilityEnabled} from "../platform/capabilities.js";
import {DEFAULT_MT5_MAGIC} from "./mt5-live-adapter.js";
import type {MarketCandle} from "./scalping-signal.js";
import {MT5_ACCOUNT_TOOL,MT5_AUTO_START_TOOL,MT5_AUTO_STATUS_TOOL,MT5_AUTO_STOP_TOOL,MT5_CANDLES_TOOL,MT5_HISTORY_TOOL,MT5_POSITIONS_TOOL,MT5_QUOTE_TOOL,MT5_TESTER_TOOL} from "./mt5-agent-integration.js";

/**
 * The Control Center's Trading page. It reads through the same MT5 tool adapters the agent uses (one
 * bridge, no new tools) and never creates missions for reading. Connecting starts the MT5 bridge (and can
 * open MetaTrader 5), so it happens only when the page asks. Acting goes through the owner's approval
 * every time, like any trading tool: starting or stopping the auto-scalper, and the Strategy Tester (which
 * runs in the background, because a test can take up to half an hour).
 */
export interface TradingSettings{liveTrading:boolean;autoScalping:boolean;allowReal:boolean;maxDailyLossPct:number;maxTradesPerDay:number;maxConsecutiveLosses:number;magic:number}
const num=(v:string|undefined,fallback:number,min:number,max:number)=>{const n=Number(v);return Number.isFinite(n)&&v!==undefined&&v!==""?Math.min(Math.max(n,min),max):fallback;};
/** The owner's switches and limits, as the auto-scalper reads them (same defaults). */
export function tradingSettings(env:NodeJS.ProcessEnv=process.env):TradingSettings{
  return{liveTrading:env.MT5_LIVE_TRADING_ENABLED==="true",autoScalping:env.MT5_AUTO_SCALPING_ENABLED==="true",allowReal:env.MT5_ALLOW_REAL_ACCOUNT==="true",
    maxDailyLossPct:num(env.MT5_MAX_DAILY_LOSS_PERCENT,2,0.1,10),maxTradesPerDay:Math.floor(num(env.MT5_MAX_TRADES_PER_DAY,20,1,500)),
    maxConsecutiveLosses:Math.floor(num(env.MT5_MAX_CONSECUTIVE_LOSSES,3,1,20)),magic:Math.floor(num(env.MT5_MAGIC_NUMBER,DEFAULT_MT5_MAGIC,1,2_000_000_000))};
}
export type Part<T=Record<string,unknown>>={ok:true;value:T}|{ok:false;error:string};
const SYMBOL=/^[A-Za-z0-9._#-]{1,24}$/;

export async function tradingOverview(core:LayanXCore,opts:{connect:boolean;symbol?:string;days?:number}){
  const settings=tradingSettings();
  if(!capabilityEnabled("trading"))return{enabled:false,settings};
  const read=async(tool:string,payload:Record<string,unknown>={}):Promise<Part>=>{
    try{return{ok:true,value:await core.toolAdapters.get(tool).execute({payload} as never) as Record<string,unknown>};}
    catch(error){return{ok:false,error:(error instanceof Error?error.message:String(error)).slice(0,400)};}
  };
  const scalper=await read(MT5_AUTO_STATUS_TOOL);
  if(!opts.connect)return{enabled:true,connected:false,settings,scalper};
  const account=await read(MT5_ACCOUNT_TOOL);
  if(!account.ok)return{enabled:true,connected:false,settings,scalper,account};
  const symbol=opts.symbol&&SYMBOL.test(opts.symbol)?opts.symbol:(scalper.ok&&typeof scalper.value.symbol==="string"?scalper.value.symbol:"XAUUSD");
  const days=Math.min(Math.max(Math.floor(opts.days??7),1),90);
  // The bridge answers one request at a time; these wait their turn.
  const [positions,quote,candles,history]=await Promise.all([
    read(MT5_POSITIONS_TOOL),read(MT5_QUOTE_TOOL,{symbol}),read(MT5_CANDLES_TOOL,{symbol,timeframe:"M15",limit:96}),read(MT5_HISTORY_TOOL,{days})]);
  const series:Part<{symbol:string;closes:number[];from?:string;to?:string}>=candles.ok
    ?{ok:true,value:(()=>{const c=(candles.value.candles as MarketCandle[]|undefined)??[];
      return{symbol,closes:c.map(x=>x.close).filter(Number.isFinite),from:c[0]?.timestamp,to:c.at(-1)?.timestamp};})()}
    :candles;
  const recent:Part=history.ok?{ok:true,value:{...history.value,deals:((history.value.deals as unknown[])??[]).slice(-20).reverse()}}:history;
  return{enabled:true,connected:true,settings,symbol,days,scalper,account,positions,quote,series,history:recent};
}

export interface TesterRun{id:string;payload:Record<string,unknown>;status:"running"|"done"|"failed";startedAt:string;finishedAt?:string;result?:unknown;error?:string}
/** Strategy Tester runs started from the page: they run in the background; the page asks how they went. */
export class TesterRuns{
  private readonly runs=new Map<string,TesterRun>();
  list():TesterRun[]{return[...this.runs.values()].sort((a,b)=>b.startedAt.localeCompare(a.startedAt));}
  /** Without an approval: asks for one (nothing runs). With the owner's approval: starts the test and returns at once. */
  async request(core:LayanXCore,projectId:string,payload:Record<string,unknown>,resume?:{missionId:string;approvalId:string}):Promise<Record<string,unknown>>{
    if(!resume){
      const r=await runSingleTool(core,projectId,MT5_TESTER_TOOL,payload);
      if(!r.approvalId)throw new Error("The Strategy Tester always needs the owner's approval.");
      return r;
    }
    if(this.runs.has(resume.approvalId))return{ok:true,started:true,id:resume.approvalId};
    const run:TesterRun={id:resume.approvalId,payload,status:"running",startedAt:new Date().toISOString()};
    this.runs.set(run.id,run);
    for(const old of this.list().slice(10))this.runs.delete(old.id);
    void runSingleTool(core,projectId,MT5_TESTER_TOOL,payload,resume).then(r=>{
      run.status=r.ok?"done":"failed";run.finishedAt=new Date().toISOString();
      if(r.ok)run.result=r.data;else run.error=String(r.error??"failed").slice(0,600);
    },error=>{run.status="failed";run.finishedAt=new Date().toISOString();run.error=(error instanceof Error?error.message:String(error)).slice(0,600);});
    return{ok:true,started:true,id:run.id};
  }
}

/** Start or stop the auto-scalper: the first call asks for the owner's approval, the second (with it) acts. */
export async function scalperAction(core:LayanXCore,projectId:string,action:"start"|"stop",resume?:{missionId:string;approvalId:string}){
  if(!capabilityEnabled("trading"))throw new Error("Trading is switched off on the setup page.");
  return runSingleTool(core,projectId,action==="start"?MT5_AUTO_START_TOOL:MT5_AUTO_STOP_TOOL,{},resume);
}
