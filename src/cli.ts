import {runtimeStatus} from "./runtime.js";

const command=process.argv[2]??"status";

if(command==="status"){
 console.log(JSON.stringify(runtimeStatus(),null,2));
}else if(command==="check"){
 const status=runtimeStatus();
 console.log(JSON.stringify(status,null,2));
 process.exitCode=status.ready?0:1;
}else{
 console.error("Usage: layanx <status|check>");
 process.exitCode=1;
}
