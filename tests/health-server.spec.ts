import {startHealthServer} from "../src/release/health-server.js";

const server=startHealthServer({port:0,host:"127.0.0.1",readiness:()=>true});
await new Promise<void>(resolve=>server.once("listening",()=>resolve()));
const address=server.address();
if(!address||typeof address==="string")throw new Error("Health server did not bind to a TCP port.");
const healthy=await fetch(`http://127.0.0.1:${address.port}/health`);
if(healthy.status!==200)throw new Error("Health endpoint did not return 200.");
const body=await healthy.json() as {ok:boolean;status:string};
if(!body.ok||body.status!=="healthy")throw new Error("Health endpoint returned an invalid healthy response.");
const missing=await fetch(`http://127.0.0.1:${address.port}/missing`);
if(missing.status!==404)throw new Error("Health server did not return 404 for unknown routes.");
server.close();
await new Promise<void>(resolve=>server.once("close",()=>resolve()));
console.log("HTTP health server passed.");
