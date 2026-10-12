/**
 * Reads a MetaTrader 5 Strategy Tester report (the .htm the tester writes) into numbers LayanX can judge.
 *
 * Adapted from the mt5-robot-tester skill in tradermonty/claude-trading-skills
 * (skills/mt5-robot-tester/scripts/parse_mt5_report.py and mt5_common.py).
 * Copyright (c) 2026 TraderMonty. MIT License: permission is granted to use, copy, modify and
 * distribute the software, provided this notice is included. The software is provided "as is",
 * without warranty of any kind.
 *
 * The summary labels are matched in English and Spanish, as in the original. A terminal in another
 * language writes other labels; then the metrics come back empty and the result says so.
 */

/** MT5 writes the backtest report in UTF-16 (with or without BOM) and some files in UTF-8. */
export function decodeReport(raw:Buffer):string{
  if(raw.length>=2&&raw[0]===0xff&&raw[1]===0xfe)return raw.subarray(2).toString("utf16le");
  if(raw.length>=2&&raw[0]===0xfe&&raw[1]===0xff){const body=raw.subarray(2);const b=Buffer.from(body.subarray(0,body.length-(body.length%2)));b.swap16();return b.toString("utf16le");}
  if(raw.length>=3&&raw[0]===0xef&&raw[1]===0xbb&&raw[2]===0xbf)return raw.subarray(3).toString("utf8");
  const sample=raw.subarray(0,512);
  let zeros=0;for(const b of sample)if(b===0)zeros++;
  if(zeros>sample.length/4){
    // Without a BOM: little-endian when the zero bytes are the odd ones ("<\0h\0").
    const oddZeros=[...sample].filter((b,i)=>i%2===1&&b===0).length;
    if(oddZeros>=zeros/2)return raw.toString("utf16le");
    const b=Buffer.from(raw.subarray(0,raw.length-(raw.length%2)));b.swap16();return b.toString("utf16le");
  }
  return raw.toString("utf8");
}

const ENTITIES:Record<string,string>={amp:"&",lt:"<",gt:">",quot:"\"",apos:"'",nbsp:" "};
function text(html:string):string{
  return html.replace(/<[^>]*>/g," ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi,(m,e:string)=>{
      if(e[0]!=="#")return ENTITIES[e.toLowerCase()]??m;
      const code=e[1]?.toLowerCase()==="x"?parseInt(e.slice(2),16):parseInt(e.slice(1),10);
      return Number.isInteger(code)&&code>=0&&code<=0x10ffff?String.fromCodePoint(code):"";
    })
    .replace(/\s+/g," ").trim();
}
/** Every table row as a list of cell texts (the report is generated HTML, regular enough for this). */
export function tableRows(html:string):string[][]{
  const rows:string[][]=[];
  for(const tr of html.split(/<tr[\s>]/i).slice(1)){
    const body=tr.split(/<\/tr>/i)[0]!;
    const cells=[...body.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)(?=<t[dh]\b|<\/t[dh]>|$)/gi)].map(m=>text(m[1]!));
    if(cells.length)rows.push(cells);
  }
  return rows;
}

/** "1 234.56", "-12 310,55", "(3.1%)", "7500.00 USD" -> number. */
export function toNumber(token:string|undefined|null):number|null{
  if(token==null)return null;
  let t=String(token).trim().replace(/[()%]/g,"").replace(/[   ]/g,"");
  if(!t||t==="-"||t==="--")return null;
  t=t.includes(",")&&!t.includes(".")?t.replace(",","."):t.replace(/,/g,"");
  const m=/^[-+]?\d*\.?\d+/.exec(t);
  return m?Number(m[0]):null;
}

const NUM="([-+]?\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})*(?:[.,]\\d+)?|[-+]?\\d+(?:[.,]\\d+)?)";
const esc=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
function searchNum(flat:string,labels:string[],pct=false):number|null{
  for(const label of labels){
    const head=esc(label)+"[:\\s]*";
    const m=new RegExp(pct?head+"[^%]{0,40}?"+NUM+"\\s*%":head+NUM,"i").exec(flat);
    if(m)return toNumber(m[1]);
  }
  return null;
}

export interface TesterSummary{netProfit:number|null;deposit:number|null;profitFactor:number|null;sharpeRatio:number|null;lrCorrelation:number|null;totalTrades:number|null;drawdownMaxPct:number|null}
export function parseSummary(rows:string[][]):TesterSummary{
  const flat=rows.map(r=>r.join(" ")).join("  ");
  const dd=["Balance Drawdown Maximal","Reducción máxima del balance","Reduccion maxima del balance","Balance Drawdown Relative","Reducción relativa del balance","Reduccion relativa del balance",
    "Equity Drawdown Maximal","Reducción máxima de la equity","Reducción máxima del capital","Equity Drawdown Relative","Reducción relativa de la equity","Reducción relativa del capital"]
    .map(l=>searchNum(flat,[l],true)).filter((v):v is number=>v!==null);
  const trades=searchNum(flat,["Total Trades","Total de operaciones ejecutadas","Total de operaciones"]);
  return{
    netProfit:searchNum(flat,["Total Net Profit","Beneficio Neto","Beneficio neto"]),
    deposit:searchNum(flat,["Initial Deposit","Depósito inicial","Deposito inicial"]),
    profitFactor:searchNum(flat,["Profit Factor","Factor de beneficio","Factor de rentabilidad"]),
    sharpeRatio:searchNum(flat,["Sharpe Ratio","Ratio de Sharpe"]),
    lrCorrelation:searchNum(flat,["LR Correlation"]),
    totalTrades:trades===null?null:Math.round(trades),
    drawdownMaxPct:dd.length?Math.max(...dd):null
  };
}

