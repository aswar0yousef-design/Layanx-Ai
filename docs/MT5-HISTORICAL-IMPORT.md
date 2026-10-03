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
## Backtest guard

`runMt5HistoricalBacktest` is the guarded entry point for MT5 historical simulations. By default it requires 100% Bid/Ask coverage and rejects datasets that do not satisfy the readiness gate. Set `requireBidAsk: false` only when an OHLC-only sensitivity run is intentionally desired.


## Session distribution

The import result includes UTC-based session diagnostics using the existing session windows: Asia 00:00-08:00, London 08:00-13:00, and New York 13:00-21:00. Candles outside those windows are reported as Unknown. The diagnostic warns about sample concentration but does not reject the dataset. Confirm the timezone semantics of the MT5 export before interpreting session statistics.


### Candle-open quotes for next-bar execution

For realistic next-candle entries, historical imports may provide `bidOpen`/`askOpen` (also accepted as `bid_open`/`ask_open` or `open_bid`/`open_ask`). These are preferred for the entry fill and entry spread. `bid`/`ask` remain available for the candle timestamp snapshot. If candle-open quotes are unavailable, the paper engine falls back to the candle-time quote and then the OHLC open plus configured spread model; the data should be labeled accordingly when evaluating execution quality.


### End-of-data positions

Paper backtests now default to `endOfDataPolicy: "close"`: an otherwise-open trade is marked to the final available candle close with the configured exit spread/slippage and `exitReason: "end-of-data"`. For analyses that intentionally exclude unfinished positions, set `endOfDataPolicy: "exclude"`. This choice is recorded rather than silently dropping an open trade.
