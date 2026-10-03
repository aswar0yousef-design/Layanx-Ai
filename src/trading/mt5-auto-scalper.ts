import {readFileSync,writeFileSync,mkdirSync,existsSync} from "node:fs";
import {dirname} from "node:path";
import {Mt5LiveAdapter} from "./mt5-live-adapter.js";
import {generateScalpingSignal} from "./scalping-signal.js";
import {evaluateScalpingDecision} from "./scalping-decision.js";
import {filterCompletedMt5Candles} from "./mt5-adapter.js";

interface State{date:string;startEquity:number;dailyPnl:number;consecutiveLosses:number;lastSignalTimestamp?:string;lastTradeTimestamp?:string;}
export interface Mt5AutoScalperStatus{running:boolean;symbol:string;timeframe:string;lastAction?:string;lastError?:string;lastCheckAt?:string;tradesToday:number;dailyPnl:number;}

export class Mt5AutoScalper{
 private timer?:NodeJS.Timeout;
 private state:State;
 private readonly adapter:Mt5LiveAdapter;
 private readonly statusState:Mt5AutoScalperStatus;
 private readonly intervalMs:number;
 private readonly statePath:string;
 constructor(options:{adapter?:Mt5LiveAdapter;symbol?:string;timeframe?:string;intervalMs?:number;statePath?:string}={}){
  this.adapter=options.adapter??new Mt5LiveAdapter();
  this.intervalMs=options.intervalMs??Math.max(15_000,Number(process.env.MT5_SCALPER_INTERVAL_MS??15_000));
  this.statePath=options.statePath??process.env.MT5_SCALPER_STATE_PATH??".layanx/mt5-scalper.json";
  const symbol=options.symbol??process.env.MT5_SCALPER_SYMBOL??"XAUUSD";
  const timeframe=options.timeframe??process.env.MT5_SCALPER_TIMEFRAME??"M1";
  this.statusState={running:false,symbol,timeframe,tradesToday:0,dailyPnl:0};
  this.state=this.loadState();
 }
 private loadState():State{
  const today=new Date().toISOString().slice(0,10);
  try{
   if(existsSync(this.statePath)){
    const value=JSON.parse(readFileSync(this.statePath,"utf8")) as State;
    if(value.date===today)return value;
   }
  }catch{}
  return{date:today,startEquity:0,dailyPnl:0,consecutiveLosses:0};
 }
 private saveState(){mkdirSync(dirname(this.statePath),{recursive:true});writeFileSync(this.statePath,JSON.stringify(this.state,null,2),{encoding:"utf8",mode:0o600});}
 status(){return {...this.statusState,running:!!this.timer,dailyPnl:this.state.dailyPnl};}
 async checkOnce():Promise<Mt5AutoScalperStatus>{
  const now=new Date().toISOString(); this.statusState.lastCheckAt=now;
  try{
   const account=await this.adapter.connect();
   if(!this.state.startEquity)this.state.startEquity=account.equity;
   this.state.dailyPnl=account.equity-this.state.startEquity;
   this.statusState.dailyPnl=this.state.dailyPnl;
   const positions=await this.adapter.positions(this.statusState.symbol);
   if(positions.length>0){this.statusState.lastAction="position already open; no new entry";this.saveState();return this.status();}
   const snapshot=await this.adapter.getSymbolSnapshot(this.statusState.symbol);
   const raw=await this.adapter.getCandles({symbol:this.statusState.symbol,timeframe:this.statusState.timeframe,limit:120});
   const candles=filterCompletedMt5Candles(raw,snapshot.timestamp,this.statusState.timeframe);
   if(candles.length<40){this.statusState.lastAction="waiting for sufficient completed candles";return this.status();}
   const signal=generateScalpingSignal(candles);
   if(signal.candleTimestamp===this.state.lastSignalTimestamp){this.statusState.lastAction="signal candle already evaluated";return this.status();}
   this.state.lastSignalTimestamp=signal.candleTimestamp;
   if(signal.action==="neutral"){this.statusState.lastAction="neutral signal";this.saveState();return this.status();}
   const atr=signal.indicators.atr;
   if(!atr||atr<=0){this.statusState.lastAction="ATR unavailable";this.saveState();return this.status();}
   const riskPercent=Math.min(Math.max(Number(process.env.MT5_SCALP_RISK_PERCENT??0.25),0.01),2);
   const stopDistance=atr*Number(process.env.MT5_STOP_ATR_MULTIPLIER??1.2);
   const targetDistance=atr*Number(process.env.MT5_TARGET_ATR_MULTIPLIER??1.8);
   const decision=evaluateScalpingDecision({
    candles,
    market:{symbol:this.statusState.symbol,timeframe:this.statusState.timeframe,bid:snapshot.bid,ask:snapshot.ask,spread:snapshot.ask-snapshot.bid,atr,timestamp:snapshot.timestamp},
    risk:{accountBalance:account.equity,riskPercent,stopLossPrice:signal.action==="long"?snapshot.ask-stopDistance:snapshot.bid+stopDistance,brokerSymbol:await this.adapter.getSymbolSpecification(this.statusState.symbol)},
    executionPolicy:{maxSpreadAtrRatio:Number(process.env.MT5_MAX_SPREAD_ATR??0.15),maxExpectedSlippageAtrRatio:Number(process.env.MT5_MAX_SLIPPAGE_ATR??0.1),requireSpread:true,requireAtr:true},
   });
   if(!decision.executable||!decision.riskPlan){this.statusState.lastAction=`blocked: ${decision.reasons.join("; ")}`;this.saveState();return this.status();}
   const stopLossPrice=signal.action==="long"?snapshot.ask-stopDistance:snapshot.bid+stopDistance;
   const takeProfitPrice=signal.action==="long"?snapshot.ask+targetDistance:snapshot.bid-targetDistance;
   const result=await this.adapter.placeOrder({symbol:this.statusState.symbol,side:signal.action,quantity:decision.riskPlan.quantity,stopLossPrice,takeProfitPrice,clientOrderId:`layanx-${Date.now()}`});
   if(!result.accepted)throw new Error(result.message??"MT5 rejected order.");
   this.statusState.tradesToday+=1;
   this.statusState.lastTradeTimestamp=now;
   this.statusState.lastAction=`${signal.action} order accepted: ${result.brokerOrderId??"unknown"}`;
   this.saveState();
   return this.status();
  }catch(error){
   this.statusState.lastError=error instanceof Error?error.message:String(error);
   this.statusState.lastAction="error";
   return this.status();
  }
 }
 start(){if(this.timer)return this.status();this.statusState.running=true;void this.checkOnce();this.timer=setInterval(()=>void this.checkOnce(),this.intervalMs);return this.status();}
 stop(){if(this.timer){clearInterval(this.timer);this.timer=undefined;}this.statusState.running=false;return this.status();}
}
