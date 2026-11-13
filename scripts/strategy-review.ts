/**
 * The weekly look back: each strategy's live trades from the journal against what its history promised. With --apply, a
 * strategy whose live results fall clearly below that (REVIEW_RULE) is taken out of the strategy book; nothing is re-tuned.
 * To learn from the newest prices, re-measure afterwards: npx tsx scripts/strategy-backtest.ts --write-book
 *
 *   npx tsx scripts/strategy-review.ts [--apply]
 */
import {loadStrategyBook,saveStrategyBook} from "../src/trading/strategy-book.js";
import {applyReview,readJournal,reviewLive,REVIEW_RULE} from "../src/trading/trade-journal.js";

const book=loadStrategyBook();
if(!book){console.log("No strategy book yet: run scripts/strategy-backtest.ts --write-book first.");process.exit(1);}
const journal=readJournal();
const reviews=reviewLive(book,journal);
console.log(`Trades in the journal: ${journal.length}. A strategy is judged after ${REVIEW_RULE.minTrades} live trades; below a profit factor of ${REVIEW_RULE.suspendBelowProfitFactor} it is suspended.`);
for(const r of reviews)console.log(`${r.verdict.padEnd(9)} ${r.key.padEnd(34)} trades ${String(r.trades).padStart(3)}  net ${r.net}  win ${r.winRate}%  PF ${r.profitFactor ?? "-"}  (history ${r.expectedProfitFactor})  ${r.why}`);
if(process.argv.includes("--apply")&&reviews.some(r=>r.verdict==="suspend")){
  console.log("Strategy book updated:",saveStrategyBook(applyReview(book,reviews)));
}
process.exit(0);
