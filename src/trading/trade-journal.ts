import fs from "node:fs";
import path from "node:path";
import {resolveDataPaths} from "../platform/paths.js";
import type {StrategyBook} from "./strategy-book.js";

/**
 * Every trade LayanX closes, with the strategy and timeframe that opened it: the record the robot learns from. Learning
 * here is deliberately slow and guarded: a strategy is only judged after enough live trades, and it is suspended (never
 * re-tuned on the spot) when its live results fall clearly below what the history promised. Fitting rules to the last few
 * trades would only learn the noise.
 */
export interface JournalEntry{closedAt:string;symbol:string;positionId:string;strategy:string;timeframe:string;net:number;quantity:number}
export function journalPath(env:NodeJS.ProcessEnv=process.env){return env.LAYANX_TRADE_JOURNAL?.trim()||path.join(resolveDataPaths().dataDir,"trading","journal.jsonl");}
export function appendJournal(entry:JournalEntry,file=journalPath()){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.appendFileSync(file,JSON.stringify(entry)+"\n",{mode:0o600});
}
export function readJournal(file=journalPath()):JournalEntry[]{
  try{return fs.readFileSync(file,"utf8").split("\n").filter(Boolean).flatMap(l=>{try{return[JSON.parse(l) as JournalEntry];}catch{return[];}});}catch{return[];}
}
export interface LiveReview{key:string;symbol:string;timeframe:string;strategy:string;trades:number;net:number;winRate:number;profitFactor:number|null;
  expectedProfitFactor:number|null;verdict:"too early"|"in line"|"suspend";why:string}
/** At least this many live trades before a strategy is judged; then it is suspended if its profit factor falls below this. */
export const REVIEW_RULE={minTrades:20,suspendBelowProfitFactor:0.9};
const base=(s:string)=>s.replace(/[._#][A-Za-z]?$/,"").toUpperCase();
export function reviewLive(book:StrategyBook|null,journal:JournalEntry[]):LiveReview[]{
  return(book?.entries??[]).map(e=>{
    const mine=journal.filter(j=>base(j.symbol)===base(e.symbol)&&j.timeframe===e.timeframe&&j.strategy===e.strategy);
    let gw=0,gl=0,wins=0,net=0;for(const j of mine){net+=j.net;if(j.net>0){gw+=j.net;wins++;}else gl-=j.net;}
    const pf=gl?Math.round(gw/gl*100)/100:mine.length?null:null;
    const expected=Math.min(e.firstHalf.profitFactor??0,e.secondHalf.profitFactor??0)||null;
    const r={key:`${e.symbol} ${e.timeframe} ${e.strategy}`,symbol:e.symbol,timeframe:e.timeframe,strategy:e.strategy,trades:mine.length,net:Math.round(net*100)/100,
      winRate:mine.length?Math.round(wins/mine.length*100):0,profitFactor:pf,expectedProfitFactor:expected};
    if(mine.length<REVIEW_RULE.minTrades)return{...r,verdict:"too early" as const,why:`${mine.length} of ${REVIEW_RULE.minTrades} live trades so far`};
    if((pf??Infinity)<REVIEW_RULE.suspendBelowProfitFactor)return{...r,verdict:"suspend" as const,why:`live profit factor ${pf} after ${mine.length} trades, history promised ${expected}`};
    return{...r,verdict:"in line" as const,why:`live profit factor ${pf ?? "no losses"} after ${mine.length} trades (history ${expected})`};
  });
}
/** The book without suspended strategies, with the suspensions recorded (an empty market then opens nothing new). */
export function applyReview(book:StrategyBook,reviews:LiveReview[]):StrategyBook&{suspended?:Array<{key:string;why:string;at:string}>}{
  const out=reviews.filter(r=>r.verdict==="suspend");
  return{...book,entries:book.entries.filter(e=>!out.some(r=>r.key===`${e.symbol} ${e.timeframe} ${e.strategy}`)),
    suspended:[...((book as any).suspended??[]),...out.map(r=>({key:r.key,why:r.why,at:new Date().toISOString()}))]};
}
