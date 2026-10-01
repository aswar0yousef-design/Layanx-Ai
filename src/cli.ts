import {runtimeHealth,runtimeStatus} from "./runtime.js";

const command=process.argv[2]??"status";

if(command==="status"){
 console.log(JSON.stringify(runtimeStatus(),null,2));
}else if(command==="check"){
 const status=runtimeStatus();
 console.log(JSON.stringify(status,null,2));
 process.exitCode=status.ready?0:1;
}else if(command==="health"){
 const health=await runtimeHealth();
 console.log(JSON.stringify(health,null,2));
 process.exitCode=health.ready&&health.healthy?0:1;
}else{
 console.error("Usage: layanx <status|check|health>");
 process.exitCode=1;
}
