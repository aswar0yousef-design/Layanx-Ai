import {spawn,type ChildProcessWithoutNullStreams} from "node:child_process";
import {createInterface} from "node:readline";
import {randomBytes} from "node:crypto";
import {localSecret} from "../security/local-secret-vault.js";
import {safeChildEnv} from "../platform/safe-env.js";
import type {TradeSide} from "./execution-quality.js";
import type {MarketCandle} from "./scalping-signal.js";
import type {BrokerSymbolSpecification} from "./broker-symbol-spec.js";
import type {Mt5Adapter,Mt5CandleRequest,Mt5OrderRequest,Mt5OrderResult,Mt5SymbolSnapshot} from "./mt5-adapter.js";

export interface Mt5LivePosition{
 ticket:string;
 symbol:string;
 side:TradeSide;
 quantity:number;
 price:number;
 stopLoss?:number;
 takeProfit?:number;
 profit:number;
 magic?:number;
 comment?:string;
 openedAt?:string;
}
export interface Mt5AccountInfo{
 login:number;server:string;balance:number;equity:number;
 currency?:string;leverage?:number;
 /** demo | contest | real, as the broker reports it. */
 tradeMode?:"demo"|"contest"|"real";
 /** Algo Trading on in the terminal and trading allowed on the account. */
 tradeAllowed?:boolean;
 terminalConnected?:boolean;
 realTradingAllowedByOwner?:boolean;
}
/** Times are the broker server's clock (MetaTrader reports them that way), written as ISO strings. */
export interface Mt5ClosedDeal{ticket:string;positionId:string;symbol:string;closedAt:string;quantity:number;price:number;profit:number;commission:number;swap:number;magic:number;comment:string}
export interface Mt5HistoryRequest{days?:number;symbol?:string;onlyLayanX?:boolean}
export interface Mt5OrderLookup{found:boolean;where?:"position"|"order"|"history";ticket?:string;price?:number;quantity?:number}
export interface Mt5TerminalInfo{path:string;dataPath:string;connected:boolean}

/** The bridge answered and said no (bad symbol, real account, Algo Trading off...): nothing was sent. */
export class Mt5BridgeError extends Error{constructor(message:string){super(message);this.name="Mt5BridgeError";}}
/** The bridge did not answer in time. For an order this does not mean it failed. */
export class Mt5TimeoutError extends Error{constructor(readonly action:string){super(`MT5 bridge did not answer "${action}" in time.`);this.name="Mt5TimeoutError";}}
/** An order whose result is unknown: it may still appear on the account. Check before trading again. */
export class Mt5UnknownOutcomeError extends Error{constructor(readonly clientOrderId:string,cause?:string){super(`MT5 did not confirm order ${clientOrderId} and it is not on the account yet${cause?` (${cause})`:""}. Check open positions before trading again.`);this.name="Mt5UnknownOutcomeError";}}

interface BridgeResponse{id?:number;ok:boolean;result?:unknown;error?:string;unknown?:boolean}
interface Job{action:string;payload:Record<string,unknown>;timeoutMs:number;resolve:(v:unknown)=>void;reject:(e:Error)=>void;beforeSend?:()=>boolean}
export interface Mt5OpenOrder{ticket:string;symbol:string;quantity:number;magic:number;comment:string}

const CLIENT_ID=/^[A-Za-z0-9_-]{1,24}$/;
export const DEFAULT_MT5_MAGIC=2601004;

function pythonCommand():string{
 return process.env.LAYANX_PYTHON ?? (process.platform==="win32" ? "python" : "python3");
}
/** Login, password and server are optional: without all three the bridge uses the terminal that is already logged in. */
function credentials(){
 const login=localSecret("mt5.login",process.env.LAYANX_MT5_LOGIN);
 const password=localSecret("mt5.password",process.env.LAYANX_MT5_PASSWORD);
 const server=localSecret("mt5.server",process.env.LAYANX_MT5_SERVER);
 const terminalPath=localSecret("mt5.terminalPath",process.env.LAYANX_MT5_TERMINAL_PATH);
 const out:Record<string,unknown>={};
 if(terminalPath)out.terminalPath=terminalPath;
 if(login&&password&&server){
  const n=Number(login);
  if(!Number.isInteger(n)||n<=0)throw new Error("MT5 login must be a positive integer.");
  Object.assign(out,{login:n,password,server});
 }
 return out;
}
export function mt5Settings(env:NodeJS.ProcessEnv=process.env){
 const num=(v:string|undefined,d:number,min:number,max:number)=>{if(v===undefined||v.trim()==="")return d;const n=Math.floor(Number(v));return Number.isFinite(n)?Math.min(Math.max(n,min),max):d;};
 return{
  deviation:num(env.MT5_MAX_DEVIATION_POINTS,20,0,1000),
  magic:num(env.MT5_MAGIC_NUMBER,DEFAULT_MT5_MAGIC,1,2_000_000_000),
  allowReal:env.MT5_ALLOW_REAL_ACCOUNT==="true",
 };
}
export function newClientOrderId(){return "lx"+Date.now().toString(36)+randomBytes(3).toString("hex");}
/** JSON with every non-ASCII character escaped, so the pipe's code page never matters. */
const asciiJson=(v:unknown)=>JSON.stringify(v).replace(/[\u007f-￿]/g,c=>"\\u"+c.charCodeAt(0).toString(16).padStart(4,"0"));

