"""LayanX <-> MetaTrader 5 bridge (Windows, MetaTrader5 Python package).

Two ways to run it:
  python mt5-bridge.py            one request on stdin, one JSON answer on stdout (older callers)
  python mt5-bridge.py --serve    one JSON request per line, one JSON answer per line, connection kept

Each request: {"id", "action", "payload", "credentials", "settings"}.
  credentials: {"login","password","server","terminalPath"} - all optional. Without login+password+server
               the bridge attaches to the MetaTrader 5 terminal that is already open and logged in, so the
               account password does not have to be stored anywhere.
  settings:    {"deviation","magic","allowReal","allowManualClose"} from LayanX (this process gets no secrets
               and no LayanX environment).

Safety in this file (it is the last step before the broker):
  - orders and closes are refused on a real account unless settings.allowReal is true;
  - the filling mode is chosen from what the symbol accepts (IOC, then FOK, then RETURN);
  - every order is checked with order_check first;
  - every order carries a tag (comment "LX:<clientId>"); an order whose tag is already on the account
    is not sent again (find_order answers whether a timed-out order went through);
  - close_position only closes LayanX's own positions (magic number) unless allowManualClose is true.
"""
import datetime
import json
import re
import sys

try:
    # A pipe on Windows defaults to the ANSI code page; LayanX writes UTF-8 (and escapes non-ASCII anyway).
    sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
except Exception:
    pass

try:
    import MetaTrader5 as mt5
except Exception as exc:  # the package is Windows-only
    print(json.dumps({"ok": False, "error": f"MetaTrader5 Python package is required (python -m pip install MetaTrader5): {exc}"}), flush=True)
    sys.exit(1)

UTC = datetime.timezone.utc
TRADE_MODES = {0: "demo", 1: "contest", 2: "real"}
# Symbol filling flags (SYMBOL_FILLING_FOK=1, SYMBOL_FILLING_IOC=2); not exported by every package version.
FILLING_FOK_FLAG = 1
FILLING_IOC_FLAG = 2
RETCODE_PLACED = 10008
RETCODE_DONE = 10009
RETCODE_DONE_PARTIAL = 10010
TAG_PREFIX = "LX:"
TIMEFRAMES = ("M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1")


class BridgeError(Exception):
    pass


class UnknownOutcome(BridgeError):
    """The order may have reached the terminal: LayanX checks the account for its tag before deciding."""


_state = {"connected": False, "key": None}


def iso(ts):
    return datetime.datetime.fromtimestamp(int(ts), UTC).isoformat()


def get(obj, name, default=None):
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def connect(credentials):
    credentials = credentials or {}
    login = credentials.get("login")
    password = credentials.get("password")
    server = credentials.get("server")
    path = credentials.get("terminalPath") or None
    key = (path, str(login or ""), server or "")
    if _state["connected"] and _state["key"] == key and mt5.terminal_info() is not None:
        return
    if _state["connected"]:
        try:
            mt5.shutdown()
        except Exception:
            pass
        _state["connected"] = False
    kwargs = {}
    if path:
        kwargs["path"] = path
    if login and password and server:
        kwargs.update(login=int(login), password=str(password), server=str(server))
    if not mt5.initialize(**kwargs):
        raise BridgeError(
            f"MT5 initialize failed: {mt5.last_error()}. Open MetaTrader 5, log in to the account, "
            "and enable Algo Trading (or store mt5.login, mt5.password and mt5.server in LayanX secrets)."
        )
    _state.update(connected=True, key=key)


def account_info():
    info = mt5.account_info()
    if info is None:
        raise BridgeError(f"account_info failed: {mt5.last_error()} (is the terminal logged in?)")
    return info


def trade_mode_name(info):
    return TRADE_MODES.get(int(get(info, "trade_mode", 2)), "real")


def require_trading_allowed(settings):
    info = account_info()
    mode = trade_mode_name(info)
    if mode == "real" and settings.get("allowReal") is not True:
        raise BridgeError(
            f"Account {get(info, 'login')} on {get(info, 'server')} is a REAL account. LayanX trades on demo "
            "accounts only unless the owner sets MT5_ALLOW_REAL_ACCOUNT=true."
        )
    terminal = mt5.terminal_info()
    if terminal is not None and not get(terminal, "trade_allowed", True):
        raise BridgeError("Algo Trading is turned off in MetaTrader 5 (the AutoTrading button). Turn it on to trade.")
    return info


_SUFFIX = re.compile(r"[._#][A-Za-z]?")


