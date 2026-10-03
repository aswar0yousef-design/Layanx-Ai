# Historical XAUUSD Data

For realistic XAUUSD scalping backtests, prefer MT5 exports containing timestamped bid/ask information in addition to OHLC.

## Supported columns

OHLC:
- timestamp/time/datetime
- open/high/low/close
- volume/vol/tick_volume (optional)

Quotes:
- bid/bid_price/bidprice
- ask/ask_price/askprice

Bid and ask are validated for positive values and `ask >= bid`.

## Execution priority

When both bid and ask are present on a candle, the paper engine uses:

`spread = ask - bid`

When bid/ask are absent, it falls back to the configured spread assumption.

The backtest result reports quote coverage so an OHLC-only dataset cannot be mistaken for a fully quoted dataset.

## Recommended dataset metadata

Record:
- exact MT5 server/account source
- symbol
- timeframe
- timezone
- date range
- whether timestamps represent bar open time
- whether bid/ask are bar-open, close, or aggregated quotes
- any missing-data periods

For highest execution fidelity, tick Bid/Ask data is preferable to bar-level quotes.
