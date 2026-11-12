import type {ToolAdapter} from "./executor.js";
import type {ToolRequest} from "../core/types.js";
import {lookup} from "node:dns/promises";
import {isIP} from "node:net";

const MAX_URL_LENGTH=2048;
const MAX_RESPONSE_BYTES=64*1024;
const DEFAULT_TIMEOUT_MS=5000;

function payload(request:ToolRequest):Record<string,unknown>{
 return request.payload&&typeof request.payload==="object"&&!Array.isArray(request.payload)?request.payload as Record<string,unknown>:{};
}
/** Loopback, private, link-local, carrier-grade NAT and unspecified addresses, IPv4 and IPv6 (mapped forms included). */
export function isPrivateAddress(address:string):boolean{
 const a=address.toLowerCase().replace(/^::ffff:/,"");
 if(isIP(a)===4){const [x,y]=a.split(".").map(Number) as [number,number];return x===10||x===127||x===0||(x===169&&y===254)||(x===172&&y>=16&&y<=31)||(x===192&&y===168)||(x===100&&y>=64&&y<=127);}
 return a==="::1"||a==="::"||/^f[cd]/.test(a)||/^fe[89ab]/.test(a);
}
/**
 * The host name is not enough: a public-looking name can point at 127.0.0.1 or the owner's router (found 2026-11-12).
 * Every address the name resolves to must be public. (A name that changes its answer between this check and the request
 * is still possible; redirects are already refused.)
 */
export async function assertPublicAddress(url:URL,resolve:(host:string)=>Promise<Array<{address:string}>>=host=>lookup(host,{all:true})):Promise<void>{
 const host=url.hostname.replace(/^\[|\]$/g,"");
 const addresses=isIP(host)?[{address:host}]:await resolve(host).catch(()=>{throw new Error("The address could not be resolved.");});
 if(!addresses.length||addresses.some(a=>isPrivateAddress(a.address)))throw new Error("Private or local network addresses are blocked.");
}
function validateUrl(value:unknown):URL{
 if(typeof value!=="string"||!value.trim())throw new Error("HTTP URL is required.");
 if(value.length>MAX_URL_LENGTH)throw new Error("HTTP URL is too long.");
 const url=new URL(value);
 if(url.protocol!=="https:"&&url.protocol!=="http:")throw new Error("Only HTTP and HTTPS URLs are allowed.");
 const host=url.hostname.toLowerCase();
 if(host==="localhost"||host==="127.0.0.1"||host==="::1"||host.endsWith(".localhost"))throw new Error("Local HTTP targets are blocked.");
 if(host.startsWith("10.")||host.startsWith("192.168.")||host.startsWith("169.254."))throw new Error("Private HTTP targets are blocked.");
 if(/^172\.(1[6-9]|2\d|3[0-1])\./.test(host))throw new Error("Private HTTP targets are blocked.");
 return url;
}
export function createHttpReadAdapter(options:{fetcher?:typeof fetch;timeoutMs?:number;maxResponseBytes?:number}={}):ToolAdapter{
 const fetcher=options.fetcher??fetch;
 const timeoutMs=options.timeoutMs??DEFAULT_TIMEOUT_MS;
 const maxBytes=options.maxResponseBytes??MAX_RESPONSE_BYTES;
 return {
  async execute(request){
   const input=payload(request);
   const url=validateUrl(input.url);
   // Only the real network is checked; a test that supplies its own fetcher has no DNS.
   if(!options.fetcher)await assertPublicAddress(url);
   const controller=new AbortController();
   const timer=setTimeout(()=>controller.abort(),timeoutMs);
   try{
    const response=await fetcher(url,{method:"GET",redirect:"error",signal:controller.signal,headers:{"accept":"application/json,text/plain;q=0.9,*/*;q=0.1"}});
    const contentLength=Number(response.headers.get("content-length")??"0");
    if(contentLength>maxBytes)throw new Error("HTTP response is too large.");
    const reader=response.body?.getReader();
    if(!reader){
     const text=await response.text();
     if(new TextEncoder().encode(text).byteLength>maxBytes)throw new Error("HTTP response is too large.");
     return{status:response.status,ok:response.ok,url:url.toString(),contentType:response.headers.get("content-type")??"",body:text};
    }
    const chunks:Uint8Array[]=[];let total=0;
    while(true){
     const part=await reader.read();if(part.done)break;
     total+=part.value.byteLength;if(total>maxBytes){await reader.cancel();throw new Error("HTTP response is too large.");}
     chunks.push(part.value);
    }
    const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return{status:response.status,ok:response.ok,url:url.toString(),contentType:response.headers.get("content-type")??"",body:new TextDecoder().decode(bytes)};
   }catch(error){
    if(error instanceof Error&&error.name==="AbortError")throw new Error("HTTP request timed out.");
    throw error;
   }finally{clearTimeout(timer);}
  }
 };
}
