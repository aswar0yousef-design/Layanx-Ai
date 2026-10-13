import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {runStrategyTest,normalizeRequest,testerIni,testerTerminal} from "../src/trading/mt5-strategy-tester.js";
import {parseTesterReport,toNumber,decodeReport} from "../src/trading/mt5-tester-report.js";

// MetaTrader 5 Strategy Tester from LayanX: a separate portable terminal chosen by the owner, the robot
// from its MQL5\Experts folder, an INI the agent cannot inject into, and the report read into numbers.
const fixture=fs.readFileSync(new URL("./fixtures/mt5-tester-report.htm",import.meta.url),"utf8");
const utf16=(s:string)=>Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(s,"utf16le")]);

// 1. The report: UTF-16 (as MT5 writes it) and UTF-8 read the same; month and year results from the deals.
const report=parseTesterReport(utf16(fixture),{from:"2024-01-01",to:"2025-03-31"});
assert.deepEqual(parseTesterReport(Buffer.from(fixture,"utf8"),{from:"2024-01-01",to:"2025-03-31"}),report);
assert.deepEqual(parseTesterReport(Buffer.from(fixture,"utf16le"),{from:"2024-01-01",to:"2025-03-31"}),report,"UTF-16 without a BOM");
assert.deepEqual(
  {net:report.netProfit,dep:report.deposit,pf:report.profitFactor,sharpe:report.sharpeRatio,lr:report.lrCorrelation,trades:report.totalTrades,dd:report.drawdownMaxPct,pct:report.profitPct},
  {net:920.75,dep:10000,pf:4.41,sharpe:2.17,lr:0.91,trades:7,dd:1.84,pct:9.21});
assert.deepEqual(
  {months:report.monthsAnalyzed,pos:report.positiveMonths,pctPos:report.pctPositiveMonths,years:report.allYearsPositive,yearly:report.yearlyPnl,gap:report.maxMonthsToNewHigh,deals:report.dealsCount,complete:report.complete},
  {months:15,pos:4,pctPos:26.7,years:true,yearly:{"2024":810.75,"2025":110},gap:7,deals:8,complete:true});
assert.equal(toNumber("10 000.00"),10000);assert.equal(toNumber("-12 310,55"),-12310.55);assert.equal(toNumber("4 210.55%"),4210.55);assert.equal(toNumber("--"),null);
assert.equal(decodeReport(Buffer.from([0xef,0xbb,0xbf,0x41])),"A");
// Odd inputs do not throw: a big-endian file with a stray byte, an out-of-range character reference.
assert.equal(decodeReport(Buffer.from([0xfe,0xff,0x00,0x41,0x00])),"A");
assert.equal(parseTesterReport(Buffer.from("<table><tr><td>&#99999999;x</td></tr></table>")).complete,false);
const other=parseTesterReport(utf16(fixture.replace(/Total Net Profit|Initial Deposit/g,"تقرير")));
assert.equal(other.complete,false,"a terminal in another language: incomplete, not wrong");

// 2. Setup checks: an owner-chosen portable terminal, never the live one.
const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-tester-"));
const install=path.join(root,"MT5 Tester");fs.mkdirSync(path.join(install,"MQL5","Experts","Advisors"),{recursive:true});
const terminal=path.join(install,"terminal64.exe");fs.writeFileSync(terminal,"");
fs.writeFileSync(path.join(install,"MQL5","Experts","Advisors","FixtureRobot.ex5"),"");
process.env.LAYANX_SECRET_VAULT_PATH=path.join(root,"no-vault.json");
assert.throws(()=>testerTerminal({}),/not set up.*MT5_TESTER_TERMINAL/);
assert.throws(()=>testerTerminal({MT5_TESTER_TERMINAL:"terminal64.exe"}),/full path/);
assert.throws(()=>testerTerminal({MT5_TESTER_TERMINAL:path.join(root,"missing","terminal64.exe")}),/does not exist/);
assert.throws(()=>testerTerminal({MT5_TESTER_TERMINAL:terminal,LAYANX_MT5_TERMINAL_PATH:terminal}),/live trading terminal/);
assert.equal(testerTerminal({MT5_TESTER_TERMINAL:terminal}).dataDir,install);

