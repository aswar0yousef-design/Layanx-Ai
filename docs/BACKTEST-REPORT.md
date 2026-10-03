# Scalping Backtest Report

`buildBacktestReport` consolidates historical paper-trade analyses into a neutral diagnostic report.

Metrics include:

- Net PnL and return percentage
- Win/loss counts and win rate
- Gross profit/loss
- Profit factor
- Expectancy per trade
- Maximum drawdown and drawdown percentage
- Execution costs
- Commission and swap
- Trades whose positive gross PnL was erased by costs

These metrics describe the supplied historical simulation. They are not forecasts or guarantees of future performance.

The report deliberately does not rank strategies or automatically tune parameters.
