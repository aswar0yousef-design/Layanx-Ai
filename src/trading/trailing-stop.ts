/**
 * Where the stop loss of an open trade should be now. It only ever moves in the trade's favour, never back:
 *  1. once the trade has gained `breakevenAtR` times its first risk (R = entry to the first stop), the stop goes to the
 *     entry plus the spread, so the trade can no longer lose;
 *  2. from `trailFromR` R on, the stop follows the price at `trailAtr` x ATR behind it, locking in what was gained.
 * It never sits closer to the price than `minGapAtr` x ATR or the broker's minimum distance, and a move smaller than
 * `minStepAtr` x ATR is skipped (no flood of tiny changes). Returns null when the stop should stay where it is.
 */
export interface TrailRules{breakevenAtR:number;trailFromR:number;trailAtr:number;minGapAtr:number;minStepAtr:number}
export const DEFAULT_TRAIL:TrailRules={breakevenAtR:1,trailFromR:1.5,trailAtr:1.5,minGapAtr:0.3,minStepAtr:0.1};
export interface TrailInput{
  side:"long"|"short";entry:number;
  /** The stop on the trade now (0 or undefined: none). */
  stopLoss?:number;
  /** The stop the trade was opened with: it defines R. */
  initialStop?:number;
  bid:number;ask:number;atr:number;
  /** The broker's minimum distance between the price and a stop, in price units. */
  minDistance?:number;
}
export interface TrailMove{stop:number;stage:"breakeven"|"trail";lockedR:number}

export function trailingStop(input:TrailInput,rules:TrailRules=DEFAULT_TRAIL):TrailMove|null{
  const {side,entry,bid,ask,atr}=input;
  if(!(atr>0)||!(entry>0)||!(bid>0)||!(ask>=bid))return null;
  const long=side==="long",price=long?bid:ask,spread=ask-bid;
  const current=input.stopLoss&&input.stopLoss>0?input.stopLoss:undefined;
  // R from the first stop; if it is unknown, from a stop still on the losing side; else nothing can be judged.
  const first=input.initialStop&&input.initialStop>0?input.initialStop:current&&(long?current<entry:current>entry)?current:undefined;
  if(first===undefined)return null;
  const risk=Math.abs(entry-first);
  if(!(risk>0))return null;
  const gainedR=(long?price-entry:entry-price)/risk;
  let target:number|undefined,stage:TrailMove["stage"]="breakeven";
  if(gainedR>=rules.breakevenAtR)target=long?entry+spread:entry-spread;
  if(gainedR>=rules.trailFromR){
    const trail=long?price-rules.trailAtr*atr:price+rules.trailAtr*atr;
    if(target===undefined||(long?trail>target:trail<target)){target=trail;stage="trail";}
  }
  if(target===undefined)return null;
  // Never too close to the price (the broker would refuse it, and normal noise would close the trade).
  const gap=Math.max(rules.minGapAtr*atr,input.minDistance??0);
  target=long?Math.min(target,price-gap):Math.max(target,price+gap);
  // Only forward, and only by a real step.
  const base=current??first;
  const step=rules.minStepAtr*atr;
  if(long?target<=base+step:target>=base-step)return null;
  return{stop:target,stage,lockedR:Math.round(((long?target-entry:entry-target)/risk)*100)/100};
}
