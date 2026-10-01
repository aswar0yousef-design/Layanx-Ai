import {mkdtemp,writeFile,mkdir,rm} from "node:fs/promises";
import {join} from "node:path";
import {createBrowserToolAdapter,createFileToolAdapter,createTerminalToolAdapter} from "../src/tools/fabric.js";
import type {ToolRequest} from "../src/core/types.js";

const dir=await mkdtemp(join(process.cwd(),"fabric-test-"));
await writeFile(join(dir,"hello.txt"),"LayanX fabric");
await mkdir(join(dir,"nested"));

const base:ToolRequest={missionId:"m",agentId:"core",tool:"files.read",action:"read file",permission:"L1_READ",idempotencyKey:"fabric-read"};
const files=createFileToolAdapter({root:dir});
const read=await files.execute({...base,payload:{path:"hello.txt"}});
if((read as {content:string}).content!=="LayanX fabric")throw new Error("File read failed.");
const listed=await files.execute({...base,action:"list files",payload:{path:"."}});
if(!(listed as {entries:Array<{name:string}>}).entries.some(x=>x.name==="hello.txt"))throw new Error("File listing failed.");
await files.execute({...base,payload:{path:"../outside.txt"}}).then(()=>{throw new Error("Path traversal was not blocked.");}).catch(error=>{if(!String(error).includes("escapes"))throw error;});

let browserCalls=0;
const browser=createBrowserToolAdapter({fetcher:async(input,init)=>{browserCalls++;if(init?.method!=="GET")throw new Error("Browser was not GET-only.");return new Response("<html>LayanX</html>",{status:200,headers:{"content-type":"text/html"}});}});
const page=await browser.execute({ ...base,tool:"browser.read",action:"read web page",payload:{url:"https://example.com"}});
if(browserCalls!==1||(page as {status:number}).status!==200)throw new Error("Browser read failed.");
await browser.execute({...base,tool:"browser.read",action:"read web page",payload:{url:"http://127.0.0.1"}}).then(()=>{throw new Error("Browser loopback was not blocked.");}).catch(error=>{if(!String(error).includes("Local browser targets"))throw error;});

const terminal=createTerminalToolAdapter({root:dir});
const status=await terminal.execute({...base,tool:"terminal.exec",action:"run terminal command",permission:"L4_EXECUTE",payload:{command:"git status --short"}});
if(typeof (status as {stdout:string}).stdout!=="string")throw new Error("Terminal did not return stdout.");
await terminal.execute({...base,tool:"terminal.exec",action:"run terminal command",permission:"L4_EXECUTE",payload:{command:"node -e process.exit(0)"}}).then(()=>{throw new Error("Disallowed terminal command executed.");}).catch(error=>{if(!String(error).includes("not allowed"))throw error;});
await terminal.execute({...base,tool:"terminal.exec",action:"run terminal command",permission:"L4_EXECUTE",payload:{command:"git status; echo unsafe"}}).then(()=>{throw new Error("Shell metacharacter was not blocked.");}).catch(error=>{if(!String(error).includes("metacharacters"))throw error;});

await rm(dir,{recursive:true,force:true});
console.log("Tool fabric tests passed.");
