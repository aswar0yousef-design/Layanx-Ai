import {createHttpHealthCheck} from "../src/release/http-health-check.js";

const healthy=createHttpHealthCheck({
 name:"production",
 url:"https://example.invalid/health",
 fetcher:async()=>new Response("ok",{status:200})
});
if(!await healthy.check())throw new Error("Healthy HTTP deployment check failed.");

const accepted=createHttpHealthCheck({
 name:"production",
 url:"https://example.invalid/health",
 expectedStatus:[200,204],
 fetcher:async()=>new Response(null,{status:204})
});
if(!await accepted.check())throw new Error("Configured HTTP status was not accepted.");

const unhealthy=createHttpHealthCheck({
 name:"production",
 url:"https://example.invalid/health",
 fetcher:async()=>new Response("bad",{status:503})
});
if(await unhealthy.check())throw new Error("Unhealthy HTTP deployment check was accepted.");

const throwing=createHttpHealthCheck({
 name:"production",
 url:"https://example.invalid/health",
 fetcher:async()=>{throw new Error("network unavailable");}
});
let threw=false;
try{await throwing.check();}catch{threw=true;}
if(!threw)throw new Error("HTTP health check must surface transport failures to ReleaseHealthProbe.");

console.log("HTTP deployment health check passed.");
