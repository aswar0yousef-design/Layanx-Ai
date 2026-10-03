# MT5 Read-Only Market Data

This boundary allows LayanX to consume MT5 market information without granting the trading pipeline an order-execution capability.

## Data consumed

- current bid/ask snapshot
- historical OHLC candles
- broker symbol specification

The requested symbol is validated against both the returned snapshot and specification.

## Execution boundary

The read-only transport exposes only:

- `getSymbolSnapshot`
- `getCandles`
- `getSymbolSpecification`

It does not expose `placeOrder`.

The existing MT5 order contract remains separate for a future, explicitly enabled execution adapter.

## Intended flow

`MT5 read-only transport -> normalized market data -> signal/gate/risk -> paper backtest`

No credentials, broker session, or live order implementation is stored in this module.
