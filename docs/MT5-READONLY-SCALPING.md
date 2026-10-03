# MT5 Read-Only Scalping Evaluation

This layer combines live/read-only MT5 market data with the existing scalping decision coordinator.

## Inputs

- current MT5 bid/ask
- historical MT5 candles
- broker symbol specification
- explicit account risk inputs
- optional signal and execution policies

## Flow

`MT5 read-only transport -> symbol validation -> market snapshot -> signal -> execution gate -> broker-aware risk plan`

The function returns a decision only. It does not call `placeOrder` and does not mutate the MT5 account.

## Important

The caller must provide the intended stop-loss and account risk parameters. The module does not invent a stop-loss distance or account balance.

CFI values in tests are fixtures only. Production values must come from the exact MT5 account/server symbol specification.
