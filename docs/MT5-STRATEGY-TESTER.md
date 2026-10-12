# MT5 Strategy Tester

`trading.mt5.tester.run` runs an MQL5 robot (Expert Advisor) in the MetaTrader 5 Strategy Tester and reads the report into numbers:
- net profit and profit %;
- the worst drawdown %;
- profit factor, Sharpe ratio and LR correlation;
- the number of trades;
- the share of positive months, whether every year was positive, and the longest stretch of months without a new balance high.

It is a backtest on history. **No order reaches a broker.**

The approach and the report reading are adapted from the `mt5-robot-tester` skill in [tradermonty/claude-trading-skills](https://github.com/tradermonty/claude-trading-skills) (MIT, © 2026 TraderMonty).

## One-time setup

1. **Install a second, separate copy of MetaTrader 5, used only for testing,** in its own folder.
   - Prefer a path without spaces, for example `C:\MT5Tester`.
   - Run it once with `/portable`: `C:\MT5Tester\terminal64.exe /portable`. Its data then stays in that folder.
2. In that copy:
   - log in to any broker account (demo is fine), so it can download price history;
   - set the language to English (**View → Languages**), so LayanX can read the report labels.
3. Put the compiled robots (`.ex5`) in `C:\MT5Tester\MQL5\Experts\`. Subfolders are fine, for example `Advisors\MyRobot.ex5`.
4. Tell LayanX where it is:

```
MT5_TESTER_TERMINAL=C:\MT5Tester\terminal64.exe
MT5_TESTER_TIMEOUT_MINUTES=30   # optional, 1 to 180
```

5. Close the tester copy before a run: LayanX opens it, and it closes itself when the test ends.

### Why a separate copy

The tester closes its terminal when it finishes (`ShutdownTerminal=1`). On the copy you trade with, that would stop the auto-scalper and any robot running there.

LayanX refuses `MT5_TESTER_TERMINAL` when it is the live terminal in either of these cases:
- it matches `mt5.terminalPath` / `LAYANX_MT5_TERMINAL_PATH`;
- LayanX is connected to MT5 and the terminal reports the same install or data folder.

Folders are compared after resolving links and short names. LayanX does not start MT5 just to compare.

Two more checks:
- When LayanX is not connected, a **running** copy of the tester terminal is refused: close it first. If it is the copy you trade with, use a separate one.
- When the comparison itself fails, the test does not start.

## Use

The agent calls it with a payload like this (you approve each run):

```json
{"expert":"Advisors\\MyRobot","symbol":"XAUUSD","period":"H1","from":"2024-01-01","to":"2025-06-30",
 "model":"ohlc_m1","deposit":10000,"currency":"USD","leverage":100,"inputs":{"Lots":0.1,"UseTrailing":true}}
```

- **model:**

  | Value | Speed | Notes |
  |---|---|---|
  | `open_prices` | fastest | first look only |
  | `ohlc_m1` | fast | the default |
  | `every_tick` | slow | |
  | `real_ticks` | slowest, most accurate | needs the broker's tick history; use it to confirm a promising result |

- **inputs:** the robot's input parameters. Values only: letters, digits, `. _ - + :` and spaces.

The result includes the report file path. It is in `C:\MT5Tester\layanx-tester\`, with the INI that started the test.

## What LayanX checks

- **The program:**
  - it is only the one in `MT5_TESTER_TERMINAL`, which the owner sets; the agent cannot choose it;
  - it must be an absolute path to `terminal64.exe`.
- **The robot:**
  - only a name inside `MQL5\Experts`: no `..` and no paths outside it;
  - the `.ex5` must exist.
- **The INI cannot be changed by the agent:**
  - every value is checked: symbol, period, dates, deposit, currency, leverage, input names and values;
  - no line breaks, and no `||` optimization syntax.
- **One test at a time,** with a time limit. On timeout LayanX stops the process it started and the tester agents under it (`taskkill /T`). The run lock is always released.
- **Paths with spaces:** the INI is passed relative to the terminal's folder (the terminal starts there), so no quoted argument is needed.
- **The robot itself runs inside MetaTrader.** Robots from unknown sources can use DLLs if "Allow DLL imports" is on in the tester copy, so leave it off.

## When it fails

| Message | Check |
|---|---|
| closed without a report | The tester copy was already open; it is not logged in (no history); the robot does not compile; the symbol does not exist at that broker |
| did not finish within N minutes | Shorter period, model `ohlc_m1` or `open_prices`, or a larger `timeoutMinutes` (up to 180) |
| report summary could not be read | Set the tester copy's language to English and run again |
