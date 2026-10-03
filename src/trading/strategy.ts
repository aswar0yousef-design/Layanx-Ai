export interface Candle{timestamp:number;open:number;high:number;low:number;close:number;volume?:number;}
export type SignalSide="long"|"short";
export interface TradingSignal{strategyId:string;timestamp:number;side:SignalSide;entry:number;stopLoss:number;takeProfit:number;reason:string[];confidence:number;}
export interface StrategyContext{candles:Candle[];index:number;atrPeriod?:number;}
export interface TradingStrategy{id:string;name:string;description:string;timeframe:string;evaluate(context:StrategyContext):TradingSignal|null;withParameters?(parameters:Record<string,number>):TradingStrategy;}

export function atr(candles:Candle[],index:number,period=14):number|null{
 if(index<period)return null;let sum=0;
 for(let i=index-period+1;i<=index;i++){const prev=candles[i-1];const c=candles[i];if(!prev||!c)return null;sum+=Math.max(c.high-c.low,Math.abs(c.high-prev.close),Math.abs(c.low-prev.close));}
 return sum/period;
}

export function swingHigh(candles:Candle[],index:number,left=2,right=2):boolean{
 if(index<left||index+right>=candles.length)return false;const v=candles[index].high;for(let i=index-left;i<=index+right;i++)if(i!==index&&candles[i].high>=v)return false;return true;
}
export function swingLow(candles:Candle[],index:number,left=2,right=2):boolean{
 if(index<left||index+right>=candles.length)return false;const v=candles[index].low;for(let i=index-left;i<=index+right;i++)if(i!==index&&candles[i].low<=v)return false;return true;
}

export class HtfStructureLiquidityStrategy implements TradingStrategy{
 readonly id="htf-structure-liquidity-v1";
 readonly name="HTF Structure + Liquidity Sweep";
 readonly description="Trend, swing structure, liquidity sweep and displacement with ATR risk levels.";
 readonly timeframe="input-timeframe";
 evaluate(context:StrategyContext):TradingSignal|null{
  const {candles,index}=context;if(index<30||index>=candles.length)return null;const c=candles[index];const period=context.atrPeriod??14;const range=atr(candles,index,period);if(!range||range<=0)return null;
  const recent=candles.slice(Math.max(0,index-20),index);const highs=recent.map(x=>x.high);const lows=recent.map(x=>x.low);const priorHigh=Math.max(...highs);const priorLow=Math.min(...lows);
  const bullishSweep=c.low<priorLow&&c.close>priorLow&&c.close>c.open&&(c.close-c.open)>range*0.5;
  const bearishSweep=c.high>priorHigh&&c.close<priorHigh&&c.close<c.open&&(c.open-c.close)>range*0.5;
  const trendWindow=candles.slice(Math.max(0,index-10),index);const trendUp=c.close>Math.min(...trendWindow.map(x=>x.low));const trendDown=c.close<Math.max(...trendWindow.map(x=>x.high));
  if(bullishSweep&&trendUp){const stop=c.low-range*0.25;const risk=c.close-stop;if(risk<=0)return null;return{strategyId:this.id,timestamp:c.timestamp,side:"long",entry:c.close,stopLoss:stop,takeProfit:c.close+risk*2,reason:["liquidity sweep below recent low","bullish displacement","structure context supports long"],confidence:0.72};}
  if(bearishSweep&&trendDown){const stop=c.high+range*0.25;const risk=stop-c.close;if(risk<=0)return null;return{strategyId:this.id,timestamp:c.timestamp,side:"short",entry:c.close,stopLoss:stop,takeProfit:c.close-risk*2,reason:["liquidity sweep above recent high","bearish displacement","structure context supports short"],confidence:0.72};}
  return null;
 }
}

export class StrategyRegistry{private readonly strategies=new Map<string,TradingStrategy>();register(strategy:TradingStrategy){if(this.strategies.has(strategy.id))throw new Error("Strategy already registered.");this.strategies.set(strategy.id,strategy);}get(id:string){const strategy=this.strategies.get(id);if(!strategy)throw new Error("Unknown trading strategy: "+id);return strategy;}list(){return [...this.strategies.values()];}}

export class ScalpingSweepStrategy implements TradingStrategy{
 readonly id="scalp-sweep-v1"; readonly name="Scalp Liquidity Sweep"; readonly description="Fast long/short liquidity sweep with displacement."; readonly timeframe="M1-M5";
 constructor(private readonly options:{lookback?:number;displacement?:number;rewardMultiple?:number}={}){}
 withParameters(parameters:Record<string,number>):TradingStrategy{return new ScalpingSweepStrategy({lookback:parameters.lookback,displacement:parameters.displacement,rewardMultiple:parameters.rewardMultiple});}
 evaluate(context:StrategyContext):TradingSignal|null{
  const {candles,index}=context;const lookback=Math.max(3,Math.floor(this.options.lookback??10));const displacement=this.options.displacement??.55;const rewardMultiple=this.options.rewardMultiple??.8;if(index<lookback+5||index>=candles.length)return null;const c=candles[index],previous=candles[index-1],recent=candles.slice(index-lookback,index);if(!c||!previous)return null;
  const hi=Math.max(...recent.map(x=>x.high)),lo=Math.min(...recent.map(x=>x.low));const range=Math.max(c.high-c.low,Math.abs(c.high-previous.close),Math.abs(c.low-previous.close));if(range<=0)return null;
  if(c.low<lo&&c.close>lo&&c.close>c.open&&(c.close-c.open)>=range*displacement){const risk=c.close-c.low;if(risk<=0)return null;return{strategyId:this.id,timestamp:c.timestamp,side:"long",entry:c.close,stopLoss:c.low,takeProfit:c.close+risk*rewardMultiple,reason:["recent low sweep","bullish displacement","quick scalp"],confidence:.68};}
  if(c.high>hi&&c.close<hi&&c.close<c.open&&(c.open-c.close)>=range*displacement){const risk=c.high-c.close;if(risk<=0)return null;return{strategyId:this.id,timestamp:c.timestamp,side:"short",entry:c.close,stopLoss:c.high,takeProfit:c.close-risk*rewardMultiple,reason:["recent high sweep","bearish displacement","quick scalp"],confidence:.68};}
  return null;
 }
}
