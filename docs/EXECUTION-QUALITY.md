# Execution Quality Analysis

This is an analysis-only layer for scalping trade records. It does not alter signal generation, entries, exits, sizing, or risk controls.

Per-trade metrics:
- entry/exit spread
- entry ATR
- spread / ATR ratio
- entry/exit slippage
- estimated round-trip execution drag
- gross PnL
- net PnL after estimated execution costs
- execution cost as a percentage of gross profit
- quality classification and warnings

The spread/ATR ratio is a fraction: 0.10 means the entry spread equals 10% of ATR.

Quality thresholds:
- <= 10%: excellent
- > 10% to 20%: good
- > 20% to 35%: marginal
- > 35%: poor

These labels describe execution conditions only; they are not trade-signal recommendations.

If reference prices are present, execution drag is measured from reference to actual fill. Without reference prices, the module estimates half-spread per side.
