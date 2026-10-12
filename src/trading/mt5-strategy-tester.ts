import fs from "node:fs";
import path from "node:path";
import {spawn,execFile} from "node:child_process";
import {randomBytes} from "node:crypto";
import {safeChildEnv} from "../platform/safe-env.js";
import {localSecret} from "../security/local-secret-vault.js";
import {parseTesterReport,type TesterReport} from "./mt5-tester-report.js";

/**
 * Runs an Expert Advisor (MQL5 robot) in the MetaTrader 5 Strategy Tester from the command line and
 * reads its report. This is a backtest on history: no order reaches a broker.
 *
 * Safety:
 *  - the terminal is the owner's MT5_TESTER_TERMINAL, a separate *portable* install used only for
 *    testing. The agent cannot choose the program; the live trading terminal is refused, because the
 *    tester closes the terminal when it finishes (ShutdownTerminal=1);
 *  - the robot must already be in that install's MQL5\Experts folder (no paths outside it);
 *  - one test at a time, a time limit, and the exact process LayanX started is the one stopped.
 * Approach adapted from the mt5-robot-tester skill (tradermonty/claude-trading-skills, MIT).
 */
export const TESTER_MODELS={every_tick:0,ohlc_m1:1,open_prices:2,real_ticks:4} as const;
export type TesterModel=keyof typeof TESTER_MODELS;
const PERIODS=["M1","M5","M15","M30","H1","H4","D1","W1"] as const;

export interface TesterRequest{
  expert:string;symbol:string;period?:string;from:string;to:string;model?:TesterModel;
  deposit?:number;currency?:string;leverage?:number;inputs?:Record<string,string|number|boolean>;timeoutMinutes?:number;
}
export interface TesterResult{expert:string;symbol:string;period:string;model:TesterModel;from:string;to:string;durationSeconds:number;reportFile:string;metrics:TesterReport;warnings:string[]}
export interface TesterDeps{
  platform?:NodeJS.Platform;env?:NodeJS.ProcessEnv;now?:()=>number;
  /** Starts the terminal; returns its exit code (null when stopped). Tests replace it. */
  run?:(terminal:string,args:string[],timeoutMs:number)=>Promise<{code:number|null;timedOut:boolean}>;
  /** Where the terminal LayanX trades with lives, when LayanX is connected to it (from the MT5 bridge). */
  liveTerminal?:()=>Promise<{path?:string;dataPath?:string}|null>;
  /** Paths of the terminal64.exe processes running now (Windows); tests replace it. */
  runningTerminals?:()=>Promise<string[]>;
}

/** Running terminal64.exe programs, without starting anything (CIM query through PowerShell). */
function listRunningTerminals():Promise<string[]>{
  const ps=path.join(process.env.SystemRoot??"C:\\Windows","System32","WindowsPowerShell","v1.0","powershell.exe");
  return new Promise((resolve,reject)=>{
    execFile(ps,["-NoProfile","-NonInteractive","-Command","Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'terminal64.exe' } | ForEach-Object { $_.ExecutablePath }"],
      {timeout:20_000,windowsHide:true,env:safeChildEnv({allow:["PSModulePath"]}),encoding:"utf8"},
      (error,stdout)=>error?reject(error):resolve(String(stdout).split(/\r?\n/).map(l=>l.trim()).filter(Boolean)));
  });
}

class TesterError extends Error{constructor(message:string){super(message);this.name="TesterError";}}
let running=false;

/** Same folder or file, after resolving links and 8.3 short names where the path exists. */
function same(a:string,b:string,win:boolean){
  const n=(p:string)=>{let r=path.resolve(p);try{r=fs.realpathSync.native(r);}catch{}return r.replace(/[\\/]+$/,"");};
  return win?n(a).toLowerCase()===n(b).toLowerCase():n(a)===n(b);
}

/** Checks the owner's tester terminal setting and returns it with its (portable) data folder. */
export function testerTerminal(env:NodeJS.ProcessEnv=process.env,platform:NodeJS.Platform=process.platform){
  const terminal=env.MT5_TESTER_TERMINAL?.trim();
  if(!terminal)throw new TesterError("The Strategy Tester is not set up: install a separate portable copy of MetaTrader 5 for testing and set MT5_TESTER_TERMINAL to its terminal64.exe (see docs/MT5-STRATEGY-TESTER.md).");
  if(!path.isAbsolute(terminal)||!/terminal64\.exe$/i.test(terminal))throw new TesterError("MT5_TESTER_TERMINAL must be the full path to terminal64.exe.");
  if(!fs.existsSync(terminal))throw new TesterError(`MT5_TESTER_TERMINAL does not exist: ${terminal}`);
  const live=localSecret("mt5.terminalPath",env.LAYANX_MT5_TERMINAL_PATH);
  if(live&&same(live,terminal,platform==="win32"))throw new TesterError("MT5_TESTER_TERMINAL is the live trading terminal. Use a separate portable install for testing: the tester closes its terminal when it finishes.");
  return{terminal,dataDir:path.dirname(terminal)};
}

