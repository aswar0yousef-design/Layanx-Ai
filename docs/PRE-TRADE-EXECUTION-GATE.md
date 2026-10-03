# Pre-Trade Execution Gate

This module evaluates the current market/execution environment before an order is handed to a future broker adapter. It does not create, modify, submit, or cancel orders.

Default checks:
- spread / ATR must be at or below 20%
- expected slippage / ATR must be at or below 10% when expected slippage is supplied
- ATR and spread are required by default
- optional minimum ATR
- optional session allowlist

The policy is deliberately configurable. These defaults are engineering thresholds for the gate and are not a claim that they produce profitable trading.

## Separation from historical analytics

Historical trade analytics measures what happened after execution. This gate evaluates the current snapshot before execution. Keeping them separate prevents historical outcomes from silently changing the execution decision path and makes the gate auditable.

## Adapter contract

A future MT5 or other broker adapter should populate `PreTradeMarketSnapshot` from broker-side market data immediately before the decision is handed to an execution layer. The gate should remain a pure function of the supplied snapshot and policy.
