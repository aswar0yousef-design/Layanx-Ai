# Trading Readiness Gates

## Current boundary

| Gate | State | Evidence |
|---|---|---|
| Paper Trading | READY | runPaperScalping, intrabar execution, execution-quality analysis, backtest/OOS tests |
| Agent Integration | READY | paper, Binance market-data, and dedicated Binance execution tools are registered with separate permissions |
| Risk Boundary | READY | Paper is L2_ANALYZE; Binance execution is isolated at L4_EXECUTE and requires runtime controls plus exchange preflight limits |
| Approval Path | READY | LayanX ExecutionRuntime requires explicit approval for high/critical or dangerous execution paths |
| Audit Path | READY | ExecutionRuntime writes audit events for allow/deny/pending/failure/success paths |
| MT5 | READY (read-only) | MT5 snapshot/candle/specification paths are available; forming candles are filtered centrally |
| Binance Market Data | READY | Read-only Binance REST adapter + Agent tool |
| Binance Execution | GATED | Dedicated L4 tool; requires runtime approval, API credentials, live-enable flag, and max-notional limit |
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

## Live execution boundary

Binance Spot execution is implemented but remains disabled by default.

Before a production order can be submitted, all of the following must hold:
- LayanX ExecutionRuntime authorizes the L4 tool and explicit approval is valid for the exact payload hash.
- BINANCE_LIVE_TRADING_ENABLED=true.
- Encrypted local Binance credentials are configured in the LayanX secret vault, or deployment environment credentials are explicitly supplied.
- BINANCE_MAX_ORDER_NOTIONAL is a positive limit.
- The symbol is currently TRADING.
- Quantity and price comply with Binance exchange filters.
- The order notional is within both the exchange limit and the configured LayanX maximum.
- Production requests use HTTPS and api.binance.com.
- The request carries a deterministic clientOrderId derived from the runtime idempotency key.

Post-order reconciliation/user-data streaming is still a separate operational hardening step before unattended high-frequency production trading.
