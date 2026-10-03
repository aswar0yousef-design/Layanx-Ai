# Scalping Performance Analysis

`analyzeScalpingPerformance` is a read-only diagnostic layer for completed trades.

It builds historical segments by:
- strategy
- execution quality
- spread as a percentage of entry ATR
- trade duration
- maximum observed entry/exit slippage as a percentage of ATR

Each segment reports:
- trade count, wins, losses, win rate
- gross PnL and true net PnL
- execution costs, commission and swap
- trades where execution costs erased a nominal gross profit
- profit factor and expectancy per trade
- average spread/ATR, slippage and duration where data exists

## Important interpretation

This module does not generate entries, reject orders, optimize parameters, or claim that a segment will remain profitable. It describes historical execution and outcome data only.

`trueNetPnl` is used for win/loss and expectancy calculations:

`trueNetPnl = grossPnl - estimatedExecutionCosts - commission - swap`

The slippage bucket uses the larger of entry and exit slippage relative to entry ATR. Missing ATR or slippage is reported as `unknown` rather than guessed.

## Intended next layer

After sufficient historical data is available, a separate pre-trade execution gate can consume the same normalized market fields. It should remain separate from this historical analyzer to avoid look-ahead bias and to make its decisions auditable.