const dateRx=/^(\d{4})-(\d{2})-(\d{2})$/;
function day(value:string,name:string){
  const m=dateRx.exec(String(value??"").trim());
  const d=m?new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))):null;
  if(!m||!d||d.getUTCFullYear()!==Number(m[1])||d.getUTCMonth()!==Number(m[2])-1||d.getUTCDate()!==Number(m[3]))throw new TesterError(`${name} must be a real date like 2025-01-31.`);
  return m;
}
/** Validates the request; everything written to the INI file is plain ASCII with no line breaks. */
export function normalizeRequest(input:TesterRequest,dataDir:string,now=Date.now()){
  const expert=String(input.expert??"").trim().replace(/\//g,"\\").replace(/\.ex5$/i,"");
  if(!/^[A-Za-z0-9_\- .\\]{1,120}$/.test(expert)||expert.split("\\").some(p=>!p.trim()||p.trim()===".."||p.trim()==="."))
    throw new TesterError("expert must be the robot's name inside MQL5\\Experts, for example \"Advisors\\\\MyRobot\" (letters, digits, spaces, - _ . and \\ only).");
  const ex5=path.join(dataDir,"MQL5","Experts",...expert.split("\\"))+".ex5";
  if(!fs.existsSync(ex5))throw new TesterError(`Robot not found: ${ex5}. Copy the compiled .ex5 into the tester install's MQL5\\Experts folder.`);
  const symbol=String(input.symbol??"").trim();
  if(!/^[A-Za-z0-9._#+\-]{1,32}$/.test(symbol))throw new TesterError("symbol must be a symbol name like XAUUSD or EURUSD.m");
  const period=String(input.period??"H1").trim().toUpperCase();
  if(!(PERIODS as readonly string[]).includes(period))throw new TesterError(`period must be one of ${PERIODS.join(", ")}.`);
  const model=(input.model??"ohlc_m1") as TesterModel;
  if(typeof model!=="string"||!Object.hasOwn(TESTER_MODELS,model))throw new TesterError(`model must be one of ${Object.keys(TESTER_MODELS).join(", ")}.`);
  const f=day(input.from,"from"),t=day(input.to,"to");
  if(input.from>=input.to)throw new TesterError("from must be before to.");
  if(Date.parse(`${input.from}T00:00:00Z`)>now)throw new TesterError("from is in the future.");
  const deposit=Math.round(Number(input.deposit??10000));
  if(!Number.isFinite(deposit)||deposit<100||deposit>100_000_000)throw new TesterError("deposit must be between 100 and 100,000,000.");
  const currency=String(input.currency??"USD").trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency))throw new TesterError("currency must be a 3-letter code like USD.");
  const leverage=Math.round(Number(input.leverage??100));
  if(!Number.isFinite(leverage)||leverage<1||leverage>3000)throw new TesterError("leverage must be between 1 and 3000 (meaning 1:N).");
  const inputs:Array<[string,string]>=[];
  for(const [k,v] of Object.entries(input.inputs??{}).slice(0,64)){
    if(!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(k))throw new TesterError(`Invalid robot input name: ${k}`);
    const value=typeof v==="boolean"?(v?"true":"false"):String(v);
    if(!/^[A-Za-z0-9_.+\- :]{0,100}$/.test(value)||value.includes("||"))throw new TesterError(`Invalid value for robot input ${k}.`);
    inputs.push([k,value]);
  }
  return{expert,symbol,period,model,from:input.from,to:input.to,fromIni:`${f[1]}.${f[2]}.${f[3]}`,toIni:`${t[1]}.${t[2]}.${t[3]}`,deposit,currency,leverage,inputs};
}

export function testerIni(r:ReturnType<typeof normalizeRequest>,reportName:string){
  const lines=["[Tester]",`Expert=${r.expert}`,`Symbol=${r.symbol}`,`Period=${r.period}`,`Model=${TESTER_MODELS[r.model]}`,
    `FromDate=${r.fromIni}`,`ToDate=${r.toIni}`,"ForwardMode=0","Optimization=0",`Deposit=${r.deposit}`,`Currency=${r.currency}`,`Leverage=${r.leverage}`,
    `Report=${reportName}`,"ReplaceReport=1","ShutdownTerminal=1","Visual=0"];
  if(r.inputs.length)lines.push("","[TesterInputs]",...r.inputs.map(([k,v])=>`${k}=${v}`));
  return lines.join("\r\n")+"\r\n";
}

function defaultRun(terminal:string,args:string[],timeoutMs:number):Promise<{code:number|null;timedOut:boolean}>{
  return new Promise((resolve,reject)=>{
    const child=spawn(terminal,args,{cwd:path.dirname(terminal),shell:false,windowsHide:false,stdio:"ignore",env:safeChildEnv()});
    let timedOut=false,settled=false;
    const finish=(r:{code:number|null;timedOut:boolean})=>{if(!settled){settled=true;clearTimeout(timer);resolve(r);}};
    const timer=setTimeout(()=>{
      timedOut=true;
      // The tester starts its own agents (metatester64.exe): stop the whole tree LayanX started.
      if(process.platform==="win32"&&child.pid)spawn(path.join(process.env.SystemRoot??"C:\\Windows","System32","taskkill.exe"),["/PID",String(child.pid),"/T","/F"],{stdio:"ignore",windowsHide:true}).on("error",()=>child.kill());
      else child.kill();
      // Never wait forever for a process that does not stop: the run lock must be released.
      setTimeout(()=>finish({code:null,timedOut:true}),30_000).unref();
    },timeoutMs);
    child.on("error",e=>{if(!settled){settled=true;clearTimeout(timer);reject(e);}});
    child.on("exit",code=>finish({code,timedOut}));
  });
}

export async function runStrategyTest(input:TesterRequest,deps:TesterDeps={}):Promise<TesterResult>{
  const platform=deps.platform??process.platform;const env=deps.env??process.env;const now=deps.now??Date.now;
  if(platform!=="win32"&&!deps.run)throw new TesterError("The MetaTrader 5 Strategy Tester runs on Windows only.");
  const {terminal,dataDir}=testerTerminal(env,platform);
  const r=normalizeRequest(input,dataDir,now());
  let live:{path?:string;dataPath?:string}|null=null;
  try{live=await deps.liveTerminal?.()??null;}
  catch(error){throw new TesterError(`Could not check which MetaTrader 5 LayanX trades with (${error instanceof Error?error.message:String(error)}); the test was not started.`);}
  if(live&&[live.path,live.dataPath].some(p=>p&&same(p,dataDir,platform==="win32")))
    throw new TesterError("MT5_TESTER_TERMINAL is the terminal LayanX trades with. Use a separate portable install for testing: the tester closes its terminal when it finishes.");
  // Without a connection there is nothing to ask, but a running copy of this very terminal would be
  // closed by the test (it may be the one you trade with): it must be closed first.
  const lister=deps.runningTerminals??(process.platform==="win32"&&platform==="win32"?listRunningTerminals:null);
  const runningNow=lister?await lister().catch(()=>null):[];
  if(runningNow?.some(p=>same(p,terminal,platform==="win32")))
    throw new TesterError(`The tester terminal is already open (${terminal}). Close it first; if it is the MetaTrader 5 you trade with, install a separate portable copy for testing.`);
  if(running)throw new TesterError("A Strategy Tester run is already in progress; wait for it to finish.");
  running=true;
  const started=now();
  try{
    const id=`lx-${new Date(started).toISOString().slice(0,10).replace(/-/g,"")}-${randomBytes(4).toString("hex")}`;
    const folder=path.join(dataDir,"layanx-tester");fs.mkdirSync(folder,{recursive:true});
    const ini=path.join(folder,`${id}.ini`);
    // The tester writes the report relative to its data folder (an absolute Report= is ignored by recent builds).
    const reportName=`layanx-tester\\${id}`;
    fs.writeFileSync(ini,testerIni(r,reportName),{encoding:"ascii",flag:"wx"});
    const minutes=Math.min(Math.max(Number(input.timeoutMinutes??env.MT5_TESTER_TIMEOUT_MINUTES??30)||30,1),180);
    // A path with spaces is passed relative to the terminal's folder (it starts there), so the terminal
    // never has to parse a quoted /config argument.
    const configArg=/\s/.test(ini)?path.relative(dataDir,ini):ini;
    const exit=await (deps.run??defaultRun)(terminal,[`/config:${configArg}`,"/portable"],minutes*60_000);
    const report=[".htm",".html"].map(ext=>path.join(folder,id+ext)).find(f=>fs.existsSync(f));
    if(exit.timedOut)throw new TesterError(`The test did not finish within ${minutes} minutes and was stopped. Try a shorter period, model "ohlc_m1" or "open_prices", or a longer timeoutMinutes.`);
    if(!report)throw new TesterError(`The tester closed without a report (exit code ${exit.code}). Check that: the tester terminal is not already open; it is logged in to a broker account (demo is fine) so it can download history for ${r.symbol}; the robot compiles; and the symbol exists at that broker.`);
    const metrics=parseTesterReport(fs.readFileSync(report),{from:r.from,to:r.to});
    const warnings:string[]=[];
    if(!metrics.complete)warnings.push("The report summary could not be read. Set the tester terminal's language to English (View > Languages) and run again.");
    if(metrics.totalTrades===0)warnings.push("The robot made no trades in this period.");
    if(r.model!=="real_ticks"&&r.model!=="every_tick")warnings.push(`Model "${r.model}" is fast but approximate; confirm a promising result with "real_ticks".`);
    return{expert:r.expert,symbol:r.symbol,period:r.period,model:r.model,from:r.from,to:r.to,durationSeconds:Math.round((now()-started)/1000),reportFile:report,metrics,warnings};
  }finally{running=false;}
}
