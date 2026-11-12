/**
 * One place that knows about both the store and trading. Each side keeps its own agent and its own tools. This layer sends
 * a goal to the right side, stops either side from reaching into the other, refuses to move money between them on its own,
 * and gives the owner one report. A side that cannot be read is reported as unknown, never as zero.
 */
export type Domain="store"|"trading"|"other";
export interface Routing{domain:Domain;agentId:string;needsOwner:boolean;reason?:string}
export interface DomainReader{store():Promise<Record<string,unknown>>;trading():Promise<Record<string,unknown>>}

// Diacritics out first: «حوّل» (with a shadda) did not match «حول» (found 2026-11-13).
const plain=(text:string)=>text.toLowerCase().replace(/[\u064B-\u0652\u0640]/g,"").replace(/[أإآ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه");
const STORE=/متجر|طلبات|منتج|شحن|فاتور|عميل|عملاء|woocommerce|\bstore\b|\borders?\b|\bproducts?\b|shipping|invoice|customers?/;
const TRADING=/تداول|صفق|ذهب|فوركس|بينانس|عملات رقميه|سكالب|\bmt5\b|binance|\btrad(?:e|es|ing)\b|xauusd|scalp/;
const MONEY_MOVE=/حول|انقل|استخدم|ادخل|خذ|اسحب|ضع|استثمر|transfer|move|use|invest|put|withdraw/;
const MONEY=/ارباح|فلوس|مال|اموال|رصيد|ايرادات|مبلغ|profit|money|funds?|balance|revenue/;
export const STORE_AGENT="business",TRADING_AGENT="trading-executor";
/**
 * Moving, sending, paying or withdrawing money, anywhere: the owner does it, never LayanX. Found 2026-11-13 on WhatsApp:
 * "transfer 500 from the store profits to the trading account" reached a chat model that answered as if it had done it.
 */
const TRANSFER=/(?:^|\s)(?:حول|حولي|انقل|ارسل|اسحب|اودع|ابعث|transfer|send|wire|withdraw|deposit|move)(?=\s|$)/;
const PAY=/(?:^|\s)(?:ادفع|سدد|pay|settle)(?=\s|$)/;
const CASH=/ارباح|فلوس|مال(?:\s|$)|اموال|رصيد|مبلغ|ريال|دولار|درهم|دينار|يورو|جنيه|usdt|usdc|btc|\$|\busd\b|\bsar\b|\beur\b|profits?|money|funds?|balance|cash/;
const BILL=/فاتوره|فواتير|invoice|bill|مستحق|due/;
const ACCOUNT=/حساب|محفظ|بنك|بطاقه|account|wallet|bank|card/;
export const MONEY_REFUSAL="تحويل الأموال أو دفعها أو سحبها قرارك أنت، وتنفذه بنفسك خارج LayanX. لن أقوم به، ولم يُنقل أي مال.";
export function movesMoney(goal:string):boolean{const t=plain(goal);return TRANSFER.test(t)&&(CASH.test(t)||/\d/.test(t)&&ACCOUNT.test(t))||PAY.test(t)&&(BILL.test(t)||CASH.test(t)||ACCOUNT.test(t));}

export function routeGoal(goal:string):Routing{
  const text=plain(goal),store=STORE.test(text),trading=TRADING.test(text);
  if(movesMoney(goal))return{domain:"other",agentId:"core",needsOwner:true,reason:"Moving, sending, paying or withdrawing money is the owner's decision, made outside LayanX."};
  if(store&&trading){
    if(MONEY_MOVE.test(text)&&MONEY.test(text))return{domain:"other",agentId:"core",needsOwner:true,reason:"Moving money between the store and trading is the owner's decision, made outside LayanX."};
    return{domain:"other",agentId:"core",needsOwner:false,reason:"Touches both the store and trading: split it, one side at a time."};
  }
  if(store)return{domain:"store",agentId:STORE_AGENT,needsOwner:false};
  if(trading)return{domain:"trading",agentId:TRADING_AGENT,needsOwner:false};
  return{domain:"other",agentId:"core",needsOwner:false};
}
const STORE_TOOLS=/^(?:commerce|shipping|ads|growth|content|campaign|email\.invoices)\b/;
const TRADING_TOOLS=/^trading\b/;
/** Why this agent may not use this tool, or undefined when the boundary allows it. Permissions are still checked after this. */
export function crossDomainRefusal(agentId:string,tool:string):string|undefined{
  if(agentId===STORE_AGENT&&TRADING_TOOLS.test(tool))return"The store agent has no access to trading.";
  if(agentId===TRADING_AGENT&&STORE_TOOLS.test(tool))return"The trading agent has no access to the store.";
  return undefined;
}
export interface DomainSection{ok:boolean;data?:Record<string,unknown>;problem?:string}
/** One report over both. Each side is read on its own, so a failure in one does not hide the other. */
export async function domainBrief(reader:DomainReader,timeoutMs=20_000,now:()=>Date=()=>new Date()){
  const read=async(load:()=>Promise<Record<string,unknown>>):Promise<DomainSection>=>{
    let timer:NodeJS.Timeout|undefined;
    try{
      const data=await Promise.race([load(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("no answer in time")),timeoutMs);})]);
      return{ok:true,data};
    }catch(error){return{ok:false,problem:(error as Error).message.slice(0,300)};}
    finally{if(timer)clearTimeout(timer);}
  };
  const[store,trading]=await Promise.all([read(()=>reader.store()),read(()=>reader.trading())]);
  return{at:now().toISOString(),store,trading,complete:store.ok&&trading.ok};
}
