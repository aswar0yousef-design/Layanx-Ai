import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import {loadStrategyBook,saveStrategyBook} from "./strategy-book.js";
import {applyReview,readJournal,reviewLive} from "./trade-journal.js";

/**
 * Once a week, while LayanX runs: (1) the live trades in the journal are compared with what each strategy's history
 * promised, and a failing one is suspended; (2) every strategy is measured again on the newest prices from the DEMO
 * account and the book is rewritten from that measurement (suspended strategies stay out). Nothing is traded here, and the
 * measurement refuses to run on a real account. LAYANX_TRADING_LEARNING=off stops it; it only runs once a book exists.
 */
const WEEK=7*24*3600_000;
export function weeklyTradingDue(store:string,now=Date.now()):boolean{
  if(process.env.LAYANX_TRADING_LEARNING==="off"||!loadStrategyBook())return false;
  try{const last=JSON.parse(fs.readFileSync(path.join(store,"trading-learning.json"),"utf8")).at as string;return now-Date.parse(last)>=WEEK;}catch{return true;}
}
export async function runWeeklyTradingLearning(store:string,options:{root?:string;remeasure?:(root:string)=>Promise<number>}={}):Promise<{suspended:string[];remeasured:boolean}>{
  const record=(o:Record<string,unknown>)=>{fs.mkdirSync(store,{recursive:true});fs.writeFileSync(path.join(store,"trading-learning.json"),JSON.stringify({at:new Date().toISOString(),...o},null,2));};
  const book=loadStrategyBook();
  if(!book){record({skipped:"no strategy book"});return{suspended:[],remeasured:false};}
  const reviews=reviewLive(book,readJournal());
  const out=reviews.filter(r=>r.verdict==="suspend").map(r=>r.key);
  if(out.length)saveStrategyBook(applyReview(book,reviews));
  const root=options.root??process.cwd();
  const remeasure=options.remeasure??((dir:string)=>new Promise<number>(resolve=>{
    const child=spawn(process.execPath,[path.join(dir,"node_modules","tsx","dist","cli.mjs"),"scripts/strategy-backtest.ts","--write-book"],{cwd:dir,windowsHide:true,stdio:"ignore"});
    const timer=setTimeout(()=>child.kill(),90*60_000);
    child.on("close",code=>{clearTimeout(timer);resolve(code??1);});child.on("error",()=>{clearTimeout(timer);resolve(1);});
  }));
  const code=await remeasure(root).catch(()=>1);
  record({suspended:out,reviews:reviews.map(r=>({key:r.key,verdict:r.verdict,why:r.why})),remeasured:code===0,remeasureExit:code});
  return{suspended:out,remeasured:code===0};
}
