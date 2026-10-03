import type {ToolDefinition} from "../tools/registry.js";
import type {ToolAdapter} from "../tools/executor.js";
import type {ToolRegistry} from "../tools/registry.js";
import type {ToolAdapterRegistry} from "../tools/adapters.js";
import {Mt5LiveAdapter} from "./mt5-live-adapter.js";
import {Mt5AutoScalper} from "./mt5-auto-scalper.js";

export const MT5_ACCOUNT_TOOL="trading.mt5.account";
export const MT5_AUTO_START_TOOL="trading.mt5.autoscalper.start";
export const MT5_AUTO_STOP_TOOL="trading.mt5.autoscalper.stop";
export const MT5_AUTO_STATUS_TOOL="trading.mt5.autoscalper.status";

export function registerMt5TradingTools(tools:ToolRegistry,adapters:ToolAdapterRegistry):Mt5AutoScalper{
 const scalper=new Mt5AutoScalper();
 const accountDef:ToolDefinition={name:MT5_ACCOUNT_TOOL,description:"Read the configured MT5 account connection and equity.",permission:"L1_READ",dangerous:false,actions:["mt5-account"],tags:["trading","mt5","account"]};
 const startDef:ToolDefinition={name:MT5_AUTO_START_TOOL,description:"Start the LayanX MT5 XAUUSD M1 auto-scalper. Live orders require MT5_LIVE_TRADING_ENABLED=true.",permission:"L4_EXECUTE",dangerous:true,actions:["start-mt5-autoscalper"],tags:["trading","mt5","scalping","live"]};
 const stopDef:ToolDefinition={name:MT5_AUTO_STOP_TOOL,description:"Stop the LayanX MT5 auto-scalper.",permission:"L4_EXECUTE",dangerous:true,actions:["stop-mt5-autoscalper"],tags:["trading","mt5","scalping","live"]};
 const statusDef:ToolDefinition={name:MT5_AUTO_STATUS_TOOL,description:"Read MT5 auto-scalper status.",permission:"L1_READ",dangerous:false,actions:["mt5-scalper-status"],tags:["trading","mt5","scalping"]};
 for(const def of [accountDef,startDef,stopDef,statusDef])if(!tools.list().some(x=>x.name===def.name))tools.register(def);
 adapters.register(MT5_ACCOUNT_TOOL,{async execute(){return await new Mt5LiveAdapter().connect();}});
 adapters.register(MT5_AUTO_START_TOOL,{async execute(){if(process.env.MT5_AUTO_SCALPING_ENABLED!=="true")throw new Error("MT5 auto-scalping is disabled. Set MT5_AUTO_SCALPING_ENABLED=true.");return scalper.start();}});
 adapters.register(MT5_AUTO_STOP_TOOL,{async execute(){return scalper.stop();}});
 adapters.register(MT5_AUTO_STATUS_TOOL,{async execute(){return scalper.status();}});
 return scalper;
}
