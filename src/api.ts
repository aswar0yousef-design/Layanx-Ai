import {createRuntime,restoreRuntime} from "./runtime.js";
import {startRuntimeApi} from "./api-server.js";
const runtime=createRuntime();
await restoreRuntime(runtime);
const host=process.env.LAYANX_API_HOST??"127.0.0.1";
const port=Number(process.env.LAYANX_API_PORT??3000);
startRuntimeApi({core:runtime.core,business:runtime.business,ads:runtime.ads,media:runtime.media,growth:runtime.growth,channels:runtime.channels,persistence:runtime.persistence,host,port,token:process.env.LAYANX_API_TOKEN});
console.log(JSON.stringify({system:"LayanX AI",api:`http://${host}:${port}`,status:"running"}));