def resolve_name(symbol):
    """The broker's own name for a symbol: CFI calls gold "XAUUSD_", not "XAUUSD" (found 2026-11-13). Only a one-mark
    suffix ("_", "#", ".f") is accepted, never another product ("XAUUSD-24H"); a visible symbol wins; two equal choices are
    refused rather than guessed. Used everywhere a symbol is read, so prices, orders, positions and history agree."""
    symbol = str(symbol or "").strip()
    if not symbol or mt5.symbol_info(symbol) is not None:
        return symbol
    lister = getattr(mt5, "symbols_get", None)
    candidates = [s for s in ((lister(symbol + "*") if lister else None) or [])
                  if s.name.upper().startswith(symbol.upper()) and _SUFFIX.fullmatch(s.name[len(symbol):])]
    if not candidates:
        return symbol
    visible = [s for s in candidates if getattr(s, "visible", False)] or candidates
    if len(visible) > 1:
        raise BridgeError(f"{symbol} matches several broker symbols ({', '.join(s.name for s in visible)}): set the exact one.")
    return visible[0].name


def select(symbol):
    symbol = resolve_name(symbol)
    if not symbol:
        raise BridgeError("symbol is required")
    if not mt5.symbol_select(symbol, True):
        raise BridgeError(f"symbol_select failed: {symbol} (not in this broker's symbol list?)")
    info = mt5.symbol_info(symbol)
    if info is None:
        raise BridgeError(f"symbol_info failed: {symbol}")
    return symbol, info


def tick_of(symbol):
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        raise BridgeError(f"No price for {symbol}: the market may be closed.")
    return tick


def filling_for(info):
    mask = int(get(info, "filling_mode", 0) or 0)
    if mask & FILLING_IOC_FLAG:
        return mt5.ORDER_FILLING_IOC
    if mask & FILLING_FOK_FLAG:
        return mt5.ORDER_FILLING_FOK
    return mt5.ORDER_FILLING_RETURN


def tag_for(client_id):
    client_id = str(client_id or "").strip()
    if not client_id:
        return None
    if len(client_id) > 24 or not all(c.isalnum() or c in "-_" for c in client_id):
        raise BridgeError("clientOrderId must be 1-24 letters, digits, '-' or '_'")
    return TAG_PREFIX + client_id


def position_dict(x):
    return {
        "ticket": str(x.ticket), "symbol": x.symbol,
        "side": "long" if x.type == mt5.POSITION_TYPE_BUY else "short",
        "quantity": float(x.volume), "price": float(x.price_open),
        "stopLoss": float(x.sl) if x.sl else None, "takeProfit": float(x.tp) if x.tp else None,
        "profit": float(x.profit), "magic": int(get(x, "magic", 0) or 0), "comment": str(get(x, "comment", "") or ""),
        "openedAt": iso(get(x, "time", 0) or 0),
    }


def deals_between(days, symbol=None):
    end = datetime.datetime.now(UTC) + datetime.timedelta(days=1)
    start = end - datetime.timedelta(days=max(1, min(int(days), 365)) + 1)
    deals = mt5.history_deals_get(start, end)
    if deals is None:
        raise BridgeError(f"history_deals_get failed: {mt5.last_error()}")
    return [d for d in deals if not symbol or d.symbol == symbol]


def find_tag(tag):
    for position in mt5.positions_get() or []:
        if str(get(position, "comment", "") or "") == tag:
            return {"found": True, "where": "position", "ticket": str(position.ticket),
                    "price": float(position.price_open), "quantity": float(position.volume)}
    for order in mt5.orders_get() or []:  # sent, still being filled
        if str(get(order, "comment", "") or "") == tag:
            return {"found": True, "where": "order", "ticket": str(order.ticket),
                    "price": float(get(order, "price_open", 0) or 0), "quantity": float(get(order, "volume_current", 0) or 0)}
    for deal in deals_between(7):
        if str(get(deal, "comment", "") or "") == tag and int(get(deal, "entry", 0) or 0) == 0:
            return {"found": True, "where": "history", "ticket": str(get(deal, "position_id", deal.order)),
                    "price": float(deal.price), "quantity": float(deal.volume)}
    return {"found": False}


