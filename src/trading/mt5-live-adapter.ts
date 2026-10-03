import {spawn} from "node:child_process";
import {localSecret} from "../security/local-secret-vault.js";
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
}

interface BridgeResponse{ok:boolean;result?:unknown;error?:string;}

function credential(name:string,envName:string):string{
 const value=localSecret(name,process.env[envName]);
 if(!value)throw new Error(`MT5 credential is missing: ${name}.`);
 return value;
}

function pythonCommand():string{
 return process.env.LAYANX_PYTHON ?? (process.platform==="win32" ? "python" : "python3");
}

export class Mt5LiveAdapter implements Mt5Adapter{
 private readonly bridgePath:string;
 private readonly timeoutMs:number;
 constructor(options:{bridgePath?:string;timeoutMs?:number}={}){
  this.bridgePath=options.bridgePath??process.env.LAYANX_MT5_BRIDGE_PATH??"scripts/mt5-bridge.py";
  this.timeoutMs=options.timeoutMs??15_000;
 }
 private async call(action:string,payload:Record<string,unknown>={}):Promise<unknown>{
  const request={
   action,
   payload,
   credentials:{
    login:Number(credential("mt5.login","LAYANX_MT5_LOGIN")),
    password:credential("mt5.password","LAYANX_MT5_PASSWORD"),
    server:credential("mt5.server","LAYANX_MT5_SERVER"),
    terminalPath:localSecret("mt5.terminalPath",process.env.LAYANX_MT5_TERMINAL_PATH),
   },
  };
  if(!Number.isInteger(request.credentials.login)||request.credentials.login<=0)throw new Error("MT5 login must be a positive integer.");
  return await new Promise((resolve,reject)=>{
   const child=spawn(pythonCommand(),[this.bridgePath],{stdio:["pipe","pipe","pipe"],shell:false});
   let stdout="",stderr="";
   const timer=setTimeout(()=>{child.kill();reject(new Error("MT5 bridge timed out."));},this.timeoutMs);
   child.stdout.on("data",chunk=>stdout+=chunk.toString());
   child.stderr.on("data",chunk=>stderr+=chunk.toString());
   child.on("error",error=>{clearTimeout(timer);reject(error);});
   child.on("close",code=>{
    clearTimeout(timer);
    if(code!==0){reject(new Error(`MT5 bridge failed: ${stderr.trim()||`exit ${code}`}`));return;}
    try{
     const response=JSON.parse(stdout.trim()) as BridgeResponse;
     if(!response.ok)reject(new Error(response.error??"MT5 bridge rejected request."));
     else resolve(response.result);
    }catch{reject(new Error(`Invalid MT5 bridge response: ${stdout.slice(0,500)}`));}
   });
   child.stdin.end(JSON.stringify(request));
  });
 }
 async connect():Promise<{login:number;server:string;balance:number;equity:number}>{
  return await this.call("account") as {login:number;server:string;balance:number;equity:number};
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
 async placeOrder(request:Mt5OrderRequest):Promise<Mt5OrderResult>{
  if(process.env.MT5_LIVE_TRADING_ENABLED!=="true")throw new Error("MT5 live execution is disabled. Set MT5_LIVE_TRADING_ENABLED=true only after validating the account and risk limits.");
  return await this.call("order",request as unknown as Record<string,unknown>) as Mt5OrderResult;
 }
 async positions(symbol?:string):Promise<Mt5LivePosition[]>{
  return await this.call("positions",symbol?{symbol}:{}) as Mt5LivePosition[];
 }
 async closePosition(ticket:string):Promise<Mt5OrderResult>{
  if(process.env.MT5_LIVE_TRADING_ENABLED!=="true")throw new Error("MT5 live execution is disabled.");
  return await this.call("close_position",{ticket}) as Mt5OrderResult;
 }
}
