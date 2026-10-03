import type {TradingSignal} from "./strategy.js";

export interface ScalpRiskContext{
 equity:number;
 spread:number;
 atr:number;
 timestamp:number;
 dailyPnl:number;
 consecutiveLosses:number;
 openPositions:number;
}

export interface ScalpRiskPolicy{
 maxSpreadToAtr?:number;
 minAtr?:number;
 maxDailyLossFraction?:number;
 maxConsecutiveLosses?:number;
 maxOpenPositions?:number;
 cooldownBars?:number;
}

export interface ScalpRiskDecision{
 allowed:boolean;
 reasons:string[];
 riskFraction:number;
 cooldownUntil?:number;
}

export class ScalpRiskController{
 evaluate(signal:TradingSignal,context:ScalpRiskContext,policy:ScalpRiskPolicy={},lastExitTimestamp?:number):ScalpRiskDecision{
  const maxSpreadToAtr=policy.maxSpreadToAtr??0.15;
  const minAtr=policy.minAtr??0;
  const maxDailyLossFraction=policy.maxDailyLossFraction??0.02;
  const maxConsecutiveLosses=policy.maxConsecutiveLosses??3;
  const maxOpenPositions=policy.maxOpenPositions??1;
  const cooldownBars=policy.cooldownBars??3;
  const reasons:string[]=[];
  if(!Number.isFinite(context.equity)||context.equity<=0)reasons.push("invalid equity");
  if(context.atr<minAtr)reasons.push("volatility below minimum");
  if(context.atr<=0||context.spread/context.atr>maxSpreadToAtr)reasons.push("spread is too large for current volatility");
  if(context.dailyPnl<=-(context.equity*maxDailyLossFraction))reasons.push("daily loss limit reached");
  if(context.consecutiveLosses>=maxConsecutiveLosses)reasons.push("consecutive-loss limit reached");
  if(context.openPositions>=maxOpenPositions)reasons.push("maximum open positions reached");
  if(lastExitTimestamp!==undefined&&context.timestamp-lastExitTimestamp<cooldownBars)reasons.push("scalp cooldown active");
  return{allowed:reasons.length===0,reasons,riskFraction:signal.confidence>=0.75?0.002:0.001,cooldownUntil:reasons.includes("scalp cooldown active")&&lastExitTimestamp!==undefined?lastExitTimestamp+cooldownBars:undefined};
 }
}
