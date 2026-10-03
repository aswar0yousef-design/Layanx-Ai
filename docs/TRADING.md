# LayanX Trading Capability

LayanX now has a **Paper Trading** capability integrated with the existing Runtime Tool Fabric. It is intentionally isolated from live broker execution.

## Current scope

- Strategy registry with the first rules-based strategy: structure + liquidity sweep + displacement + ATR-derived risk levels.
- Deterministic OHLCV backtesting with return, win rate, profit factor, max drawdown, and expectancy metrics.
- Strategy execution is analysis-only until a separate execution connector is introduced.

- Quote registration for test/demo market data.
- Paper account snapshot.
- Market buy/sell orders.
- Position tracking.
- Position close and PnL calculation.
- Mandatory basic stop-loss/take-profit direction validation.
- 2% of available-equity notional limit per paper order.
- All operations are ordinary LayanX tools and therefore use the existing permission, risk, approval, idempotency, verification, audit, and recovery path.

## Important boundary

This layer does **not** connect to MT5, Binance, a broker, or a live exchange. No real order can be submitted by these tools.

The next trading phase should add a read-only market-data connector, then a demo/broker connector, with live execution remaining separately gated behind explicit trading risk controls and approval.


## Scalping risk layer

The scalp path now separates signal generation from risk admission. A scalp setup can be rejected when spread is too large relative to volatility, daily loss limits are reached, consecutive losses exceed policy, open-position limits are reached, or a cooldown is active. Risk sizing remains bounded and execution still uses the existing LayanX permission, risk, approval, idempotency, verification, audit, and recovery path.


## Research and validation pipeline

LayanX uses one shared backtester and adds controlled evaluation layers above it: parameter optimization, walk-forward out-of-sample evaluation, and Monte Carlo trade-sequence resampling. These are analysis tools only; they do not authorize live trading. The intended progression is historical research -> out-of-sample validation -> paper trading -> demo execution -> separately approved live execution.
