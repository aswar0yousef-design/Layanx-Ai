# Scalping Decision Coordinator

`evaluateScalpingDecision` composes three independent components:

1. Candle-based scalping signal
2. Current-market pre-trade execution gate
3. Risk/position-size calculation

It returns an auditable decision object but never submits an order.

Execution is considered possible only when:
- the signal is not neutral
- the execution gate allows the current market conditions
- the risk plan is valid

The coordinator passes the latest candle close as the mathematical entry reference to the risk engine. A future broker adapter must replace/confirm this with the broker's executable quote before order submission.

## Deliberate separation

Signal generation does not know account balance.
Risk calculation does not generate signals.
Execution gating does not change the signal.
Historical trade analytics does not feed back into the live decision automatically.

This keeps the first live integration auditable and prevents hidden feedback/look-ahead paths.