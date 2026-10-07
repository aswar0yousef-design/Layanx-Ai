/**
 * ACP entry point: the editor starts this with node and talks JSON-RPC on stdin/stdout.
 *
 *   node <LayanX>\node_modules\tsx\dist\cli.mjs <LayanX>\src\acp\main.ts
 *
 * It connects to the LayanX running on this computer (start it with LayanX.cmd first) using the
 * installation's own local token from the secret store (accepted from this computer only).
 * LAYANX_URL / LAYANX_API_TOKEN override both (for example a paired-device token).
 */
// stdout belongs to the protocol: anything else printed by a library goes to stderr.
console.log=console.error;console.info=console.error;console.warn=console.error;
const {AcpAgent,serveAcp}=await import("./agent.js");
const {resolveDataPaths}=await import("../platform/paths.js");
const {loadSettings}=await import("../local/settings.js");
const {readFileSync}=await import("node:fs");
const {fileURLToPath}=await import("node:url");

const paths=resolveDataPaths();
const base=(process.env.LAYANX_URL?.trim()||`http://127.0.0.1:${loadSettings(paths.settingsFile).publicPort}`).replace(/\/+$/,"");
let token=process.env.LAYANX_API_TOKEN?.trim()||"";
if(!token){
  try{const {openSecretStore}=await import("../security/secret-store.js");token=(await openSecretStore(paths.dataDir)).get("LAYANX_API_TOKEN")??"";}
  catch(e){console.error("LayanX ACP: could not read the local token: "+(e instanceof Error?e.message:String(e)));}
}
let version="0";
try{version=String(JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json",import.meta.url)),"utf8")).version??"0");}catch{}

const api={
  async request(method:"GET"|"POST",path:string,body?:unknown){
    try{
      const res=await fetch(base+path,{method,headers:{"content-type":"application/json",...(token?{authorization:"Bearer "+token}:{})},
        ...(method==="GET"?{}:{body:JSON.stringify(body??{})}),signal:AbortSignal.timeout(path.endsWith("/agent-loop")?30*60_000:60_000)});
      const text=await res.text();
      let data:any;try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
      if(res.status===401)data={...data,error:"LayanX refused the connection (401). Start LayanX on this computer with LayanX.cmd."};
      return{status:res.status,data};
    }catch(e){return{status:503,data:{error:`LayanX is not reachable at ${base}. Start it with LayanX.cmd. (${e instanceof Error?e.message:String(e)})`}};}
  }
};
await serveAcp(send=>new AcpAgent(api,send,{version,log:m=>console.error("LayanX ACP: "+m)}),process.stdin,process.stdout);
process.exit(0);
