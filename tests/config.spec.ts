import {loadProfile} from "../src/config/profiles.js";
import {assertProductionFlags} from "../src/config/feature-flags.js";
const prod=loadProfile("production");
if(prod.defaultPermission!=="L1_READ")throw new Error("Unsafe production default permission.");
let blocked=false;try{assertProductionFlags({enableCloudModels:false,enableSkills:true,enableComputerAgent:false,enableTrading:true,enableProductionWrites:false});}catch{blocked=true;}
if(!blocked)throw new Error("Unsafe trading flag was not blocked.");
console.log("Configuration safety test passed.");
