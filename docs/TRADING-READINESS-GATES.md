# Trading Readiness Gates

## Current boundary

| Gate | State | Evidence |
|---|---|---|
| Paper Trading | READY | runPaperScalping, intrabar execution, execution-quality analysis, backtest/OOS tests |
| Agent Integration | READY | trading.paper.backtest is registered in the LayanX ToolRegistry and ToolAdapterRegistry |
| Risk Boundary | READY | Agent paper tool is L2_ANALYZE; no live trading tool is registered; paper risk still passes through the existing risk engine |
| Approval Path | READY | LayanX ExecutionRuntime requires explicit approval for high/critical or dangerous execution paths |
| Audit Path | READY | ExecutionRuntime writes audit events for allow/deny/pending/failure/success paths |
| MT5 | READY (read-only) | MT5 snapshot/candle/specification paths are available; forming candles are filtered centrally |
| Binance | NOT ENABLED | No Binance adapter/tool is registered |
| Live Broker | NOT ENABLED | No live broker execution tool is registered |
| Real Money | NOT ENABLED | The trading agent integration exposes paper analysis only |

## Agent boundary

The only trading tool registered automatically is trading.paper.backtest.

- Permission: L2_ANALYZE
- Dangerous: false
- It returns explicit liveOrderSubmitted: false and exchangeOrderSubmitted: false.

There is intentionally no Binance, live-broker, or real-money tool in the registry.

## MT5 boundary

MT5 support in the current trading layer is for market-data/read-only evaluation. The shared candle filter removes all candles that are still forming at the MT5 snapshot timestamp before scalping evaluation.

## Promotion rule

A future live execution adapter must be introduced as a separate security change. It must not be enabled merely by adding credentials or changing an environment variable. It should have its own tool permission, risk policy, approval requirement, idempotency strategy, broker reconciliation, and audit evidence.
