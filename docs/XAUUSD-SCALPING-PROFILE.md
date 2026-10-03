# XAUUSD Scalping Profile

The shared XAUUSD profile centralizes instrument/timeframe and execution-simulation behavior without hard-coding broker facts or profitability assumptions.

## Current profile

- Symbol: XAUUSD
- Timeframe: M1
- Maximum spread/ATR ratio: 0.20
- Maximum expected slippage/ATR ratio: 0.10
- Spread required: yes
- ATR required: yes
- Intrabar resolution: conservative
- Historical backtest requires Bid/Ask: yes

These thresholds are engineering defaults for execution-quality gating, not claims about optimal trading parameters.

## Broker specification

The profile does not contain CFI contract size, tick size, tick value, volume limits, or commission/swap values. Those must come from the MT5 symbol specification for the exact account/symbol.

## Risk inputs

Risk percentage, stop distance, spread, and slippage remain explicit inputs. The profile deliberately does not prescribe a profitable risk setting.

## Usage

Use createXauUsdPaperConfig(...) to create a paper-trading configuration while keeping the symbol, timeframe, and intrabar policy consistent.

Before a historical backtest, pass data through the guarded MT5 historical import and verify its quality, quote coverage, and session distribution.


### Stop-distance sanity gate

The execution gate supports an optional `minStopDistanceAtrRatio`. It is intentionally not enabled by the base XAUUSD profile until a broker-specific historical study establishes an appropriate floor. When enabled, it blocks stops that are unusually small relative to the current ATR and therefore prevents accidental oversizing without silently changing the strategy's stop model.


### Entry timing and look-ahead control

Paper scalping defaults to generating the signal from the last completed candle and executing on the following candle. This prevents indicators calculated from a candle close from being used to fill a trade inside that same candle. The legacy same-candle behavior remains available only by explicitly setting `signalOnClosedCandle: false` for controlled diagnostics.