// 3. Request checks: no paths outside MQL5\Experts, no INI injection, sane values.
const base={expert:"Advisors\\FixtureRobot",symbol:"XAUUSD",from:"2024-01-01",to:"2025-03-31"};
const ok=normalizeRequest({...base,period:"h1",inputs:{Lots:0.1,UseTrailing:true,Mode:"fast"}},install,Date.parse("2026-10-12"));
assert.deepEqual([ok.expert,ok.period,ok.model,ok.fromIni,ok.toIni,ok.deposit],["Advisors\\FixtureRobot","H1","ohlc_m1","2024.01.01","2025.03.31",10000]);
assert.equal(normalizeRequest({...base,expert:"Advisors/FixtureRobot.ex5"},install).expert,"Advisors\\FixtureRobot","slashes and .ex5 accepted");
for(const [bad,why] of [
  [{expert:"..\\..\\Windows\\notepad"},/expert must be/],[{expert:"C:\\Robots\\x"},/expert must be/],[{expert:"Advisors\\Missing"},/Robot not found/],
  [{symbol:"XAUUSD\r\nShutdownTerminal=0"},/symbol must be/],[{period:"H2"},/period must be/],[{model:"magic"},/model must be/],
  [{from:"2025-03-31",to:"2024-01-01"},/from must be before to/],[{from:"2024/01/01"},/from must be a real date/],[{to:"2024-02-30"},/to must be a real date/],[{from:"2027-01-01",to:"2027-02-01"},/future/],
  [{model:"constructor"},/model must be/],[{model:"__proto__"},/model must be/],
  [{deposit:5},/deposit/],[{currency:"usd1"},/currency/],[{leverage:0},/leverage/],
  [{inputs:{"Lots\nOptimization":"1"}},/Invalid robot input name/],[{inputs:{Lots:"1||0.1||0.1||2||Y"}},/Invalid value/],[{inputs:{Lots:"1\r\n[Tester]"}},/Invalid value/]
] as Array<[Record<string,unknown>,RegExp]>)assert.throws(()=>normalizeRequest({...base,...bad} as any,install,Date.parse("2026-10-12")),why,JSON.stringify(bad));
const ini=testerIni(ok,"layanx-tester\\lx-1");
assert.match(ini,/^\[Tester\]\r\nExpert=Advisors\\FixtureRobot\r\nSymbol=XAUUSD\r\nPeriod=H1\r\nModel=1\r\nFromDate=2024\.01\.01\r\nToDate=2025\.03\.31\r\n/);
assert.match(ini,/Optimization=0\r\n.*Report=layanx-tester\\lx-1\r\nReplaceReport=1\r\nShutdownTerminal=1\r\nVisual=0\r\n\r\n\[TesterInputs\]\r\nLots=0\.1\r\nUseTrailing=true\r\nMode=fast\r\n$/s);

// 4. A run: the terminal gets the INI and /portable; the report it writes is read.
const env={MT5_TESTER_TERMINAL:terminal};
// Which terminal64.exe run now is a slow CIM query on Windows; the tests that need it pass their own list.
const noneRunning=async()=>[] as string[];
const runs:Array<{terminal:string;args:string[];timeoutMs:number}>=[];
const result=await runStrategyTest({...base,inputs:{Lots:0.1}},{platform:"win32",env,runningTerminals:noneRunning,run:async(t,args,timeoutMs)=>{
  runs.push({terminal:t,args,timeoutMs});
  // Like the terminal: a relative /config path is read from the terminal's own folder.
  const iniPath=path.resolve(path.dirname(t),args[0]!.replace(/^\/config:/,""));
  const name=/Report=layanx-tester\\(\S+)/.exec(fs.readFileSync(iniPath,"ascii"))![1]!;
  fs.writeFileSync(path.join(install,"layanx-tester",name+".htm"),utf16(fixture));
  return{code:0,timedOut:false};
}});
assert.equal(runs[0]!.terminal,terminal);assert.equal(runs[0]!.args[1],"/portable");assert.equal(runs[0]!.timeoutMs,30*60_000);
assert.match(runs[0]!.args[0]!,/^\/config:layanx-tester[\\/]lx-\d{8}-[0-9a-f]{8}\.ini$/,"the install path has a space, so the INI is passed relative to it (no quoting needed)");
assert.equal(result.metrics.netProfit,920.75);assert.equal(result.metrics.pctPositiveMonths,26.7);
assert.ok(result.warnings.some(w=>/real_ticks/.test(w)),"a fast model is flagged as approximate");
assert.ok(result.reportFile.startsWith(path.join(install,"layanx-tester")));

