# MT5 Live Auto-Trading

LayanX can connect to a local MetaTrader 5 terminal, read the account, and run the XAUUSD M1 scalping strategy.

## Architecture

`LayanX -> MT5 Live Adapter -> one long-lived Python bridge (scripts/mt5-bridge.py --serve) -> MetaTrader 5 terminal -> broker`

- **One bridge process.** It connects to the terminal once and answers one JSON request per line. Before this change, Python was started, and the account logged in, for every request (up to 6 times per scalper check).
- **One request at a time.** Each request's time limit starts when it is sent, so a quick read cannot time out behind a slow order and stop it.
- **Non-ASCII text is escaped** before it goes to the bridge, so an Arabic server name or path works whatever the Windows code page.
- **No LayanX secrets in the bridge.** The process is started with a minimal environment (`safeChildEnv`). The account login, when you stored one, goes to it on stdin with each request.
- **The password is optional.** Without `mt5.login`, `mt5.password` and `mt5.server`, the bridge attaches to the terminal that is already open and logged in. This is the recommended setup: no account password is stored anywhere.

## Install the local bridge

On the same Windows PC that has MetaTrader 5:

```bash
python -m pip install MetaTrader5
```

1. Open MT5 and log in to the account.
2. Turn on **Algo Trading**: the toolbar button must be green.

### Optional: let LayanX log in

Do this only if you do not want MT5 to stay logged in. Set a vault master key first (`LAYANX_SECRET_VAULT_KEY`), then:

```
npm run layanx -- secrets set mt5.login <ACCOUNT_NUMBER>
npm run layanx -- secrets set mt5.password <ACCOUNT_PASSWORD>
npm run layanx -- secrets set mt5.server <BROKER_SERVER>
npm run layanx -- secrets set mt5.terminalPath "C:\\Program Files\\MetaTrader 5\\terminal64.exe"
```

## Tools the agent can use

| Tool | Level | What it does |
|---|---|---|
| `trading.mt5.account` | read | Balance, equity, currency, leverage, **demo / contest / real**, and whether Algo Trading is on |
| `trading.mt5.positions` | read | Open positions, with magic number and comment (LayanX's own carry its magic) |
| `trading.mt5.quote` | read | Bid, ask and spread for one symbol |
| `trading.mt5.candles` | read | Up to 500 candles: M1, M5, M15, M30, H1, H4, D1 or W1 |
| `trading.mt5.history` | read | Closed trades over up to 90 days, with net result, wins and losses |
| `trading.mt5.autoscalper.status` | read | Running state, last action, trades today, daily result, losing streak |
| `trading.mt5.autoscalper.start` / `.stop` | L4 | Start or stop the scalper. Waits for the owner's approval every time |
| `trading.mt5.tester.run` | L4 | Backtest an MQL5 robot in the Strategy Tester ([MT5-STRATEGY-TESTER.md](MT5-STRATEGY-TESTER.md)). Waits for approval |

There is no tool that sends a single order. Real orders come only from the auto-scalper, after the owner enables and starts it.

## Live safety switches

Live trading requires all of these:

```
MT5_LIVE_TRADING_ENABLED=true
MT5_AUTO_SCALPING_ENABLED=true
MT5_AUTO_START=true        # optional: start with LayanX instead of with the start tool
```

**Demo accounts only by default.** On a real (non-demo) account, orders and closes are refused until you add:

```
MT5_ALLOW_REAL_ACCOUNT=true
```

Recommended controls:

```
MT5_SCALPER_SYMBOL=XAUUSD
MT5_SCALPER_TIMEFRAME=M1
MT5_SCALP_RISK_PERCENT=0.25
MT5_STOP_ATR_MULTIPLIER=1.2
MT5_TARGET_ATR_MULTIPLIER=1.8
MT5_MAX_SPREAD_ATR=0.15
MT5_MAX_SLIPPAGE_ATR=0.10
MT5_MAX_DAILY_LOSS_PERCENT=2
MT5_MAX_TRADES_PER_DAY=20
MT5_MAX_CONSECUTIVE_LOSSES=3
MT5_MAX_DEVIATION_POINTS=20
MT5_MAGIC_NUMBER=2601004
```

## What the bridge and the scalper guarantee

- **Completed candles only**, and no second position on the configured symbol. An order still being filled counts as a position.
- **Size** comes from account equity and the stop distance.
- **Spread and slippage** are checked against ATR before an entry.
- **Every entry carries a stop-loss and a take-profit.**
- **The filling mode is the one the symbol accepts:** IOC, then FOK, then RETURN. Many brokers refuse IOC on gold; that was error 10030 before this change.
- **Every order passes `order_check` before it is sent.** Closes do too.
- **Each order carries a tag** (`LX:<id>` in its comment).
  - An order whose tag is already on the account is not sent again. The account is searched in open positions, orders still being filled, and the last 7 days of deals.
  - The scalper saves the tag before it sends the order.
  - Only an explicit "no" from the bridge or broker counts as not sent. When `order_send` gives no result (for example the terminal's reply was lost), the outcome is unknown, not "no".
  - If the answer is lost (timeout, or the bridge stopped), the account is checked for the tag. When it is not there yet, the outcome is "unknown".
  - The next checks look for an unknown order twice before any new entry, so a late fill is not missed.
- **Stopping the scalper:** a check already running does not send an order after `stop`. This holds even for an order already waiting behind another request: it is checked again right before it is written to the bridge.
- **Closes touch only LayanX's own positions** (its magic number). Positions you opened by hand are left alone.
- **Daily limits are kept per UTC day and survive a restart:**
  - daily loss as a share of the day's starting equity, trades per day, and losing streak (fees and swap count);
  - a LayanX trade you close by hand counts toward the streak too;
  - at midnight UTC the counters start again from that day's equity;
  - when a limit is reached, trading pauses until the next day.

## Start

After configuring the environment, start LayanX normally. With `MT5_AUTO_START=true` and the two enable switches, the scalper starts with LayanX. Otherwise, approve `trading.mt5.autoscalper.start` when the agent asks for it.

For a safer first connection, leave `MT5_LIVE_TRADING_ENABLED=false` and use the read tools to validate the connection first.

**Important:** this is real-money trading infrastructure.
- Start with a demo account.
- Before enabling a real account, verify the broker symbol, contract size, volume step, spread, stop-distance rules and server time.