def send_checked(request):
    checked = mt5.order_check(request)
    if checked is None:
        raise BridgeError(f"order_check failed: {mt5.last_error()}")
    if int(get(checked, "retcode", 0) or 0) not in (0, RETCODE_DONE):
        raise BridgeError(f"order_check rejected the order: retcode {get(checked, 'retcode')} {get(checked, 'comment', '')}")
    result = mt5.order_send(request)
    if result is None:
        # Also returned when the terminal's reply is lost after it took the order (-10002): not a "no".
        raise UnknownOutcome(f"order_send returned no result: {mt5.last_error()}")
    retcode = int(get(result, "retcode", 0) or 0)
    return {
        "accepted": retcode in (RETCODE_PLACED, RETCODE_DONE, RETCODE_DONE_PARTIAL),
        "brokerOrderId": str(get(result, "order", "")),
        "executedPrice": float(get(result, "price", 0) or 0),
        "executedQuantity": float(get(result, "volume", 0) or 0),
        "retcode": retcode,
        "message": str(get(result, "comment", "") or ""),
    }


def do_account(p, s):
    info = account_info()
    terminal = mt5.terminal_info()
    return {
        "login": int(info.login), "server": info.server, "balance": float(info.balance), "equity": float(info.equity),
        "currency": str(get(info, "currency", "") or ""), "leverage": int(get(info, "leverage", 0) or 0),
        "tradeMode": trade_mode_name(info),
        "tradeAllowed": bool(get(info, "trade_allowed", True)) and bool(get(terminal, "trade_allowed", True) if terminal is not None else False),
        "terminalConnected": bool(get(terminal, "connected", False)) if terminal is not None else False,
        "realTradingAllowedByOwner": bool(s.get("allowReal")),
    }


def do_tick(p, s):
    symbol, _ = select(p.get("symbol"))
    tick = tick_of(symbol)
    return {"symbol": symbol, "bid": float(tick.bid), "ask": float(tick.ask), "timestamp": iso(tick.time)}


def do_candles(p, s):
    symbol, _ = select(p.get("symbol"))
    timeframe = str(p.get("timeframe", "M1")).upper()
    if timeframe not in TIMEFRAMES:
        raise BridgeError(f"Unsupported MT5 timeframe: {timeframe} (use {', '.join(TIMEFRAMES)})")
    # Up to 99000 candles (the terminal refuses 100000) for history tests (5000 M5 candles were only 17 days, 2026-11-13); the terminal may hold fewer.
    limit = max(1, min(int(p.get("limit", 100)), 99000))
    rates = mt5.copy_rates_from_pos(symbol, getattr(mt5, "TIMEFRAME_" + timeframe), 0, limit)
    if rates is None:
        raise BridgeError(f"copy_rates failed: {mt5.last_error()}")
    return [{"timestamp": iso(x["time"]), "open": float(x["open"]), "high": float(x["high"]), "low": float(x["low"]),
             "close": float(x["close"]), "volume": float(x["tick_volume"])} for x in rates]


def do_symbol_spec(p, s):
    symbol, info = select(p.get("symbol"))
    account = account_info()
    path = get(info, "path", None)
    return {"broker": str(path).split("\\")[0] if path else "MT5", "accountType": trade_mode_name(account), "symbol": symbol,
            "volumeMin": float(info.volume_min), "volumeStep": float(info.volume_step), "volumeMax": float(info.volume_max),
            "tickSize": float(info.trade_tick_size), "tickValue": tick_value(symbol, info)}


def tick_value(symbol, info):
    """What one tick is worth for 1 lot, from the terminal's own profit calculator. The reported trade_tick_value was 100x
    too small for US stocks at CFI (0.0001 instead of 0.01 per cent per share, 2026-11-13): sizing on it would have opened
    stock positions 100x larger than the risk limit. The reported value is used only when the calculator cannot answer."""
    reported = float(get(info, "trade_tick_value", 0) or 0)
    size = float(get(info, "trade_tick_size", 0) or 0)
    calc = getattr(mt5, "order_calc_profit", None)
    if not calc or size <= 0:
        return reported
    try:
        tick = mt5.symbol_info_tick(symbol)
        price = float(tick.ask) if tick and tick.ask else float(get(info, "ask", 0) or get(info, "bid", 0) or 0)
        if price <= 0:
            return reported
        profit = calc(mt5.ORDER_TYPE_BUY, symbol, 1.0, price, price + size)
        return float(profit) if profit is not None and float(profit) > 0 else reported
    except Exception:
        return reported


