import type {StrategyName} from "./strategies.js";

/**
 * Each kind of market behaves differently, so each has its own profile: when it may be traded, which timeframes and
 * strategies are tried on it, and which news it must stay out of. The owner's point (2026-11-13) and the measurements agree:
 * gold trended on M15/H1, forex had nothing on M5, RSI(2) worked in published tests on US stocks but lost on EUR/USD.
 * A profile only decides what is TRIED and WHEN it may trade; whether a strategy is used is still decided by measurement.
 */
export type AssetClass="crypto"|"forex"|"gold"|"silver"|"oil"|"us-stocks"|"us-indices";
export interface AssetProfile{
  label:string;
  /** Hours when a new trade may open, in New York local time [from, to) as minutes after midnight; null: around the clock. */
  newYorkWindow:[number,number]|null;
  /** Days a new trade may open (0 Sunday .. 6 Saturday, New York time). */
  days:number[];
  timeframes:string[];
  strategies:StrategyName[];
  /** News titles that block this market whatever their impact rating (e.g. the weekly US crude inventories for oil). */
  extraNews:RegExp|null;
  /** Close open trades before this New York time (stocks do not hold over the closing auction); null: no session close. */
  closeAtNewYork:number|null;
  why:string;
}
const WEEKDAYS=[1,2,3,4,5];
const TREND:StrategyName[]=["trend-pullback","macd-momentum","donchian-breakout","squeeze-breakout"];
export const PROFILES:Record<AssetClass,AssetProfile>={
  crypto:{label:"العملات الرقمية",newYorkWindow:null,days:[0,1,2,3,4,5,6],timeframes:["M15","H1","H4"],strategies:TREND,extraNews:null,closeAtNewYork:null,
    why:"24/7, strong trends and high volatility: trend and breakout strategies on M15 and above."},
  forex:{label:"الفوركس",newYorkWindow:[2*60,16*60],days:WEEKDAYS,timeframes:["M15","H1","H4"],strategies:[...TREND,"london-breakout"],extraNews:null,closeAtNewYork:null,
    why:"24/5 in sessions: London and New York (02:00-16:00 New York) carry the liquidity; the quiet Asian hours mostly chop."},
  gold:{label:"الذهب",newYorkWindow:[2*60,16*60],days:WEEKDAYS,timeframes:["M15","H1","H4"],strategies:[...TREND,"london-breakout","ny-opening-range"],extraNews:null,closeAtNewYork:null,
    why:"Trends with the dollar and rates; London and New York sessions."},
  silver:{label:"الفضة والمعادن",newYorkWindow:[2*60,16*60],days:WEEKDAYS,timeframes:["M15","H1","H4"],strategies:[...TREND,"london-breakout"],extraNews:null,closeAtNewYork:null,
    why:"Follows gold with more volatility; same sessions."},
  oil:{label:"النفط",newYorkWindow:[8*60,14*60+30],days:WEEKDAYS,timeframes:["M15","H1","H4"],strategies:[...TREND,"ny-opening-range"],
    extraNews:/crude oil inventories|eia|opec/i,closeAtNewYork:null,
    why:"New York session; jumps on the Wednesday US crude inventories report and OPEC news."},
  "us-stocks":{label:"الأسهم الأمريكية",newYorkWindow:[9*60+45,15*60+30],days:WEEKDAYS,timeframes:["M15","H1"],strategies:[...TREND,"rsi2-reversion","ny-opening-range"],
    extraNews:null,closeAtNewYork:15*60+50,
    why:"Only 09:30-16:00 New York; the first 15 minutes are wild and overnight gaps (earnings) are not held, so trades close by 15:50."},
  "us-indices":{label:"المؤشرات الأمريكية",newYorkWindow:[9*60+45,15*60+30],days:WEEKDAYS,timeframes:["M15","H1"],strategies:[...TREND,"rsi2-reversion","ny-opening-range"],
    extraNews:null,closeAtNewYork:15*60+50,
    why:"Move with the US cash session; RSI(2) was built on them."},
};
/** The kind of market a broker symbol is (the MT5 group path helps for stocks: "Equities\\US.Equities\\..."). */
export function assetClassOf(symbol:string,path=""):AssetClass{
  const s=symbol.toUpperCase(),p=path.toUpperCase();
  if(/US\.EQUITIES/.test(p)||/\.(US|OQ|N)$/.test(s))return"us-stocks";
  if(/^(US30|US100|US500|NAS|SPX500|USTEC|DJ30)/.test(s))return"us-indices";
  if(/^XAU/.test(s)||/GOLD/.test(p))return"gold";
  if(/^(XAG|XPT|XPD|COPPER)/.test(s)||/SILVER/.test(p))return"silver";
  if(/^(WTI|BRENT|USOIL|UKOIL|XTI|XBR)/.test(s)||/OIL/.test(p))return"oil";
  if(/^(BTC|ETH|LTC|XRP|SOL|ADA|DOGE)/.test(s)||/CRYPTO/.test(p))return"crypto";
  return"forex";
}
const nyFmt=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hourCycle:"h23",weekday:"short",hour:"2-digit",minute:"2-digit"});
const DAY:Record<string,number>={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
export function newYorkClock(at:Date):{minute:number;day:number}{
  const p:Record<string,string>={};for(const part of nyFmt.formatToParts(at))p[part.type]=part.value;
  return{minute:Number(p.hour)*60+Number(p.minute),day:DAY[p.weekday!]??0};
}
/** May a new trade open now on this kind of market? */
export function inTradingWindow(cls:AssetClass,at:Date):boolean{
  const pr=PROFILES[cls],{minute,day}=newYorkClock(at);
  if(!pr.days.includes(day))return false;
  return!pr.newYorkWindow||(minute>=pr.newYorkWindow[0]&&minute<pr.newYorkWindow[1]);
}
/** Must an open trade be closed now (stocks before the close)? */
export function pastSessionClose(cls:AssetClass,at:Date):boolean{
  const c=PROFILES[cls].closeAtNewYork;if(c===null)return false;
  const {minute,day}=newYorkClock(at);
  return day>=1&&day<=5&&minute>=c;
}
