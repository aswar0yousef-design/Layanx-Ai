# MT5 Historical Import

The MT5 historical import layer reuses the existing CSV/JSON parser and adds a single readiness gate before backtesting.

## Required metadata
- symbol, e.g. XAUUSD
- timeframe, e.g. M1
- source, e.g. MT5-CFI
- expected interval when known

## Accepted fields
OHLC:
- timestamp/time/datetime
- open/high/low/close
- volume/vol/tick_volume

Quotes:
- bid/bid_price/bidprice
- ask/ask_price/askprice

## Readiness
A dataset is ready only when:
1. OHLC/timestamps pass quality validation.
2. At least 31 candles are available.
3. If requireBidAsk is enabled, every candle has both Bid and Ask.

The result exposes quoteCoverage so the backtest can distinguish fully quoted data from OHLC-only data.

## Important
The importer does not claim that bar-level Bid/Ask equals tick-level execution. For high-fidelity XAUUSD scalping validation, tick Bid/Ask data remains preferable.