def do_orders(p, s):
    orders = mt5.orders_get(symbol=resolve_name(p["symbol"])) if p.get("symbol") else mt5.orders_get()
    if orders is None:
        raise BridgeError(f"orders_get failed: {mt5.last_error()}")
    return [{"ticket": str(o.ticket), "symbol": o.symbol, "quantity": float(get(o, "volume_current", 0) or 0),
             "magic": int(get(o, "magic", 0) or 0), "comment": str(get(o, "comment", "") or "")} for o in orders]


def do_positions(p, s):
    positions = mt5.positions_get(symbol=resolve_name(p["symbol"])) if p.get("symbol") else mt5.positions_get()
    if positions is None:
        raise BridgeError(f"positions_get failed: {mt5.last_error()}")
    return [position_dict(x) for x in positions]


def do_history(p, s):
    out = []
    deals = deals_between(p.get("days", 7), resolve_name(p.get("symbol")) or None)
    ours = int(s.get("magic", 0))
    # Positions LayanX opened: a close done by hand carries magic 0 but still ends a LayanX trade.
    opened_by_layanx = {int(get(d, "position_id", 0) or 0) for d in deals
                        if int(get(d, "entry", 0) or 0) == 0 and int(get(d, "magic", 0) or 0) == ours}
    for d in deals:
        entry = int(get(d, "entry", 0) or 0)
        if entry == 0 or d.type not in (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL):
            continue  # opening deals and balance operations carry no result
        magic = int(get(d, "magic", 0) or 0)
        if p.get("onlyLayanX") is True and magic != ours and int(get(d, "position_id", 0) or 0) not in opened_by_layanx:
            continue
        out.append({"ticket": str(d.ticket), "positionId": str(get(d, "position_id", "")), "symbol": d.symbol,
                    "closedAt": iso(d.time), "quantity": float(d.volume), "price": float(d.price),
                    "profit": float(d.profit), "commission": float(get(d, "commission", 0) or 0),
                    "swap": float(get(d, "swap", 0) or 0), "magic": magic, "comment": str(get(d, "comment", "") or "")})
    out.sort(key=lambda x: int(x["ticket"]))
    return out


def do_terminal(p, s):
    info = mt5.terminal_info()
    if info is None:
        raise BridgeError(f"terminal_info failed: {mt5.last_error()}")
    return {"path": str(get(info, "path", "") or ""), "dataPath": str(get(info, "data_path", "") or ""),
            "connected": bool(get(info, "connected", False))}


def do_find_order(p, s):
    tag = tag_for(p.get("clientOrderId"))
    if not tag:
        raise BridgeError("clientOrderId is required")
    return find_tag(tag)


def do_order(p, s):
    require_trading_allowed(s)
    symbol, info = select(p.get("symbol"))
    side = p.get("side")
    if side not in ("long", "short"):
        raise BridgeError("side must be long or short")
    quantity = float(p["quantity"])
    tag = tag_for(p.get("clientOrderId"))
    if tag:
        existing = find_tag(tag)
        if existing["found"]:
            return {"accepted": True, "brokerOrderId": existing["ticket"], "executedPrice": existing["price"],
                    "executedQuantity": existing["quantity"], "message": "already on the account (not sent again)", "replayed": True}
    tick = tick_of(symbol)
    request = {
        "action": mt5.TRADE_ACTION_DEAL, "symbol": symbol, "volume": quantity,
        "type": mt5.ORDER_TYPE_BUY if side == "long" else mt5.ORDER_TYPE_SELL,
        "price": float(tick.ask if side == "long" else tick.bid),
        "sl": float(p["stopLossPrice"]) if p.get("stopLossPrice") else 0.0,
        "tp": float(p["takeProfitPrice"]) if p.get("takeProfitPrice") else 0.0,
        "deviation": int(s.get("deviation", 20)), "magic": int(s.get("magic", 0)),
        "comment": tag or "LayanX", "type_time": mt5.ORDER_TIME_GTC, "type_filling": filling_for(info),
    }
    return send_checked(request)


def do_close_position(p, s):
    require_trading_allowed(s)
    ticket = int(p["ticket"])
    position = next((x for x in (mt5.positions_get() or []) if int(x.ticket) == ticket), None)
    if position is None:
        raise BridgeError(f"Position not found: {ticket}")
    magic = int(s.get("magic", 0))
    if int(get(position, "magic", 0) or 0) != magic and s.get("allowManualClose") is not True:
        raise BridgeError(f"Position {ticket} was not opened by LayanX (magic {get(position, 'magic', 0)}); it is left alone.")
    symbol, info = select(position.symbol)
    tick = tick_of(symbol)
    close_type = mt5.ORDER_TYPE_SELL if position.type == mt5.POSITION_TYPE_BUY else mt5.ORDER_TYPE_BUY
    request = {
        "action": mt5.TRADE_ACTION_DEAL, "symbol": symbol, "volume": float(position.volume), "type": close_type,
        "position": int(position.ticket), "price": float(tick.bid if close_type == mt5.ORDER_TYPE_SELL else tick.ask),
        "deviation": int(s.get("deviation", 20)), "magic": magic, "comment": "LayanX-close",
        "type_time": mt5.ORDER_TIME_GTC, "type_filling": filling_for(info),
    }
    return send_checked(request)


