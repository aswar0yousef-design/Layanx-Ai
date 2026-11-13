import fs from "node:fs";
import path from "node:path";
import {resolveDataPaths} from "../platform/paths.js";
import type {StrategyName} from "./strategies.js";
import type {BacktestStats} from "./strategy-backtest.js";

/**
 * Which strategies the robot may trade, per market and timeframe: written only by a measurement
 * (scripts/strategy-backtest.ts --write-book), never by hand or by a model, and read by the live robot. An empty book means
 * no strategy earned its place yet: the robot then opens nothing new (it still manages open trades).
 */
export interface StrategyBookEntry{symbol:string;timeframe:string;strategy:StrategyName;firstHalf:BacktestStats;secondHalf:BacktestStats;quartersPositive:number}
export interface StrategyBook{measuredAt:string;source:string;keepRule:Record<string,number>;entries:StrategyBookEntry[]}
export function strategyBookPath(env:NodeJS.ProcessEnv=process.env){return env.LAYANX_STRATEGY_BOOK?.trim()||path.join(resolveDataPaths().dataDir,"trading","strategy-book.json");}
export function loadStrategyBook(file=strategyBookPath()):StrategyBook|null{
  try{const b=JSON.parse(fs.readFileSync(file,"utf8")) as StrategyBook;return Array.isArray(b.entries)?b:null;}catch{return null;}
}
export function saveStrategyBook(book:StrategyBook,file=strategyBookPath()):string{
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+".tmp";fs.writeFileSync(tmp,JSON.stringify(book,null,2),{mode:0o600});fs.renameSync(tmp,file);
  return file;
}
/**
 * Scalping (M1, M5) is off: every measurement lost more than it won there, the spread eating small trades (2026-11-13), and
 * the owner decided to drop it. Only the owner can bring it back (MT5_ALLOW_SCALPING=on).
 */
export const SCALPING_TIMEFRAMES=["M1","M5"];
export const scalpingAllowed=(env:NodeJS.ProcessEnv=process.env)=>env.MT5_ALLOW_SCALPING==="on";
/** No book at all: the robot opens nothing new (it never falls back to the old signal that lost on history). */
export const EMPTY_BOOK:StrategyBook={measuredAt:"",source:"none",keepRule:{},entries:[]};
/** The strategies switched on for one market and timeframe (the plain name "XAUUSD" also matches the broker's "XAUUSD_"). */
export function enabledStrategies(book:StrategyBook|null,symbol:string,timeframe:string):StrategyName[]{
  if(!book)return[];
  if(SCALPING_TIMEFRAMES.includes(timeframe)&&!scalpingAllowed())return[];
  const base=symbol.replace(/[._#][A-Za-z]?$/,"").toUpperCase();
  return book.entries.filter(e=>e.symbol.replace(/[._#][A-Za-z]?$/,"").toUpperCase()===base&&e.timeframe===timeframe).map(e=>e.strategy);
}
