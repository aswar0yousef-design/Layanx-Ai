import { createHmac } from "node:crypto";

export interface BinanceClientConfig {
  apiKey?: string;
  apiSecret?: string;
  baseUrl?: string;
  recvWindowMs?: number;
  timeoutMs?: number;
  allowTrading?: boolean;
  liveTradingEnabled?: boolean;
}

export interface BinanceMarketTicker {
  symbol: string;
  bidPrice: number;
  askPrice: number;
  lastPrice: number;
  timestamp: number;
}

export interface BinanceSymbolRules {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  minQty?: number;
  maxQty?: number;
  stepSize?: number;
  minNotional?: number;
}

export interface BinanceOrderRequest {
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  quantity: number;
  price?: number;
  clientOrderId?: string;
}

export interface BinanceOrderResult {
  submitted: boolean;
  testnet: boolean;
  orderId?: number;
  clientOrderId?: string;
  status?: string;
  raw: unknown;
}

export class BinanceSpotClient {
  private readonly config: Required<Pick<BinanceClientConfig,"baseUrl"|"recvWindowMs"|"timeoutMs"|"allowTrading">> & BinanceClientConfig;

  constructor(config: BinanceClientConfig = {}) {
    this.config = {
      baseUrl: config.baseUrl ?? "https://api.binance.com",
      recvWindowMs: config.recvWindowMs ?? 5000,
      timeoutMs: config.timeoutMs ?? 10000,
      allowTrading: config.allowTrading ?? false,
      liveTradingEnabled: config.liveTradingEnabled ?? false,
      ...config,
    };
  }

  private requireCredentials(): { apiKey: string; apiSecret: string } {
    if (!this.config.apiKey || !this.config.apiSecret) throw new Error("Binance API credentials are required.");
    return { apiKey: this.config.apiKey, apiSecret: this.config.apiSecret };
  }

  private async request<T>(path: string, params: Record<string, string|number|boolean|undefined> = {}, signed = false): Promise<T> {
    const values = Object.entries(params).filter(([,v]) => v !== undefined) as Array<[string,string|number|boolean]>;
    const query = new URLSearchParams(values.map(([k,v]) => [k,String(v)]));
    const headers: Record<string,string> = {};
    if (signed) {
      const {apiKey,apiSecret}=this.requireCredentials();
      query.set("timestamp", String(Date.now()));
      query.set("recvWindow", String(this.config.recvWindowMs));
      query.set("signature", createHmac("sha256",apiSecret).update(query.toString()).digest("hex"));
      headers["X-MBX-APIKEY"]=apiKey;
    } else if (this.config.apiKey) {
      headers["X-MBX-APIKEY"]=this.config.apiKey;
    }
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),this.config.timeoutMs);
    try {
      const response=await fetch(this.config.baseUrl+path+"?"+query.toString(),{method:"GET",headers,signal:controller.signal});
      const body=await response.text();
      if(!response.ok) throw new Error(`Binance HTTP ${response.status}: ${body}`);
      return JSON.parse(body) as T;
    } finally { clearTimeout(timer); }
  }

  async getTicker(symbol: string): Promise<BinanceMarketTicker> {
    const raw=await this.request<{symbol:string;bidPrice:string;askPrice:string;lastPrice:string;closeTime:number}>("/api/v3/ticker/24hr",{symbol});
    return {symbol:raw.symbol,bidPrice:Number(raw.bidPrice),askPrice:Number(raw.askPrice),lastPrice:Number(raw.lastPrice),timestamp:raw.closeTime};
  }

  async getSymbolRules(symbol: string): Promise<BinanceSymbolRules> {
    const raw=await this.request<{symbols:Array<{symbol:string;status:string;baseAsset:string;quoteAsset:string;filters:Array<{filterType:string;minQty?:string;maxQty?:string;stepSize?:string;minNotional?:string;notional?:string}>}>}>("/api/v3/exchangeInfo",{symbol});
    const item=raw.symbols.find(x=>x.symbol===symbol);
    if(!item) throw new Error(`Binance symbol not found: ${symbol}`);
    const lot=item.filters.find(x=>x.filterType==="LOT_SIZE");
    const notional=item.filters.find(x=>x.filterType==="MIN_NOTIONAL"||x.filterType==="NOTIONAL");
    return {symbol:item.symbol,status:item.status,baseAsset:item.baseAsset,quoteAsset:item.quoteAsset,minQty:lot?.minQty?Number(lot.minQty):undefined,maxQty:lot?.maxQty?Number(lot.maxQty):undefined,stepSize:lot?.stepSize?Number(lot.stepSize):undefined,minNotional:Number(notional?.minNotional??notional?.notional??NaN)};
  }

  async accountInfo(): Promise<unknown> {
    return this.request("/api/v3/account",{},true);
  }

  async placeOrder(request: BinanceOrderRequest): Promise<BinanceOrderResult> {
    if (!request.symbol || !Number.isFinite(request.quantity) || request.quantity <= 0) throw new Error("Binance order quantity and symbol must be valid.");
    if (request.type === "LIMIT" && (!Number.isFinite(request.price) || request.price! <= 0)) throw new Error("Limit orders require a positive price.");
    if (!this.config.allowTrading) throw new Error("Binance trading is disabled by safety boundary.");
    if (this.config.baseUrl.includes("testnet")) {
      const raw=await this.request<Record<string,unknown>>("/api/v3/order/test",{symbol:request.symbol,side:request.side,type:request.type,quantity:request.quantity,price:request.price,timeInForce:request.type==="LIMIT"?"GTC":undefined,newClientOrderId:request.clientOrderId},true);
      return {submitted:false,testnet:true,clientOrderId:request.clientOrderId,raw};
    }
    if (!this.config.liveTradingEnabled) throw new Error("Production Binance trading requires BINANCE_LIVE_TRADING_ENABLED=true.");
    const raw=await this.request<Record<string,unknown>>("/api/v3/order",{symbol:request.symbol,side:request.side,type:request.type,quantity:request.quantity,price:request.price,timeInForce:request.type==="LIMIT"?"GTC":undefined,newClientOrderId:request.clientOrderId},true);
    return {submitted:true,testnet:false,orderId:typeof raw.orderId==="number"?raw.orderId:undefined,clientOrderId:typeof raw.clientOrderId==="string"?raw.clientOrderId:request.clientOrderId,status:typeof raw.status==="string"?raw.status:undefined,raw};
  }
}
