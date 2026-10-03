# MT5 Adapter Contract

LayanX does not contain a native MetaTrader 5 connection in this layer. `Mt5Adapter` defines the boundary that a future MT5 bridge can implement.

Required adapter operations:
- `getSymbolSnapshot`: broker-side bid/ask and timestamp
- `getCandles`: normalized OHLCV candles
- `placeOrder`: broker order submission result

## Security boundary

Broker credentials, terminal authentication, API keys, and account secrets must stay inside the broker/MT5 bridge environment. They should not be embedded in signal, risk, or analytics modules.

## Execution boundary

The trading pipeline should evaluate signal, risk, and pre-trade execution conditions before calling `placeOrder`. The adapter itself should validate broker-specific constraints such as minimum volume, volume step, symbol availability, trading session, price precision, margin, and stop-distance rules.

## Normalization

MT5-specific timeframes and broker quotes are normalized at the adapter boundary. The rest of LayanX consumes `MarketCandle`, `PreTradeMarketSnapshot`, and order-result types without importing MT5 SDK details.

## Current status

This commit defines the contract and test double only. It does not connect to a MetaTrader terminal and does not place live orders.