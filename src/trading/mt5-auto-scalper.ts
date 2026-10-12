import {readFileSync,writeFileSync,mkdirSync,existsSync} from "node:fs";
import {dirname} from "node:path";
import {Mt5LiveAdapter,Mt5UnknownOutcomeError,newClientOrderId} from "./mt5-live-adapter.js";
import {generateScalpingSignal} from "./scalping-signal.js";
import {evaluateScalpingDecision} from "./scalping-decision.js";
import {filterCompletedMt5Candles} from "./mt5-adapter.js";

/** Persisted per trading day (UTC); a new day starts from the equity at its first check. */
interface State{
 date:string;
 startEquity:number;
 dailyPnl:number;
 tradesToday:number;
 consecutiveLosses:number;
 /** Highest closed-deal ticket already counted for consecutiveLosses. */
 lastDealTicket?:number;
 /** An order being sent, or whose answer was lost: checked on the account before any new entry. */
 pendingClientOrderId?:string;
 /** Checks that did not find the pending order yet (it is let go after 2). */
 pendingMisses?:number;
 lastSignalTimestamp?:string;
 lastTradeTimestamp?:string;
}
export interface Mt5AutoScalperStatus{running:boolean;symbol:string;timeframe:string;lastAction?:string;lastError?:string;lastCheckAt?:string;lastTradeTimestamp?:string;tradesToday:number;dailyPnl:number;consecutiveLosses:number;tradeMode?:string;}

const today=(now:Date)=>now.toISOString().slice(0,10);
const envNum=(name:string,d:number,min:number,max:number)=>{const n=Number(process.env[name]);return Number.isFinite(n)&&process.env[name]!==""&&process.env[name]!==undefined?Math.min(Math.max(n,min),max):d;};

export class Mt5AutoScalper{
 private timer?:NodeJS.Timeout;
 private state:State;
 private readonly adapter:Mt5LiveAdapter;
 private readonly statusState:Omit<Mt5AutoScalperStatus,"tradesToday"|"dailyPnl"|"consecutiveLosses">;
 private readonly intervalMs:number;
 private readonly statePath:string;
 private readonly now:()=>Date;
 private busy=false;
 /** Bumped by stop(): a check that started before it never sends an order after it. */
 private generation=0;
 constructor(options:{adapter?:Mt5LiveAdapter;symbol?:string;timeframe?:string;intervalMs?:number;statePath?:string;now?:()=>Date}={}){
  this.adapter=options.adapter??new Mt5LiveAdapter();
  this.intervalMs=options.intervalMs??Math.max(15_000,Number(process.env.MT5_SCALPER_INTERVAL_MS??15_000));
  this.statePath=options.statePath??process.env.MT5_SCALPER_STATE_PATH??".layanx/mt5-scalper.json";
  this.now=options.now??(()=>new Date());
  const symbol=options.symbol??process.env.MT5_SCALPER_SYMBOL??"XAUUSD";
  const timeframe=options.timeframe??process.env.MT5_SCALPER_TIMEFRAME??"M1";
  this.statusState={running:false,symbol,timeframe};
  this.state=this.loadState();
 }
 private fresh(date:string,equity=0):State{return{date,startEquity:equity,dailyPnl:0,tradesToday:0,consecutiveLosses:0};}
 private loadState():State{
  try{
   if(existsSync(this.statePath)){
    const value=JSON.parse(readFileSync(this.statePath,"utf8")) as Partial<State>;
    if(typeof value.date==="string")return{...this.fresh(value.date),...value,tradesToday:Number(value.tradesToday)||0,consecutiveLosses:Number(value.consecutiveLosses)||0} as State;
   }
  }catch{}
  return this.fresh(today(this.now()));
 }
 private saveState(){mkdirSync(dirname(this.statePath),{recursive:true});writeFileSync(this.statePath,JSON.stringify(this.state,null,2),{encoding:"utf8",mode:0o600});}
 status():Mt5AutoScalperStatus{return {...this.statusState,running:!!this.timer,tradesToday:this.state.tradesToday,dailyPnl:this.state.dailyPnl,consecutiveLosses:this.state.consecutiveLosses};}
 private done(action:string,save=true){this.statusState.lastAction=action;if(save)this.saveState();return this.status();}

