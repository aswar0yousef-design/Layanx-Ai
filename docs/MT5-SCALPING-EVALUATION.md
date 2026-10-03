# MT5 Scalping Evaluation

`evaluateMt5Scalping` is the first end-to-end dry-run composition of the trading modules.

`MT5 adapter -> bid/ask + candles -> signal -> risk -> execution gate -> decision`

The function intentionally returns `submitted: false` and never calls `placeOrder`.

This gives us a safe integration point for real MT5 data while preserving the separation between market-data acquisition and live order submission.

Before live execution, the adapter must additionally validate broker-specific volume, price, stop-distance, margin, symbol, session, and execution-mode constraints.