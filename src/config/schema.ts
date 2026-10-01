import type {LayanXConfig} from "../core/config.js";
export function validateConfig(config:LayanXConfig){
 if(!config.dataDir)throw new Error("dataDir is required.");
 if(config.maxToolCalls<=0||config.maxRuntimeMs<=0)throw new Error("Runtime limits must be positive.");
 if(config.environment==="production"&&config.defaultPermission!=="L1_READ")throw new Error("Production must default to read-only permission.");
 return config;
}