def do_modify_stop(p, s):
    """Moves the stop loss of one of LayanX's own positions, only in the trade's favour (a trailing stop never goes back).
    The same account rules as an order apply (demo only unless the owner allows real; Algo Trading on)."""
    require_trading_allowed(s)
    ticket = int(p["ticket"])
    new_sl = float(p["stopLoss"])
    position = next((x for x in (mt5.positions_get() or []) if int(x.ticket) == ticket), None)
    if position is None:
        raise BridgeError(f"Position not found: {ticket}")
    magic = int(s.get("magic", 0))
    if int(get(position, "magic", 0) or 0) != magic:
        raise BridgeError(f"Position {ticket} was not opened by LayanX (magic {get(position, 'magic', 0)}); its stop is left alone.")
    symbol, info = select(position.symbol)
    tick = tick_of(symbol)
    long = position.type == mt5.POSITION_TYPE_BUY
    current = float(get(position, "sl", 0) or 0)
    if current and (new_sl <= current if long else new_sl >= current):
        raise BridgeError(f"The stop only moves forward: {new_sl} is not better than {current}.")
    gap = float(get(info, "trade_stops_level", 0) or 0) * float(get(info, "point", 0) or 0)
    if long and new_sl >= float(tick.bid) - gap or (not long) and new_sl <= float(tick.ask) + gap:
        raise BridgeError(f"The stop {new_sl} is too close to the price (minimum distance {gap}).")
    digits = int(get(info, "digits", 5) or 5)
    request = {"action": mt5.TRADE_ACTION_SLTP, "symbol": symbol, "position": ticket,
               "sl": round(new_sl, digits), "tp": float(get(position, "tp", 0) or 0), "magic": magic}
    result = send_checked(request)
    result["stopLoss"] = round(new_sl, digits)
    return result


ACTIONS = {
    "account": do_account, "tick": do_tick, "candles": do_candles, "symbol_spec": do_symbol_spec,
    "positions": do_positions, "orders": do_orders, "history": do_history, "find_order": do_find_order, "terminal": do_terminal,
    "order": do_order, "close_position": do_close_position, "modify_stop": do_modify_stop,
}


def handle(request):
    rid = request.get("id") if isinstance(request, dict) else None
    try:
        if not isinstance(request, dict):
            raise BridgeError("request must be a JSON object")
        action = request.get("action")
        if action == "ping":
            return {"id": rid, "ok": True, "result": "pong"}
        fn = ACTIONS.get(action)
        if fn is None:
            raise BridgeError(f"Unknown MT5 bridge action: {action}")
        connect(request.get("credentials"))
        return {"id": rid, "ok": True, "result": fn(request.get("payload") or {}, request.get("settings") or {})}
    except UnknownOutcome as exc:
        return {"id": rid, "ok": False, "unknown": True, "error": str(exc)}
    except BridgeError as exc:
        return {"id": rid, "ok": False, "error": str(exc)}
    except Exception as exc:  # never crash the serve loop on one bad request
        sending = isinstance(request, dict) and request.get("action") in ("order", "close_position")
        # An unexpected error while sending: the order may have gone through, so it is not a plain "no".
        return {"id": rid, "ok": False, "unknown": sending, "error": f"{type(exc).__name__}: {exc}"}


def main():
    if "--serve" in sys.argv[1:]:
        try:
            for line in sys.stdin:
                line = line.strip()
                if not line:
                    continue
                try:
                    request = json.loads(line)
                except ValueError:
                    print(json.dumps({"ok": False, "error": "invalid JSON request"}), flush=True)
                    continue
                print(json.dumps(handle(request)), flush=True)
        finally:
            try:
                mt5.shutdown()
            except Exception:
                pass
        return
    try:
        print(json.dumps(handle(json.loads(sys.stdin.read()))), flush=True)
    finally:
        try:
            mt5.shutdown()
        except Exception:
            pass


if __name__ == "__main__":
    main()
