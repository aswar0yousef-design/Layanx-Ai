# Paper Scalping Engine

The paper engine runs the existing signal, execution-gate, and risk modules against historical candles without connecting to a broker.

## Safety boundary

- No MT5 connection.
- No order submission.
- No account mutation.
- Every simulated trade is recorded for the existing execution-quality and performance analytics.

## Simulation model

The current baseline opens at the candle close when the decision is executable and uses a fixed stop-loss distance. The next candle is checked for stop-loss activation.

This is intentionally conservative and simple. It is not a realistic broker fill model: spread, latency, gaps, commissions, swaps, partial fills, take-profit logic, and intrabar ordering are not fully simulated yet.

Use the engine to validate code paths and compare historical diagnostics, not to infer guaranteed future returns.
