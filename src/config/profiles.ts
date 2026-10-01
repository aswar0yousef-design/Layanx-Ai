import type {LayanXConfig} from "../core/config.js";
import {validateConfig} from "./schema.js";
export const profiles:Record<LayanXConfig["environment"],LayanXConfig>={
 development:{environment:"development",dataDir:"./data/dev",maxToolCalls:100,maxRuntimeMs:60000,defaultPermission:"L1_READ"},
 staging:{environment:"staging",dataDir:"./data/staging",maxToolCalls:50,maxRuntimeMs:60000,defaultPermission:"L1_READ"},
 production:{environment:"production",dataDir:"./data/prod",maxToolCalls:25,maxRuntimeMs:30000,defaultPermission:"L1_READ"}
};
export function loadProfile(environment:LayanXConfig["environment"]){return validateConfig({...profiles[environment]});}
