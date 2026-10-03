# Trading Integration Contract

The LayanX trading analysis layer is deliberately broker-agnostic. A future MT5, Binance, or other execution adapter should map its closed trades into `TradeRecord` without changing the analytics engine.

Required:
- id
- symbol
- side
- quantity
- entry.fillPrice
- exit.fillPrice
- openedAt

Strongly recommended for accurate scalping analysis:
- entry.referencePrice
- exit.referencePrice
- entry.spread
- exit.spread
- entry.atr
- entry.slippage
- exit.slippage
- commission
- swap
- strategy
- timeframe
- session

Reference price should be the broker-side comparable quote captured immediately before/at the fill (for example the applicable bid/ask or a documented execution reference). Do not mix units between spread, ATR, and price.

The analytics layer is read-only: it evaluates completed trades and does not authorize, reject, or modify orders. Any future pre-trade spread/ATR filter must be implemented separately so historical analysis remains unbiased.

Example payload:

```json
{
  "id": "broker-ticket-123",
  "symbol": "XAUUSD",
  "side": "long",
  "quantity": 1,
  "openedAt": "2026-10-03T07:00:00Z",
  "closedAt": "2026-10-03T07:02:00Z",
  "strategy": "scalp",
  "timeframe": "M1",
  "session": "London",
  "entry": {
    "fillPrice": 2350.10,
    "referencePrice": 2350.05,
    "spread": 0.10,
    "atr": 1.00,
    "slippage": 0.05
  },
  "exit": {
    "fillPrice": 2350.95,
    "referencePrice": 2350.90,
    "spread": 0.10,
    "slippage": 0.05
  },
  "commission": 0.20,
  "swap": 0
}
```