type Point={date:string;balance:number};
/** The balance after each deal, from the deals table (a row with a "Balance" column and a time column). */
export function parseDeals(rows:string[][]):Point[]{
  for(let i=0;i<rows.length;i++){
    const lower=rows[i]!.map(c=>c.trim().toLowerCase());
    const bal=lower.indexOf("balance");if(bal<0)continue;
    const time=lower.findIndex(c=>["hora","fecha","time","tiempo"].some(t=>c.includes(t)));if(time<0)continue;
    const points:Point[]=[];
    for(const row of rows.slice(i+1)){
      const d=/(\d{4})\.(\d{2})\.(\d{2})/.exec(row[time]??"");const b=toNumber(row[bal]);
      if(d&&b!==null)points.push({date:`${d[1]}-${d[2]}-${d[3]}`,balance:b});
    }
    if(points.length)return points;
  }
  return[];
}

export interface TesterTimeseries{monthsAnalyzed:number;positiveMonths:number;pctPositiveMonths:number|null;allYearsPositive:boolean|null;yearlyPnl:Record<string,number>;maxMonthsToNewHigh:number|null}
/** Month-end balances across the whole period (carried forward), then monthly/yearly results. */
export function timeseries(points:Point[],deposit:number|null,from?:string,to?:string):TesterTimeseries{
  const empty={monthsAnalyzed:0,positiveMonths:0,pctPositiveMonths:null,allYearsPositive:null,yearlyPnl:{},maxMonthsToNewHigh:null};
  const sorted=[...points].sort((a,b)=>a.date.localeCompare(b.date));
  if(!sorted.length&&(!from||!to))return empty;
  if(deposit===null&&!sorted.length)return empty;
  const start=deposit??sorted[0]!.balance;
  const lastInMonth=new Map<string,number>();for(const p of sorted)lastInMonth.set(p.date.slice(0,7),p.balance);
  const first=(from??sorted[0]!.date).slice(0,7),last=(to??sorted.at(-1)!.date).slice(0,7);
  if(first>last)return empty;
  const monthEnd:Array<[string,number]>=[];let running=start;
  for(let [y,m]=first.split("-").map(Number) as [number,number];`${y}-${String(m).padStart(2,"0")}`<=last;m===12?(y++,m=1):m++){
    const key=`${y}-${String(m).padStart(2,"0")}`;
    if(lastInMonth.has(key))running=lastInMonth.get(key)!;
    monthEnd.push([key,running]);
  }
  let prev=start,positive=0;for(const [,b] of monthEnd){if(b-prev>0)positive++;prev=b;}
  const yearEnd=new Map<string,number>();for(const [k,b] of monthEnd)yearEnd.set(k.slice(0,4),b);
  const yearlyPnl:Record<string,number>={};let allYears=true;prev=start;
  for(const y of [...yearEnd.keys()].sort()){const pnl=yearEnd.get(y)!-prev;yearlyPnl[y]=Math.round(pnl*100)/100;if(pnl<=0)allYears=false;prev=yearEnd.get(y)!;}
  let peak=start,gap=0,maxGap=0;for(const [,b] of monthEnd){if(b>peak){peak=b;gap=0;}else{gap++;maxGap=Math.max(maxGap,gap);}}
  return{monthsAnalyzed:monthEnd.length,positiveMonths:positive,pctPositiveMonths:monthEnd.length?Math.round(1000*positive/monthEnd.length)/10:null,allYearsPositive:allYears,yearlyPnl,maxMonthsToNewHigh:maxGap};
}

export interface TesterReport extends TesterSummary,TesterTimeseries{profitPct:number|null;dealsCount:number;complete:boolean}
export function parseTesterReport(raw:Buffer,period?:{from?:string;to?:string}):TesterReport{
  const rows=tableRows(decodeReport(raw));
  const summary=parseSummary(rows);
  const deals=parseDeals(rows);
  const series=timeseries(deals,summary.deposit,period?.from,period?.to);
  return{...summary,...series,dealsCount:deals.length,
    profitPct:summary.netProfit!==null&&summary.deposit?Math.round(10000*summary.netProfit/summary.deposit)/100:null,
    complete:summary.netProfit!==null&&summary.deposit!==null};
}
