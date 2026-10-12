"""Stand-in for the MetaTrader5 package (Windows-only) so the bridge can be tested anywhere.

State lives in the JSON file named by FAKE_MT5_STATE, so it survives a bridge restart (like a real
account does). Each call records what it saw, for the tests to check.
"""
import json
import os
import time
from types import SimpleNamespace

ORDER_FILLING_FOK, ORDER_FILLING_IOC, ORDER_FILLING_RETURN = 0, 1, 2
TRADE_ACTION_DEAL = 1
ORDER_TYPE_BUY, ORDER_TYPE_SELL = 0, 1
POSITION_TYPE_BUY, POSITION_TYPE_SELL = 0, 1
DEAL_TYPE_BUY, DEAL_TYPE_SELL, DEAL_TYPE_BALANCE = 0, 1, 2
ORDER_TIME_GTC = 0
TRADE_RETCODE_DONE = 10009
TIMEFRAME_M1, TIMEFRAME_M5, TIMEFRAME_M15, TIMEFRAME_M30 = 1, 5, 15, 30
TIMEFRAME_H1, TIMEFRAME_H4, TIMEFRAME_D1, TIMEFRAME_W1 = 16385, 16388, 16408, 32769

_PATH = os.environ.get("FAKE_MT5_STATE", "")
_initialized = False


def _load():
    with open(_PATH, encoding="utf-8") as f:
        return json.load(f)


def _save(state):
    with open(_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f)


def _ns(d):
    return SimpleNamespace(**d)


def initialize(path=None, login=None, password=None, server=None, **kw):
    global _initialized
    s = _load()
    s["initialize_calls"] = s.get("initialize_calls", 0) + 1
    s["last_initialize"] = {"path": path, "login": login, "password": bool(password), "server": server}
    s["initialize_password"] = password
    s["secret_in_env"] = any(k in os.environ for k in ("ANTHROPIC_API_KEY", "LAYANX_SECRET_VAULT_KEY", "OPENAI_API_KEY"))
    _save(s)
    if not s.get("logged_in", True) and not (login and password and server):
        return False
    _initialized = True
    return True


def shutdown():
    global _initialized
    _initialized = False
    return True


def last_error():
    return (1, "fake error")


def terminal_info():
    if not _initialized:
        return None
    s = _load()
    return _ns({"connected": True, "trade_allowed": s.get("terminal_trade_allowed", True),
                "path": s.get("terminal_path", "C:\\Program Files\\MetaTrader 5"), "data_path": s.get("terminal_data_path", "C:\\Users\\me\\AppData\\Roaming\\MetaQuotes\\Terminal\\ABC")})


def account_info():
    s = _load()
    return _ns({"login": 5551234, "server": "Fake-Demo", "balance": s.get("balance", 10000.0), "equity": s.get("equity", 10000.0),
                "currency": "USD", "leverage": 100, "trade_mode": s.get("trade_mode", 0), "trade_allowed": True})


def symbol_select(symbol, enable=True):
    return symbol in ("XAUUSD", "EURUSD")


def symbol_info(symbol):
    s = _load()
    return _ns({"filling_mode": s.get("filling_mode", 1), "volume_min": 0.01, "volume_step": 0.01, "volume_max": 100.0,
                "trade_tick_size": 0.01, "trade_tick_value": 1.0, "path": "Fake\\Metals\\" + symbol, "point": 0.01})


def symbol_info_tick(symbol):
    s = _load()
    if s.get("market_closed"):
        return None
    return _ns({"bid": 2400.0, "ask": 2400.3, "time": 1760000000})


def copy_rates_from_pos(symbol, timeframe, start, count):
    base = 1760000000 - count * 60
    return [{"time": base + i * 60, "open": 2400.0, "high": 2401.0, "low": 2399.0, "close": 2400.5, "tick_volume": 10} for i in range(count)]


def positions_get(symbol=None, ticket=None):
    s = _load()
    out = [p for p in s.get("positions", []) if (symbol is None or p["symbol"] == symbol) and (ticket is None or p["ticket"] == ticket)]
    return [_ns(p) for p in out]


def history_deals_get(date_from, date_to, **kw):
    s = _load()
    if s.get("history_none"):
        return None
    return [_ns(d) for d in s.get("deals", [])]


def orders_get(**kw):
    return [_ns(o) for o in _load().get("orders", [])]


def order_check(request):
    s = _load()
    s.setdefault("checks", []).append({k: request.get(k) for k in ("type_filling", "comment", "position", "magic")})
    _save(s)
    return _ns({"retcode": 0, "comment": "Done"})


def order_send(request):
    s = _load()
    if s.get("order_none"):
        return None  # e.g. the terminal's reply was lost (-10002)
    delay = s.get("order_delay", 0)
    s.setdefault("sends", []).append({k: request.get(k) for k in ("type_filling", "comment", "position", "magic", "volume", "type")})
    accepted_filling = {1: ORDER_FILLING_FOK, 2: ORDER_FILLING_IOC}
    mask = s.get("filling_mode", 1)
    allowed = [v for bit, v in accepted_filling.items() if mask & bit] or [ORDER_FILLING_RETURN]
    if request.get("type_filling") not in allowed:
        _save(s)
        return _ns({"retcode": 10030, "order": 0, "price": 0.0, "volume": 0.0, "comment": "Unsupported filling mode"})
    s["next_ticket"] = s.get("next_ticket", 1000) + 1
    ticket = s["next_ticket"]
    if request.get("position"):
        s["positions"] = [p for p in s.get("positions", []) if p["ticket"] != request["position"]]
        s.setdefault("deals", []).append({"ticket": ticket, "order": ticket, "position_id": request["position"], "symbol": request["symbol"],
                                          "type": request["type"], "entry": 1, "time": int(time.time()), "volume": request["volume"],
                                          "price": request["price"], "profit": s.get("close_profit", -5.0), "commission": 0.0, "swap": 0.0,
                                          "magic": request.get("magic", 0), "comment": request.get("comment", "")})
    else:
        s.setdefault("positions", []).append({"ticket": ticket, "symbol": request["symbol"], "type": request["type"], "volume": request["volume"],
                                              "price_open": request["price"], "sl": request.get("sl", 0.0), "tp": request.get("tp", 0.0),
                                              "profit": 0.0, "magic": request.get("magic", 0), "comment": request.get("comment", ""), "time": 1760000000})
        s.setdefault("deals", []).append({"ticket": ticket, "order": ticket, "position_id": ticket, "symbol": request["symbol"], "type": request["type"],
                                          "entry": 0, "time": int(time.time()), "volume": request["volume"], "price": request["price"], "profit": 0.0,
                                          "commission": 0.0, "swap": 0.0, "magic": request.get("magic", 0), "comment": request.get("comment", "")})
    _save(s)
    if delay:
        time.sleep(delay)  # the order is on the account, but the answer is late
    return _ns({"retcode": 10009, "order": ticket, "price": request["price"], "volume": request["volume"], "comment": "Request executed"})
