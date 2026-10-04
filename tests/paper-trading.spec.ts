import {PaperTradingEngine} from "../src/trading/paper.js";
const engine=new PaperTradingEngine();
const quote=engine.setQuote({symbol:"XAUUSD",bid:2650,ask:2650.5});
if(quote.symbol!=="XAUUSD"||quote.ask!==2650.5)throw new Error("Quote registration failed.");
const account=engine.accountSnapshot();
if(account.available!==100000)throw new Error("Unexpected paper account balance.");
const order=engine.placeMarket({symbol:"XAUUSD",side:"buy",quantity:0.5,stopLoss:2640,takeProfit:2670});
if(order.status!=="filled"||order.price!==2650.5)throw new Error("Paper market order failed.");
if(engine.positions().length!==1)throw new Error("Paper position was not created.");
const closed=engine.closePosition(order.orderId,2670);
if(closed.pnl!==9.75)throw new Error("Paper PnL calculation failed.");
if(engine.accountSnapshot().balance!==100009.75||engine.accountSnapshot().available!==100009.75)throw new Error("Paper account settlement failed.");
if(engine.positions().length!==0)throw new Error("Paper position was not closed.");
let rejected=false;try{engine.placeMarket({symbol:"XAUUSD",side:"buy",quantity:100});}catch{rejected=true;}
if(!rejected)throw new Error("Paper risk limit did not reject oversized order.");
console.log(JSON.stringify({ok:true,quote,order,closed}));
