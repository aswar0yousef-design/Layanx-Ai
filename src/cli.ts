import {runtimeHealth,runtimeStatus} from "./runtime.js";
import {providerDoctor} from "./doctor.js";
import { configureBinanceSecretsInteractive, printLocalSecretStoreStatus } from "./security/local-secret-store-cli.js";
const command=process.argv[2]??"status";
if(command==="status"){console.log(JSON.stringify(runtimeStatus(),null,2));}
else if(command==="check"){const status=runtimeStatus();console.log(JSON.stringify(status,null,2));process.exitCode=status.ready?0:1;}
else if(command==="health"){const health=await runtimeHealth();console.log(JSON.stringify(health,null,2));process.exitCode=health.ready&&health.healthy?0:1;}
else if(command==="doctor"){const doctor=await providerDoctor();console.log(JSON.stringify(doctor,null,2));process.exitCode=doctor.ok?0:1;}\nelse if(command==="secrets:setup-binance"){await configureBinanceSecretsInteractive();}\nelse if(command==="secrets:status"){await printLocalSecretStoreStatus();}
else{console.error("Usage: layanx <status|check|health|doctor|secrets:setup-binance|secrets:status>");process.exitCode=1;}