/**
 * One Python process per adapter, kept open: the terminal connection is made once, not before every
 * request. Requests go one at a time, and a request's time limit starts when it is sent, so a quick
 * read can never time out behind a slow order and kill it. The child gets a minimal environment (no
 * LayanX secrets); credentials, when the owner stored them, travel on stdin with each request.
 */
export class Mt5LiveAdapter implements Mt5Adapter{
 private readonly bridgePath:string;
 private readonly timeoutMs:number;
 private readonly orderTimeoutMs:number;
 private readonly extraEnv:Record<string,string>;
 private child:ChildProcessWithoutNullStreams|null=null;
 private stderr="";
 private seq=0;
 private readonly queue:Job[]=[];
 private inFlight:{id:number;job:Job;timer:NodeJS.Timeout;child:ChildProcessWithoutNullStreams}|null=null;
 constructor(options:{bridgePath?:string;timeoutMs?:number;orderTimeoutMs?:number;env?:Record<string,string>}={}){
  this.bridgePath=options.bridgePath??process.env.LAYANX_MT5_BRIDGE_PATH??"scripts/mt5-bridge.py";
  this.timeoutMs=options.timeoutMs??15_000;
  this.orderTimeoutMs=options.orderTimeoutMs??Math.max(this.timeoutMs,20_000);
  this.extraEnv=options.env??{};
 }
 /** True while a bridge process is running (it is connected to a terminal or about to be). */
 get running(){return this.child!==null;}
 private start():ChildProcessWithoutNullStreams{
  if(this.child)return this.child;
  const child=spawn(pythonCommand(),[this.bridgePath,"--serve"],{stdio:["pipe","pipe","pipe"],shell:false,windowsHide:true,
   env:safeChildEnv({allow:["PYTHONPATH","PYTHONHOME","VIRTUAL_ENV"],extra:{PYTHONUTF8:"1",PYTHONIOENCODING:"utf-8",...this.extraEnv}})});
  this.child=child;this.stderr="";
  createInterface({input:child.stdout}).on("line",line=>{
   let response:BridgeResponse|null=null;
   try{response=JSON.parse(line) as BridgeResponse;}catch{return;}
   if(!response||typeof response!=="object")return;
   const current=this.inFlight;
   if(!current||current.child!==child||response.id!==current.id){
    // A message without an id is a start-up failure (for example the MetaTrader5 package is missing).
    if(response.id===undefined&&!response.ok&&response.error)this.stderr+=response.error+"\n";
    return;
   }
   clearTimeout(current.timer);this.inFlight=null;
   if(response.ok)current.job.resolve(response.result);
   // "unknown": the bridge could not tell whether the order reached the terminal; not a "no".
   else current.job.reject(response.unknown?new Error(response.error??"MT5 order outcome unknown."):new Mt5BridgeError(response.error??"MT5 bridge rejected request."));
   this.pump();
  });
  child.stderr.on("data",chunk=>{this.stderr=(this.stderr+chunk.toString()).slice(-2000);});
  const gone=(why:string)=>{
   if(this.child===child)this.child=null;
   const current=this.inFlight;
   if(current&&current.child===child){
    clearTimeout(current.timer);this.inFlight=null;
    current.job.reject(new Error(`MT5 bridge stopped (${why}): ${this.stderr.trim().slice(-500)||"no output"}`));
   }
   this.pump();
  };
  child.on("error",error=>gone(error.message));
  // "close" comes after the output has been read, so a start-up error message is not lost. If another
  // process keeps the output pipe open (a terminal the bridge started), "close" can be late: the exit
  // itself then ends the request after a short grace for the output to drain.
  child.on("exit",code=>{if(this.child===child)this.child=null;setTimeout(()=>gone(`exit ${code}`),250).unref();});
  child.on("close",code=>gone(`exit ${code}`));
  child.stdin.on("error",()=>{});
  // The adapter must not keep LayanX (or a one-off CLI command) running on its own; a request in
  // flight keeps the process alive through its timer.
  child.unref();
  for(const s of [child.stdin,child.stdout,child.stderr])(s as unknown as {unref?:()=>void}).unref?.();
  return child;
 }
 private pump(){
  if(this.inFlight||!this.queue.length)return;
  const job=this.queue.shift()!;
  if(job.beforeSend&&!job.beforeSend()){job.reject(new Mt5BridgeError("Not sent: cancelled before it reached MetaTrader 5."));this.pump();return;}
  let child:ChildProcessWithoutNullStreams,request:string;
  try{
   child=this.start();
   request=asciiJson({id:++this.seq,action:job.action,payload:job.payload,credentials:credentials(),settings:{...mt5Settings(),allowManualClose:false}});
  }catch(error){job.reject(error instanceof Error?error:new Error(String(error)));this.pump();return;}
  const id=this.seq;
  const timer=setTimeout(()=>{
   if(this.inFlight?.id!==id)return;
   this.inFlight=null;
   job.reject(new Mt5TimeoutError(job.action));
   // The child may be stuck inside the terminal call: stop it; the next request starts a fresh one.
   if(this.child===child)this.child=null;
   child.kill();
   this.pump();
  },job.timeoutMs);
  this.inFlight={id,job,timer,child};
  child.stdin.write(request+"\n");
 }
 private call(action:string,payload:Record<string,unknown>={},timeoutMs=this.timeoutMs,beforeSend?:()=>boolean):Promise<unknown>{
  return new Promise((resolve,reject)=>{this.queue.push({action,payload,timeoutMs,resolve,reject,...(beforeSend?{beforeSend}:{})});this.pump();});
 }
 /** Stop the bridge process (tests, shutdown). Queued requests fail; the next call starts a new process. */
 dispose(){
  for(const job of this.queue.splice(0))job.reject(new Error("MT5 bridge closed."));
  const c=this.child;this.child=null;if(c&&c.exitCode===null)c.kill();
 }
 async connect():Promise<Mt5AccountInfo>{
  return await this.call("account") as Mt5AccountInfo;
 }
 async terminalInfo():Promise<Mt5TerminalInfo>{
  return await this.call("terminal") as Mt5TerminalInfo;
 }
 async getSymbolSnapshot(symbol:string):Promise<Mt5SymbolSnapshot>{
  return await this.call("tick",{symbol}) as Mt5SymbolSnapshot;
 }
 async getCandles(request:Mt5CandleRequest):Promise<MarketCandle[]>{
  return await this.call("candles",request as unknown as Record<string,unknown>) as MarketCandle[];
 }
 async getSymbolSpecification(symbol:string):Promise<BrokerSymbolSpecification>{
  return await this.call("symbol_spec",{symbol}) as BrokerSymbolSpecification;
 }
 async positions(symbol?:string):Promise<Mt5LivePosition[]>{
  return await this.call("positions",symbol?{symbol}:{}) as Mt5LivePosition[];
 }
 /** Orders sent but not filled yet (pending or still being processed). */
 async orders(symbol?:string):Promise<Mt5OpenOrder[]>{
  return await this.call("orders",symbol?{symbol}:{}) as Mt5OpenOrder[];
 }
 async history(request:Mt5HistoryRequest={}):Promise<Mt5ClosedDeal[]>{
  return await this.call("history",{days:Math.min(Math.max(Math.floor(request.days??7)||7,1),90),...(request.symbol?{symbol:request.symbol}:{}),onlyLayanX:request.onlyLayanX===true}) as Mt5ClosedDeal[];
 }
 async findOrder(clientOrderId:string):Promise<Mt5OrderLookup>{
  return await this.call("find_order",{clientOrderId}) as Mt5OrderLookup;
 }
 /**
  * Sends one market order. It carries a tag (clientOrderId) so it is never sent twice. Only an explicit
  * "no" from the bridge counts as not sent; a timeout or a stopped bridge is checked on the account
  * (by the tag) and otherwise reported as an unknown outcome, never as a plain failure.
  * options.beforeSend is asked right before the order is written to the bridge (it may wait behind
  * other requests): false cancels it, so a scalper stopped meanwhile sends nothing.
  */
 async placeOrder(request:Mt5OrderRequest,options:{beforeSend?:()=>boolean}={}):Promise<Mt5OrderResult>{
  if(process.env.MT5_LIVE_TRADING_ENABLED!=="true")throw new Error("MT5 live execution is disabled. Set MT5_LIVE_TRADING_ENABLED=true only after validating the account and risk limits.");
  const clientOrderId=request.clientOrderId??newClientOrderId();
  if(!CLIENT_ID.test(clientOrderId))throw new Error("clientOrderId must be 1-24 letters, digits, '-' or '_'.");
  try{
   return {...await this.call("order",{...request,clientOrderId},this.orderTimeoutMs,options.beforeSend) as Mt5OrderResult,clientOrderId};
  }catch(error){
   if(error instanceof Mt5BridgeError)throw error;
   const cause=error instanceof Error?error.message:String(error);
   await new Promise(r=>setTimeout(r,1500));
   const found=await this.findOrder(clientOrderId).catch(()=>null);
   if(found?.found)return{accepted:true,brokerOrderId:found.ticket,executedPrice:found.price,executedQuantity:found.quantity,message:"confirmed on the account after the answer was lost",clientOrderId};
   throw new Mt5UnknownOutcomeError(clientOrderId,cause);
  }
 }
 /** Closes one of LayanX's own positions (magic number); positions opened by hand are left alone. */
 async closePosition(ticket:string):Promise<Mt5OrderResult>{
  if(process.env.MT5_LIVE_TRADING_ENABLED!=="true")throw new Error("MT5 live execution is disabled.");
  return await this.call("close_position",{ticket},this.orderTimeoutMs) as Mt5OrderResult;
 }
}
