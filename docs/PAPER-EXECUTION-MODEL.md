# Paper Execution Model

The paper broker models execution costs separately from the strategy's reference price.

## Entry

For a long entry:
- reference = candle close
- fill = reference + spread/2 + slippage

For a short entry:
- reference = candle close
- fill = reference - spread/2 - slippage

## Exit

For a long exit:
- reference = triggered stop/target price
- fill = reference - spread/2 - slippage

For a short exit:
- reference = triggered stop/target price
- fill = reference + spread/2 + slippage

This makes execution drag visible on both entry and exit instead of treating the exit fill as its own reference.

The simulator remains conservative and simplified: candle OHLC cannot reproduce tick-level queue position, intra-candle bid/ask changes, gaps, partial fills, liquidity, or broker-specific stop/target execution rules.
