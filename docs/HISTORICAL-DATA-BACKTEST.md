# Historical Data and Backtest

Historical candles enter the trading engine through `historical-data.ts`.

Supported formats:
- CSV with timestamp/time/datetime and OHLC columns.
- JSON arrays using full names or compact aliases such as `o/h/l/c`.
- Optional volume.

The importer parses and normalizes timestamps, validates finite OHLC values, validates the OHLC range, sorts candles chronologically, and rejects duplicate timestamps.

`historical-backtest.ts` sends normalized candles through the existing paper engine and builds the unified backtest report.

No broker credentials or live orders are involved.

For reliable research, the source data should document timezone, broker/feed, symbol specification, spread assumptions, and whether candles are bid, ask, or mid prices.