 /** Counts losing closes of LayanX's own trades since the last check (a win resets the count). */
 private async updateLosses(){
  // Deal times are the broker server's clock, not UTC, so deals are not filtered by date: every close
  // after the last one counted is counted (the streak itself starts again at midnight).
  const deals=(await this.adapter.history({days:2,symbol:this.statusState.symbol,onlyLayanX:true}))
   .map(d=>({d,t:Number(d.ticket)})).filter(x=>Number.isFinite(x.t)).sort((a,b)=>a.t-b.t);
  if(this.state.lastDealTicket===undefined){this.state.lastDealTicket=deals.length?deals.at(-1)!.t:0;return;}
  for(const {d,t} of deals){
   if(t<=this.state.lastDealTicket)continue;
   const net=d.profit+d.commission+d.swap;
   this.state.consecutiveLosses=net<0?this.state.consecutiveLosses+1:0;
   this.state.lastDealTicket=t;
  }
 }

 async checkOnce():Promise<Mt5AutoScalperStatus>{
  if(this.busy)return this.status();
  this.busy=true;
  const generation=this.generation;
  const now=this.now();this.statusState.lastCheckAt=now.toISOString();
  try{
   const account=await this.adapter.connect();
   this.statusState.tradeMode=account.tradeMode;
   const date=today(now);
   if(this.state.date!==date){
    // A new trading day: limits start again from today's equity.
    this.state={...this.fresh(date,account.equity),lastDealTicket:this.state.lastDealTicket,pendingClientOrderId:this.state.pendingClientOrderId,pendingMisses:this.state.pendingMisses};
   }
   if(!this.state.startEquity)this.state.startEquity=account.equity;
   this.state.dailyPnl=account.equity-this.state.startEquity;
   await this.updateLosses();
   if(this.state.pendingClientOrderId){
    const id=this.state.pendingClientOrderId;
    const found=await this.adapter.findOrder(id);
    if(found.found){
     this.state.pendingClientOrderId=undefined;this.state.pendingMisses=undefined;
     this.state.tradesToday+=1;this.state.lastTradeTimestamp=this.statusState.lastCheckAt;this.statusState.lastTradeTimestamp=this.state.lastTradeTimestamp;
     return this.done(`earlier order ${id} confirmed on the account (ticket ${found.ticket}); no new entry this check`);
    }
    // A late fill can take a moment to appear: the order is let go only after two checks without it.
    this.state.pendingMisses=(this.state.pendingMisses??0)+1;
    if(this.state.pendingMisses<2)return this.done(`waiting to confirm earlier order ${id}; no new entry yet`);
    this.state.pendingClientOrderId=undefined;this.state.pendingMisses=undefined;
    this.saveState();
   }
   const maxDailyLossFraction=Math.min(Math.max(envNum("MT5_MAX_DAILY_LOSS_PERCENT",2,0.1,10)/100,0.001),0.10);
   if(this.state.dailyPnl<=-(this.state.startEquity*maxDailyLossFraction))return this.done("daily loss limit reached; trading paused until tomorrow");
   const maxTradesPerDay=Math.floor(envNum("MT5_MAX_TRADES_PER_DAY",20,1,500));
   if(this.state.tradesToday>=maxTradesPerDay)return this.done("daily trade limit reached; trading paused until tomorrow");
   const maxLosses=Math.floor(envNum("MT5_MAX_CONSECUTIVE_LOSSES",3,1,20));
   if(this.state.consecutiveLosses>=maxLosses)return this.done(`${this.state.consecutiveLosses} losing trades in a row; trading paused until tomorrow`);
   const positions=await this.adapter.positions(this.statusState.symbol);
   if(positions.length>0)return this.done("position already open; no new entry");
   const working=await this.adapter.orders(this.statusState.symbol);
   if(working.length>0)return this.done("an order is still being filled; no new entry");
   const snapshot=await this.adapter.getSymbolSnapshot(this.statusState.symbol);
   const raw=await this.adapter.getCandles({symbol:this.statusState.symbol,timeframe:this.statusState.timeframe,limit:120});
   const candles=filterCompletedMt5Candles(raw,snapshot.timestamp,this.statusState.timeframe);
   if(candles.length<40)return this.done("waiting for sufficient completed candles",false);
   const signal=generateScalpingSignal(candles);
   if(signal.candleTimestamp===this.state.lastSignalTimestamp)return this.done("signal candle already evaluated",false);
   this.state.lastSignalTimestamp=signal.candleTimestamp;
   if(signal.action==="neutral")return this.done("neutral signal");
   const atr=signal.indicators.atr;
   if(!atr||atr<=0)return this.done("ATR unavailable");
   const riskPercent=envNum("MT5_SCALP_RISK_PERCENT",0.25,0.01,2);
   const stopDistance=atr*envNum("MT5_STOP_ATR_MULTIPLIER",1.2,0.1,20);
   const targetDistance=atr*envNum("MT5_TARGET_ATR_MULTIPLIER",1.8,0.1,40);
   const stopLossPrice=signal.action==="long"?snapshot.ask-stopDistance:snapshot.bid+stopDistance;
   const takeProfitPrice=signal.action==="long"?snapshot.ask+targetDistance:snapshot.bid-targetDistance;
   const decision=evaluateScalpingDecision({
    candles,
    market:{symbol:this.statusState.symbol,timeframe:this.statusState.timeframe,bid:snapshot.bid,ask:snapshot.ask,spread:snapshot.ask-snapshot.bid,atr,timestamp:snapshot.timestamp},
    risk:{accountBalance:account.equity,riskPercent,stopLossPrice,brokerSymbol:await this.adapter.getSymbolSpecification(this.statusState.symbol)},
    executionPolicy:{maxSpreadAtrRatio:envNum("MT5_MAX_SPREAD_ATR",0.15,0.01,5),maxExpectedSlippageAtrRatio:envNum("MT5_MAX_SLIPPAGE_ATR",0.1,0.01,5),requireSpread:true,requireAtr:true},
   });
   if(!decision.executable||!decision.riskPlan)return this.done(`blocked: ${decision.reasons.join("; ")}`);
   if(generation!==this.generation)return this.done("stopped before sending the order",false);
   const clientOrderId=newClientOrderId();
   // Recorded before sending: if LayanX stops or the answer is lost, the next check looks for it first.
   this.state.pendingClientOrderId=clientOrderId;this.state.pendingMisses=0;this.saveState();
   try{
    const result=await this.adapter.placeOrder({symbol:this.statusState.symbol,side:signal.action,quantity:decision.riskPlan.quantity,stopLossPrice,takeProfitPrice,clientOrderId},
     {beforeSend:()=>generation===this.generation});
    this.state.pendingClientOrderId=undefined;this.state.pendingMisses=undefined;
    if(!result.accepted){this.saveState();throw new Error(result.message??"MT5 rejected order.");}
    this.state.tradesToday+=1;
    this.state.lastTradeTimestamp=this.statusState.lastCheckAt;this.statusState.lastTradeTimestamp=this.state.lastTradeTimestamp;
    return this.done(`${signal.action} order accepted: ${result.brokerOrderId??"unknown"}${result.replayed?" (already on the account)":""}`);
   }catch(error){
    if(error instanceof Mt5UnknownOutcomeError){this.statusState.lastError=error.message;return this.done("order outcome unknown; it is checked on the account before any new entry");}
    if(this.state.pendingClientOrderId===clientOrderId){this.state.pendingClientOrderId=undefined;this.state.pendingMisses=undefined;this.saveState();}
    if(generation!==this.generation)return this.done("stopped before sending the order",false);
    throw error;
   }
  }catch(error){
   this.statusState.lastError=error instanceof Error?error.message:String(error);
   this.statusState.lastAction="error";
   return this.status();
  }finally{this.busy=false;}
 }
 start(){if(this.timer)return this.status();this.statusState.running=true;void this.checkOnce();this.timer=setInterval(()=>void this.checkOnce(),this.intervalMs);return this.status();}
 /** Stops new checks; a check already running does not send an order after this. The bridge stays open for the read tools. */
 stop(){this.generation++;if(this.timer){clearInterval(this.timer);this.timer=undefined;}this.statusState.running=false;return this.status();}
}
