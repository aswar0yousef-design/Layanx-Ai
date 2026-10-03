# Scalping Signal Engine

`generateScalpingSignal` is an isolated, deterministic signal-analysis component. It consumes candle data and returns `long`, `short`, or `neutral` with a transparent score and indicator snapshot.

Default indicators:
- EMA 9 / EMA 21 for directional alignment
- RSI 14 for momentum context
- ATR 14 for volatility context

The default minimum score is 3. A caller can configure periods and threshold without changing the implementation.

Important: this module does not know the account balance, position size, broker, spread gate result, stop-loss, take-profit, or order API. It therefore does not execute trades and does not claim that a signal is profitable.

The intended composition is:

`candles -> signal -> risk checks -> pre-trade execution gate -> broker adapter`

Historical results remain separate:

`closed trades -> execution quality -> true net PnL -> scalping performance`

This separation prevents the signal engine from accidentally using post-trade information.