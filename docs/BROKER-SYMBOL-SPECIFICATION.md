# Broker Symbol Specification

LayanX keeps broker-specific contract and volume rules outside the signal engine.

A live symbol specification should provide, when available:

- broker and account type
- symbol
- minimum volume
- maximum volume
- volume step
- tick size
- tick value
- contract size
- commission and swap metadata

## Risk sizing

When `tickSize` and `tickValue` are supplied, monetary value per one unit of price movement is:

`tickValue / tickSize`

Risk sizing then uses:

`risk amount / (stop distance × monetary value per price unit)`

The resulting quantity is normalized to the broker's volume step and limits.

## CFI account

The project can represent the user's CFI account as a broker profile, but the actual XAUUSD values must come from the MT5 symbol specification for that exact account/server. No CFI contract, tick value, spread, commission, swap, or leverage value is hard-coded here.

This prevents a generic broker document from being incorrectly applied to the user's live account.
