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
| Binance Market Data | READY | Read-only Binance REST adapter + Agent tool |\n| Binance Execution | GATED | Dedicated L4 tool; requires runtime approval, API credentials, live-enable flag, and max-notional limit |
| Live Broker | NOT ENABLED | No live broker execution tool is registered |
| Real Money | GATED / OFF BY DEFAULT | Production order path exists but cannot run without explicit deployment configuration and L4 approval |

## Agent boundary

The trading layer registers three distinct paths: paper analysis, Binance market data, and a dedicated Binance execution tool.

- Permission: L2_ANALYZE
- Dangerous: false
- It returns explicit liveOrderSubmitted: false and exchangeOrderSubmitted: false.

There is no unrestricted live trading tool. Binance execution is isolated behind the L4 approval/risk/runtime path.

## MT5 boundary

MT5 support in the current trading layer is for market-data/read-only evaluation. The shared candle filter removes all candles that are still forming at the MT5 snapshot timestamp before scalping evaluation.

## Promotion rule

A future live execution adapter must be introduced as a separate security change. It must not be enabled merely by adding credentials or changing an environment variable. It should have its own tool permission, risk policy, approval requirement, idempotency strategy, broker reconciliation, and audit evidence.
