# Intrabar Execution Model

OHLC candles do not reveal the order in which the high and low occurred inside a candle.

When both a stop-loss and take-profit are touched by the same candle, LayanX therefore marks the exit as `intrabarAmbiguous`.

## Default policy

Paper trading uses `conservative` resolution:
- if both stop and target are touched, the stop is selected
- if the candle opens beyond a stop or target, the simulator uses the candle open as the reference execution level (`gapThrough`)
- spread and slippage are then applied to the reference

An `optimistic` policy is available for sensitivity analysis and selects the target when both levels are ambiguous.

## Why this matters

A backtest based only on OHLC can otherwise manufacture precision that the data does not contain. Ambiguous and gap-through exits are explicitly counted in the backtest report.

This is still a simulation, not a tick-level reconstruction. Accurate live-like testing requires bid/ask tick data and broker-specific execution rules.
