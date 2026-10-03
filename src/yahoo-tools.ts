import type {LayanXCore} from "./core/orchestrator.js";
import {createYahooMailAdapter} from "./connectors/yahoo-mail.js";
export function registerYahooMailTools(core:LayanXCore):void{
 const adapter=createYahooMailAdapter();
 const defs=[["yahoo.mail.search","search Yahoo Mail messages","search yahoo mail","L1_READ",false],["yahoo.mail.read","read a Yahoo Mail message","read yahoo mail","L1_READ",false],["yahoo.mail.send","send an email through Yahoo Mail","send yahoo mail","L4_EXECUTE",true]] as const;
 for(const [name,description,action,permission,dangerous] of defs){core.tools.register({name,description,permission,dangerous,actions:[action],tags:["yahoo","mail","email"]});core.toolAdapters.register(name,adapter);}
}