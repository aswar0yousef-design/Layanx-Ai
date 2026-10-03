import process from "node:process";
const baseUrl=(process.env.LAYANX_PRODUCTION_URL??"").replace(/\/$/,"");
if(!baseUrl)throw new Error("LAYANX_PRODUCTION_URL is required.");

const token=process.env.LAYANX_API_TOKEN?.trim();
const headers:Record<string,string>=token?{authorization:`Bearer ${token}`}:{};

async function check(path:string):Promise<void>{
 const response=await fetch(baseUrl+path,{headers});
 if(!response.ok)throw new Error(`${path} returned HTTP ${response.status}`);
}

await check("/v1/health");
await check("/v1/status");
await check("/v1/control-center");
await check("/v1/scheduler");
await check("/v1/events/triggers");
await check("/v1/approvals?projectId=default");
await check("/v1/release");
await check("/v1/business");
await check("/v1/ads");

console.log(JSON.stringify({
 accepted:true,
 productionUrl:baseUrl,
 checks:["/v1/health","/v1/status","/v1/control-center","/v1/scheduler","/v1/events/triggers","/v1/approvals?projectId=default","/v1/release"],
 timestamp:new Date().toISOString()
},null,2));
