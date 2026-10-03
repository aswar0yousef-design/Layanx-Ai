# Market Regime Analysis

This layer provides descriptive market-context labels for historical and paper-trading analysis.

## Regimes

Trend is derived from EMA(9) versus EMA(21), normalized by ATR:
- `bullish-trend`
- `bearish-trend`
- `range`

Volatility compares current ATR(14) with a recent ATR baseline:
- `low-volatility`
- `normal-volatility`
- `high-volatility`
- `unknown`

Default thresholds are configurable and are engineering classifications, not profitability claims.

## Integration

Each paper trade preserves:
- trading session
- trend regime
- volatility regime
- ATR context

Backtest segmentation can report results by trend and volatility regime alongside session, side, quality, and strategy.

## Safety of interpretation

Regime labels are descriptive. They do not generate orders, alter risk, rank strategies, or predict future price movement. The historical results must be interpreted in the context of the underlying data feed, timezone, spread, slippage, and simulation assumptions.
