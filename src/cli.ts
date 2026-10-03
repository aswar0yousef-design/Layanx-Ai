import {LocalSecretVault} from "./security/local-secret-vault.js";
import {runtimeHealth,runtimeStatus} from "./runtime.js";
import {providerDoctor} from "./doctor.js";
import {runReadinessGate} from "./readiness.js";
const command=process.argv[2]??"status";
async function runSecrets(){
 const action=process.argv[3],name=process.argv[4];
 const vault=new LocalSecretVault();
 if(action==="list"){console.log(JSON.stringify({names:vault.names()},null,2));return;}
 if(action==="delete"){if(!name)throw new Error("secret name required");console.log(JSON.stringify({deleted:vault.delete(name),name}));return;}
 if(action==="set"){if(!name)throw new Error("secret name required");const chunks:string[]=[];for await(const chunk of process.stdin)chunks.push(Buffer.isBuffer(chunk)?chunk.toString("utf8"):String(chunk));const value=chunks.join("").trim();if(!value)throw new Error("secret value must be provided on stdin");vault.set(name,value);console.log(JSON.stringify({saved:true,name}));return;}
 throw new Error("Usage: layanx secrets <set NAME|list|delete NAME>. Set reads the secret from stdin and never echoes it.");
}
if(command==="secrets"){try{await runSecrets();}catch(error){console.error(error instanceof Error?error.message:error);process.exitCode=1;}}
else if(command==="status"){console.log(JSON.stringify(runtimeStatus(),null,2));}
else if(command==="check"){const status=runtimeStatus();console.log(JSON.stringify(status,null,2));process.exitCode=status.ready?0:1;}
else if(command==="health"){const health=await runtimeHealth();console.log(JSON.stringify(health,null,2));process.exitCode=health.ready&&health.healthy?0:1;}
else if(command==="doctor"){const doctor=await providerDoctor();console.log(JSON.stringify(doctor,null,2));process.exitCode=doctor.ok?0:1;}
else if(command==="ready"){const gate=await runReadinessGate();console.log(JSON.stringify(gate,null,2));process.exitCode=gate.ready?0:1;}
else{console.error("Usage: layanx <status|check|health|doctor|ready>");process.exitCode=1;}
