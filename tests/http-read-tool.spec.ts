import {createHttpReadAdapter} from "../src/tools/http-read.js";
const calls:Array<{url:string;method?:string;redirect?:string}>=[];const fetcher=async(input:RequestInfo|URL,init?:RequestInit)=>{
 calls.push({url:String(input),method:init?.method,redirect:init?.redirect});
 return new Response("hello",{status:200,headers:{"content-type":"text/plain","content-length":"5"}});
};
const adapter=createHttpReadAdapter({fetcher});
const result=await adapter.execute({missionId:"m",agentId:"a",tool:"http.read",action:"read url",permission:"L1_READ",idempotencyKey:"k",payload:{url:"https://example.com/data"}});
if(result.status!==200||result.body!=="hello")throw new Error("HTTP read failed");
if(calls[0].method!=="GET"||calls[0].redirect!=="error")throw new Error("HTTP request was not restricted");
for(const url of ["http://127.0.0.1","http://localhost","http://10.0.0.1","http://192.168.1.1","http://172.16.0.1"]){
 let rejected=false;try{await adapter.execute({...({missionId:"m",agentId:"a",tool:"http.read",action:"read url",permission:"L1_READ",idempotencyKey:url,payload:{url}})});}catch(error){rejected=error instanceof Error&&error.message.includes("blocked");}
 if(!rejected)throw new Error("private target was accepted: "+url);
}
const oversized=createHttpReadAdapter({fetcher:async()=>new Response("1234567890",{status:200}) ,maxResponseBytes:5});
let limited=false;try{await oversized.execute({missionId:"m",agentId:"a",tool:"http.read",action:"read url",permission:"L1_READ",idempotencyKey:"size",payload:{url:"https://example.com"}});}catch(error){limited=error instanceof Error&&error.message.includes("too large");}
if(!limited)throw new Error("response size limit failed");
console.log("HTTP read security tests passed.");
