# Backtest Segmentation and Out-of-Sample Testing

`backtest-segmentation.ts` provides read-only diagnostics grouped by:
- session
- long/short side
- execution quality
- strategy

`walk-forward.ts` performs a chronological split without shuffling. The default split is 70% training and 30% test.

`out-of-sample-backtest.ts` runs the same paper engine separately on the training and test windows.

Important: the current implementation does not optimize parameters on the training set. It only establishes a clean evaluation boundary so future parameter selection can be evaluated on unseen data.

Do not interpret a positive historical result as a guarantee of future profitability.