import fs from "node:fs";
import path from "node:path";
import {resolveDataPaths} from "../platform/paths.js";

/**
 * High-impact economic news (central bank rates, jobs, inflation) moves prices in seconds, widens spreads and slips stops.
 * The robot opens no new trade from `beforeMin` minutes before such an event until `afterMin` minutes after it, for the
 * currencies its market depends on. The calendar is the public weekly feed most retail traders use (read only, nothing is
 * sent), kept on disk so a short outage does not leave the robot blind; with no calendar at all it says so in its log.
 */
export interface NewsEvent{title:string;country:string;date:string;impact:string}
export interface NewsBlock{title:string;country:string;at:string;minutesAway:number}
export const CALENDAR_URL="https://nfs.faireconomy.media/ff_calendar_thisweek.json";

/** The currencies a market moves with: gold, oil and crypto are priced in dollars; a pair moves with both its currencies. */
export function currenciesFor(symbol:string):string[]{
  // US stocks ("AAPL.US", "TSLA.OQ") and US indices move with the dollar's news, not as a currency pair.
  if(/\.(US|OQ|N)$/i.test(symbol)||/^(US30|US100|US500|NAS|SPX500|USTEC|DJ30)/i.test(symbol))return["USD"];
  const s=symbol.toUpperCase().replace(/[^A-Z]/g,"");
  if(/^(XAU|XAG|GOLD|SILVER|WTI|BRENT|USOIL|UKOIL|BTC|ETH)/.test(s))return["USD"];
  const pair=/^([A-Z]{3})([A-Z]{3})/.exec(s);
  return pair?[pair[1]!,pair[2]!]:["USD"];
}
/** `extra`: titles that block this market whatever their impact (the weekly crude inventories for oil). */
export function newsBlock(symbol:string,now:Date,events:NewsEvent[],beforeMin=30,afterMin=30,extra:RegExp|null=null):NewsBlock|null{
  const wanted=new Set([...currenciesFor(symbol),"ALL"]);
  let best:NewsBlock|null=null;
  for(const e of events){
    if(!wanted.has(e.country.toUpperCase()))continue;
    if(!/^high$/i.test(e.impact)&&!(extra&&extra.test(e.title)))continue;
    const t=Date.parse(e.date);if(!Number.isFinite(t))continue;
    const minutes=(t-now.getTime())/60_000;
    if(minutes<=beforeMin&&minutes>=-afterMin&&(!best||Math.abs(minutes)<Math.abs(best.minutesAway)))
      best={title:e.title,country:e.country,at:new Date(t).toISOString(),minutesAway:Math.round(minutes)};
  }
  return best;
}
/** The calendar, refreshed at most hourly; the last good copy is used when the feed cannot be reached. */
export class NewsCalendar{
  private events:NewsEvent[]|null=null;private fetchedAt=0;
  constructor(private readonly file=path.join(resolveDataPaths().dataDir,"trading","calendar.json"),private readonly fetcher:typeof fetch=fetch,private readonly now:()=>number=Date.now){}
  async get():Promise<{events:NewsEvent[];fresh:boolean}|null>{
    if(this.events&&this.now()-this.fetchedAt<3_600_000)return{events:this.events,fresh:true};
    try{
      const r=await this.fetcher(CALENDAR_URL,{headers:{"user-agent":"Mozilla/5.0 (LayanX trading calendar)"},signal:AbortSignal.timeout(15_000)});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const data=await r.json() as unknown;
      if(!Array.isArray(data))throw new Error("not a list");
      this.events=data.filter((e:any)=>e&&typeof e.title==="string"&&typeof e.date==="string").map((e:any)=>({title:e.title,country:String(e.country??""),date:e.date,impact:String(e.impact??"")}));
      this.fetchedAt=this.now();
      try{fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file,JSON.stringify({fetchedAt:new Date(this.fetchedAt).toISOString(),events:this.events}));}catch{}
      return{events:this.events,fresh:true};
    }catch{
      try{const saved=JSON.parse(fs.readFileSync(this.file,"utf8"));if(Array.isArray(saved.events)){this.events=saved.events;this.fetchedAt=this.now()-3_000_000;return{events:saved.events,fresh:false};}}catch{}
      return null;
    }
  }
}
