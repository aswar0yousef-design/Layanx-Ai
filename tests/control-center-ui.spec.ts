import {startRuntimeApi} from "../src/api-server.js";
import {LayanXCore} from "../src/core/orchestrator.js";

const core=new LayanXCore();
core.registerAgent({agentId:"core",purpose:"test",allowedTools:[],forbiddenResources:["secrets"],requiredPermission:"L1_READ",maxToolCalls:10,maxRuntimeMs:1000,successCriteria:["done"],stopCondition:"stop"});

const server=startRuntimeApi({core,host:"127.0.0.1",port:0});
await new Promise<void>(resolve=>server.on("listening",()=>resolve()));
const address=server.address();
if(!address||typeof address==="string")throw new Error("Server did not bind.");
const base="http://127.0.0.1:"+address.port;
const page=await fetch(base+"/");
if(!page.ok||!(await page.text()).includes("LayanX AI Control Center"))throw new Error("Control center HTML was not served.");
const js=await fetch(base+"/app.js");
if(!js.ok||!(await js.text()).includes("/v1/missions"))throw new Error("Control center JavaScript was not served.");
const css=await fetch(base+"/styles.css");
if(!css.ok||!(await css.text()).includes(".sidebar"))throw new Error("Control center CSS was not served.");
server.close();
console.log("Local control center serving test passed.");