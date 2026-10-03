import json, os, sys
try:
    import MetaTrader5 as mt5
except Exception as exc:
    print(json.dumps({"ok": False, "error": f"MetaTrader5 Python package is required: {exc}"}))
    sys.exit(1)

def fail(message):
    print(json.dumps({"ok": False, "error": str(message)}))
    sys.exit(0)

try:
    request=json.loads(sys.stdin.read())
    credentials=request["credentials"]
    login=int(credentials["login"])
    password=credentials["password"]
    server=credentials["server"]
    terminal_path=credentials.get("terminalPath")
    initialized=mt5.initialize(path=terminal_path or None)
    if not initialized:
        fail(f"MT5 initialize failed: {mt5.last_error()}")
    if not mt5.login(login=login,password=password,server=server):
        fail(f"MT5 login failed: {mt5.last_error()}")

    action=request["action"]
    p=request.get("payload") or {}

    if action=="account":
        info=mt5.account_info()
        if info is None: fail(f"account_info failed: {mt5.last_error()}")
        result={"login":int(info.login),"server":info.server,"balance":float(info.balance),"equity":float(info.equity)}
    elif action=="tick":
        symbol=p["symbol"]
        if not mt5.symbol_select(symbol,True): fail(f"symbol_select failed: {symbol}")
        tick=mt5.symbol_info_tick(symbol)
        if tick is None: fail(f"symbol_info_tick failed: {symbol}")
        result={"symbol":symbol,"bid":float(tick.bid),"ask":float(tick.ask),"timestamp":__import__("datetime").datetime.fromtimestamp(tick.time,__import__("datetime").timezone.utc).isoformat()}
    elif action=="candles":
        symbol=p["symbol"]; timeframe=str(p["timeframe"]).upper(); limit=int(p["limit"])
        tf_map={"M1":mt5.TIMEFRAME_M1,"M5":mt5.TIMEFRAME_M5,"M15":mt5.TIMEFRAME_M15,"M30":mt5.TIMEFRAME_M30,"H1":mt5.TIMEFRAME_H1,"H4":mt5.TIMEFRAME_H4,"D1":mt5.TIMEFRAME_D1,"W1":mt5.TIMEFRAME_W1}
        if timeframe not in tf_map: fail(f"Unsupported MT5 timeframe: {timeframe}")
        if not mt5.symbol_select(symbol,True): fail(f"symbol_select failed: {symbol}")
        rates=mt5.copy_rates_from_pos(symbol,tf_map[timeframe],0,limit)
        if rates is None: fail(f"copy_rates failed: {mt5.last_error()}")
        result=[{"timestamp":__import__("datetime").datetime.fromtimestamp(int(x["time"]),__import__("datetime").timezone.utc).isoformat(),"open":float(x["open"]),"high":float(x["high"]),"low":float(x["low"]),"close":float(x["close"]),"volume":float(x["tick_volume"])} for x in rates]
    elif action=="symbol_spec":
        symbol=p["symbol"]
        if not mt5.symbol_select(symbol,True): fail(f"symbol_select failed: {symbol}")
        info=mt5.symbol_info(symbol)
        if info is None: fail(f"symbol_info failed: {symbol}")
        result={"broker":str(info.path).split("\\")[0] if getattr(info,"path",None) else "MT5","accountType":"live","symbol":symbol,"volumeMin":float(info.volume_min),"volumeStep":float(info.volume_step),"volumeMax":float(info.volume_max),"tickSize":float(info.trade_tick_size),"tickValue":float(info.trade_tick_value)}
    elif action=="positions":
        positions=mt5.positions_get(symbol=p.get("symbol")) if p.get("symbol") else mt5.positions_get()
        if positions is None: fail(f"positions_get failed: {mt5.last_error()}")
        result=[{"ticket":str(x.ticket),"symbol":x.symbol,"side":"long" if x.type==mt5.POSITION_TYPE_BUY else "short","quantity":float(x.volume),"price":float(x.price_open),"stopLoss":float(x.sl) if x.sl else None,"takeProfit":float(x.tp) if x.tp else None,"profit":float(x.profit)} for x in positions]
    elif action=="order":
        symbol=p["symbol"]; side=p["side"]; quantity=float(p["quantity"])
        if not mt5.symbol_select(symbol,True): fail(f"symbol_select failed: {symbol}")
        tick=mt5.symbol_info_tick(symbol)
        if tick is None: fail(f"tick failed: {symbol}")
        order_type=mt5.ORDER_TYPE_BUY if side=="long" else mt5.ORDER_TYPE_SELL
        price=float(tick.ask if side=="long" else tick.bid)
        request_order={"action":mt5.TRADE_ACTION_DEAL,"symbol":symbol,"volume":quantity,"type":order_type,"price":price,"sl":float(p["stopLossPrice"]) if p.get("stopLossPrice") else 0.0,"tp":float(p["takeProfitPrice"]) if p.get("takeProfitPrice") else 0.0,"deviation":int(os.getenv("MT5_MAX_DEVIATION_POINTS","20")),"magic":int(os.getenv("MT5_MAGIC_NUMBER","2601004")),"comment":"LayanX-AutoScalp","type_time":mt5.ORDER_TIME_GTC,"type_filling":mt5.ORDER_FILLING_IOC}
        checked=mt5.order_check(request_order)
        if checked is None: fail(f"order_check failed: {mt5.last_error()}")
        if getattr(checked,"retcode",0) not in (0,10009): fail(f"order_check rejected: {checked}")
        result_order=mt5.order_send(request_order)
        if result_order is None: fail(f"order_send failed: {mt5.last_error()}")
        result={"accepted":result_order.retcode==mt5.TRADE_RETCODE_DONE,"brokerOrderId":str(result_order.order),"executedPrice":float(result_order.price),"executedQuantity":float(result_order.volume),"message":str(result_order.comment)}
    elif action=="close_position":
        ticket=int(p["ticket"])
        position=next((x for x in (mt5.positions_get() or []) if int(x.ticket)==ticket),None)
        if position is None: fail(f"Position not found: {ticket}")
        symbol=position.symbol
        tick=mt5.symbol_info_tick(symbol)
        if tick is None: fail(f"tick failed: {symbol}")
        close_type=mt5.ORDER_TYPE_SELL if position.type==mt5.POSITION_TYPE_BUY else mt5.ORDER_TYPE_BUY
        price=float(tick.bid if close_type==mt5.ORDER_TYPE_SELL else tick.ask)
        request_order={"action":mt5.TRADE_ACTION_DEAL,"symbol":symbol,"volume":float(position.volume),"type":close_type,"position":int(position.ticket),"price":price,"deviation":int(os.getenv("MT5_MAX_DEVIATION_POINTS","20")),"magic":int(os.getenv("MT5_MAGIC_NUMBER","2601004")),"comment":"LayanX-AutoScalp-Close","type_time":mt5.ORDER_TIME_GTC,"type_filling":mt5.ORDER_FILLING_IOC}
        result_order=mt5.order_send(request_order)
        if result_order is None: fail(f"close order failed: {mt5.last_error()}")
        result={"accepted":result_order.retcode==mt5.TRADE_RETCODE_DONE,"brokerOrderId":str(result_order.order),"executedPrice":float(result_order.price),"executedQuantity":float(result_order.volume),"message":str(result_order.comment)}
    else:
        fail(f"Unknown MT5 bridge action: {action}")
    print(json.dumps({"ok":True,"result":result}))
finally:
    try: mt5.shutdown()
    except Exception: pass
