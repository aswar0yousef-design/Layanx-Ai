# MT5 Live Auto-Trading

LayanX can now connect to a local MetaTrader 5 terminal and execute the XAUUSD M1 scalping strategy.

## Architecture

`LayanX -> MT5 Live Adapter -> local Python bridge -> MetaTrader5 terminal -> broker`

No account password is stored in source code. Credentials are stored in the encrypted local LayanX Secret Vault.

## Install the local bridge

On the same Windows PC that has MetaTrader 5:

```bash
python -m pip install MetaTrader5
```

Make sure MT5 is installed, logged into the intended account, and Algo Trading is enabled.

## Store account credentials

Set a local vault master key first:

```bash
set LAYANX_SECRET_VAULT_KEY=<long-local-secret>
```

Then:

```npm run layanx -- secrets set mt5.login <ACCOUNT_NUMBER>
npm run layanx -- secrets set mt5.password <ACCOUNT_PASSWORD>
npm run layanx -- secrets set mt5.server <BROKER_SERVER>
```

Optional terminal path:

```npm run layanx -- secrets set mt5.terminalPath "C:\\Program Files\\MetaTrader 5\\terminal64.exe"
```

## Live safety switches

Live trading requires all of these:

```MT5_LIVE_TRADING_ENABLED=true
MT5_AUTO_SCALPING_ENABLED=true
MT5_AUTO_START=true
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
MT5_MAX_DEVIATION_POINTS=20
MT5_MAGIC_NUMBER=2601004
```

The auto-scalper:
- uses completed candles only;
- refuses a second open position for the configured symbol;
- sizes from account equity and stop distance;
- enforces spread/ATR execution quality;
- attaches stop-loss and take-profit to every entry;
- enforces daily loss and daily trade limits;
- uses an idempotent client order identifier;
- stops opening new trades when limits are reached.

## Start

After configuring the environment, start the LayanX runtime normally:

```npm run api```

With all three live switches enabled, the MT5 scalper starts automatically.

For a safer first connection, leave `MT5_LIVE_TRADING_ENABLED=false` and use the account/status tools to validate connectivity before enabling live execution.

**Important:** this is real-money trading infrastructure. Start with a demo account and verify the broker symbol, contract size, volume step, spread, stop-distance rules, and server time before enabling a real account.
