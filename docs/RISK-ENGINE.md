# Risk Engine

`calculateRiskPlan` converts an intended entry and stop-loss into a quantity using a fixed percentage of account balance.

Formula:

`riskAmount = accountBalance × riskPercent / 100`

`quantity = riskAmount / (abs(entry - stopLoss) × pointValue)`

The engine validates:
- positive balance and risk percentage
- non-zero stop distance
- stop-loss direction for long/short
- optional maximum quantity
- optional minimum quantity
- optional quantity step

It returns both planned and actual risk after quantity limits are applied.

## Separation

This module does not generate signals, inspect historical PnL, evaluate spread, or submit orders. It should be composed with the signal engine and pre-trade execution gate before a future broker adapter.

The calculated quantity is a mathematical risk estimate. It does not account for every broker-specific contract rule, margin requirement, commission, slippage, or guaranteed stop execution. A broker adapter must validate those constraints before submission.