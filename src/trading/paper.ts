export type TradingSide="buy"|"sell";
export interface TradingQuote{symbol:string;bid:number;ask:number;timestamp:string;}
export interface TradingPosition{symbol:string;side:TradingSide;quantity:number;entryPrice:number;stopLoss?:number;takeProfit?:number;openedAt:string;}
export interface TradingOrder{orderId:string;symbol:string;side:TradingSide;quantity:number;price:number;status:"filled"|"rejected";reason?:string;createdAt:string;}
export interface TradingAccount{currency:"USD";balance:number;equity:number;available:number;}

export class PaperTradingEngine{
 private readonly quotes=new Map<string,TradingQuote>();
 private readonly openPositions=new Map<string,TradingPosition>();
 private readonly orders:TradingOrder[]=[];
 private account:TradingAccount={currency:"USD",balance:100000,equity:100000,available:100000};

 setQuote(input:{symbol:string;bid:number;ask:number;timestamp?:string}):TradingQuote{
  const symbol=normalizeSymbol(input.symbol); const bid=finitePositive(input.bid,"bid"); const ask=finitePositive(input.ask,"ask");
  if(ask<bid)throw new Error("Ask price cannot be below bid price.");
  const quote={symbol,bid,ask,timestamp:input.timestamp??new Date().toISOString()}; this.quotes.set(symbol,quote); return structuredClone(quote);
 }
 quote(symbol:string):TradingQuote{
  const value=this.quotes.get(normalizeSymbol(symbol)); if(!value)throw new Error("No paper quote is configured for this symbol."); return structuredClone(value);
 }
 accountSnapshot():TradingAccount{return structuredClone(this.account);}
 positions():TradingPosition[]{return [...this.openPositions.values()].map(position=>structuredClone(position));}
 ordersSnapshot():TradingOrder[]{return this.orders.map(order=>structuredClone(order));}
 placeMarket(input:{symbol:string;side:TradingSide;quantity:number;price?:number;stopLoss?:number;takeProfit?:number}):TradingOrder{
  const symbol=normalizeSymbol(input.symbol); const quantity=finitePositive(input.quantity,"quantity"); const quote=this.quote(symbol);
  const price=input.price??(input.side==="buy"?quote.ask:quote.bid); finitePositive(price,"price");
  if(quantity*price>this.account.available*0.02)throw new Error("Paper trading risk limit exceeded: order notional is above 2% of available equity.");
  if(input.stopLoss!==undefined)validateStop(input.side,price,input.stopLoss);
  if(input.takeProfit!==undefined)validateTarget(input.side,price,input.takeProfit);
  const order:TradingOrder={orderId:crypto.randomUUID(),symbol,side:input.side,quantity,price,status:"filled",createdAt:new Date().toISOString()};
  this.orders.push(order);
  const key=order.orderId; this.openPositions.set(key,{symbol,side:input.side,quantity,entryPrice:price,stopLoss:input.stopLoss,takeProfit:input.takeProfit,openedAt:order.createdAt});
  this.account={...this.account,available:this.account.available-quantity*price};
  return structuredClone(order);
 }
 closePosition(orderId:string,price?:number){
  const position=this.openPositions.get(orderId); if(!position)throw new Error("Paper position not found.");
  const quote=this.quote(position.symbol); const exit=price??(position.side==="buy"?quote.bid:quote.ask); finitePositive(exit,"price");
  const pnl=(position.side==="buy"?exit-position.entryPrice:position.entryPrice-exit)*position.quantity;
  this.openPositions.delete(orderId); const balance=this.account.balance+pnl; this.account={...this.account,balance,available:this.account.available+position.entryPrice*position.quantity+pnl,equity:balance};
  return {orderId,symbol:position.symbol,exitPrice:exit,pnl,closedAt:new Date().toISOString()};
 }
}
function normalizeSymbol(value:string){const symbol=value.trim().toUpperCase();if(!/^[A-Z0-9._/-]{2,32}$/.test(symbol))throw new Error("Invalid trading symbol.");return symbol;}
function finitePositive(value:number,name:string){if(!Number.isFinite(value)||value<=0)throw new Error(name+" must be a positive finite number.");return value;}
function validateStop(side:TradingSide,price:number,stop:number){finitePositive(stop,"stopLoss");if(side==="buy"&&stop>=price)throw new Error("Buy stop-loss must be below entry price.");if(side==="sell"&&stop<=price)throw new Error("Sell stop-loss must be above entry price.");}
function validateTarget(side:TradingSide,price:number,target:number){finitePositive(target,"takeProfit");if(side==="buy"&&target<=price)throw new Error("Buy take-profit must be above entry price.");if(side==="sell"&&target>=price)throw new Error("Sell take-profit must be below entry price.");}
