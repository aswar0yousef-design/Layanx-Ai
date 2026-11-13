/**
 * The gold robot on a DEMO account, for a set time, with LayanX's own risk limits (0.25% risk per trade, 2% daily loss,
 * 3 losses in a row, stop loss and take profit on every trade). Trading is switched on for this process only, never in
 * LayanX's saved settings, and the account is checked before every check: anything but "demo" stops the session.
 * Every check is written to a log the owner can read; open trades keep their stop loss and take profit when it ends.
 *
 *   npx tsx scripts/mt5-demo-session.ts --minutes 60 [--symbol XAUUSD] [--timeframe M1]
 */
import fs from "node:fs";
import path from "node:path";
import {resolveDataPaths} from "../src/platform/paths.js";

const arg=(name:string)=>{const i=process.argv.indexOf("--"+name);return i>=0?process.argv[i+1]:undefined;};
const minutes=Math.max(1,Math.min(24*60,Number(arg("minutes")??"60")));
Object.assign(process.env,{MT5_LIVE_TRADING_ENABLED:"true",MT5_ALLOW_REAL_ACCOUNT:"false"});
const {Mt5LiveAdapter}=await import("../src/trading/mt5-live-adapter.js");
const {Mt5AutoScalper}=await import("../src/trading/mt5-auto-scalper.js");
const dir=path.join(resolveDataPaths().dataDir,"outcome-runs","mt5-demo-"+new Date().toISOString().replace(/[:.]/g,"-"));
fs.mkdirSync(dir,{recursive:true});
const log=path.join(dir,"checks.jsonl");
const write=(o:Record<string,unknown>)=>{const line=JSON.stringify({at:new Date().toISOString(),...o});fs.appendFileSync(log,line+"\n");console.log(line);};
const adapter=new Mt5LiveAdapter({bridgePath:path.resolve("scripts/mt5-bridge.py")});
const robot=new Mt5AutoScalper({adapter,symbol:arg("symbol")??"XAUUSD",timeframe:arg("timeframe")??"M1",statePath:path.join(dir,"state.json")});
const first=await adapter.connect();
if(first.tradeMode!=="demo"){write({stop:"not a demo account",tradeMode:first.tradeMode,server:first.server});adapter.dispose();process.exit(2);}
write({start:true,server:first.server,balance:first.balance,equity:first.equity,algoTrading:first.tradeAllowed,minutes,log});
const until=Date.now()+minutes*60_000;
let stopped="";
while(Date.now()<until){
  const account=await adapter.connect().catch(e=>({error:String(e.message)}) as any);
  if(account.error){write({error:account.error});}
  else if(account.tradeMode!=="demo"){stopped="the account is no longer demo";write({stop:stopped,server:account.server});break;}
  else{const s=await robot.checkOnce();write({equity:account.equity,algoTrading:account.tradeAllowed,action:s.lastAction,error:s.lastError,tradesToday:s.tradesToday,dailyPnl:Math.round(s.dailyPnl*100)/100});}
  await new Promise(r=>setTimeout(r,15_000));
}
robot.stop();
const deals=await adapter.history({days:1,onlyLayanX:true}).catch(()=>[]);
const open=await adapter.positions().catch(()=>[]);
const end=await adapter.connect().catch(()=>null);
write({end:true,stopped:stopped||"time is up",closedTrades:deals.length,net:Math.round(deals.reduce((a,d)=>a+d.profit+d.commission+d.swap,0)*100)/100,openTrades:open.map(p=>({ticket:p.ticket,symbol:p.symbol,side:p.side,lots:p.quantity,profit:p.profit,sl:p.stopLoss,tp:p.takeProfit})),equity:end?.equity});
adapter.dispose();process.exit(0);
