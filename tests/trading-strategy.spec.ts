import {HtfStructureLiquidityStrategy,ScalpingSweepStrategy} from "../src/trading/strategy.js";import {backtest} from "../src/trading/backtest.js";
const candles=Array.from({length:100},(_,i)=>({timestamp:i,open:100+i*0.1,high:100+i*0.1+1,low:100+i*0.1-1,close:100+i*0.1+0.2,volume:1000}));
// Inject a bullish sweep/displacement after a rising sequence.
candles[50]={timestamp:50,open:105,high:106,low:98,close:106,volume:2000};
const strategy=new HtfStructureLiquidityStrategy();const signal=strategy.evaluate({candles,index:50});
if(!signal||signal.side!=="long"||signal.takeProfit<=signal.entry||signal.stopLoss>=signal.entry)throw new Error("Expected bullish liquidity-sweep signal was not generated.");
const result=backtest(strategy,candles,100000,0.005);
if(result.strategyId!==strategy.id)throw new Error("Strategy id missing.");
if(!Number.isFinite(result.maxDrawdownPct)||!Number.isFinite(result.endingEquity))throw new Error("Backtest metrics are invalid.");
console.log(JSON.stringify({ok:true,trades:result.trades.length,returnPct:result.returnPct,maxDrawdownPct:result.maxDrawdownPct}));

const scalp=new ScalpingSweepStrategy();
const scalpSignal=scalp.evaluate({candles,index:50});
if(!scalpSignal||scalpSignal.side!=="long")throw new Error("Scalp long signal was not generated.");