// 5. Failures say what to check; only one run at a time.
await assert.rejects(runStrategyTest(base,{platform:"win32",env,runningTerminals:noneRunning,run:async()=>({code:0,timedOut:false})}),/closed without a report.*not already open.*logged in/s);
await assert.rejects(runStrategyTest({...base,timeoutMinutes:1},{platform:"win32",env,runningTerminals:noneRunning,run:async(_t,_a,ms)=>{assert.equal(ms,60_000);return{code:null,timedOut:true};}}),/did not finish within 1 minutes/);
let release!:()=>void;
const slow=runStrategyTest(base,{platform:"win32",env,runningTerminals:noneRunning,run:()=>new Promise(r=>{release=()=>r({code:0,timedOut:false});})});
// Wait until the first run really started its terminal (on Windows the checks before it take a while).
for(let i=0;i<2000&&!release;i++)await new Promise(r=>setTimeout(r,5));
assert.ok(release,"the first run started");
await assert.rejects(runStrategyTest(base,{platform:"win32",env,runningTerminals:noneRunning,run:async()=>({code:0,timedOut:false})}),/already in progress/);
release();await assert.rejects(slow,/without a report/);
await assert.rejects(runStrategyTest(base,{platform:"linux",env}),/Windows only/);
// The terminal LayanX trades with (as the bridge reports it) is refused, by install folder or data folder.
const noRun=async()=>{throw new Error("must not start");};
await assert.rejects(runStrategyTest(base,{platform:"win32",env,runningTerminals:noneRunning,run:noRun,liveTerminal:async()=>({path:install+"/",dataPath:"C:\\elsewhere"})}),/terminal LayanX trades with/);
await assert.rejects(runStrategyTest(base,{platform:"win32",env,runningTerminals:noneRunning,run:noRun,liveTerminal:async()=>({path:"C:\\x",dataPath:install})}),/terminal LayanX trades with/);
await assert.rejects(runStrategyTest(base,{platform:"win32",env,runningTerminals:noneRunning,run:async()=>({code:0,timedOut:false}),liveTerminal:async()=>({path:path.join(root,"Other MT5"),dataPath:path.join(root,"Other data")})}),/without a report/,"a different terminal is fine");
await assert.rejects(runStrategyTest(base,{platform:"win32",env,runningTerminals:noneRunning,run:noRun,liveTerminal:async()=>{throw new Error("timeout");}}),/Could not check which MetaTrader 5 LayanX trades with \(timeout\)/,"the check failing stops the test (fail closed)");
// Not connected: a running copy of this terminal is refused (it may be the one you trade with).
await assert.rejects(runStrategyTest(base,{platform:"win32",env,run:noRun,runningTerminals:async()=>[path.join(root,"Other MT5","terminal64.exe"),terminal]}),/already open.*Close it first/);
await assert.rejects(runStrategyTest(base,{platform:"win32",env,run:async()=>({code:0,timedOut:false}),runningTerminals:async()=>[path.join(root,"Other MT5","terminal64.exe")]}),/without a report/,"another terminal running is fine");
fs.rmSync(root,{recursive:true,force:true});
console.log("mt5-strategy-tester: portable tester terminal only, robot inside MQL5\\Experts, injection-proof INI, UTF-16 report read into monthly/yearly results");
process.exit(0);
