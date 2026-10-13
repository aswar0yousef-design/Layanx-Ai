import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import fs from "node:fs";
import {ISLAND_SCRIPT,startDesktopIsland} from "../src/local/island.js";
import {DEFAULT_SETTINGS,sanitizeSettings} from "../src/local/settings.js";

const logs:string[]=[];const log=(_l:string,m:string)=>{logs.push(m);};
// Not Windows: nothing starts.
assert.equal(startDesktopIsland({port:3000,dataDir:"x",token:"t",log,platform:"linux"}),null);

// Windows: PowerShell gets the script and the port; the token goes to stdin only, and LayanX secrets stay out of its environment.
let call:{cmd:string;args:string[];opts:any}|null=null;let stdin="";
process.env.OPENAI_API_KEY=["sk","should-not-leak"].join("-");
const fake=((cmd:string,args:string[],opts:any)=>{
  call={cmd,args,opts};
  const child=Object.assign(new EventEmitter(),{stdin:Object.assign(new EventEmitter(),{end:(s:string)=>{stdin+=s;}}),unref(){}});
  return child as any;
}) as any;
const child=startDesktopIsland({port:3123,dataDir:"C:\\Users\\ryzen\\AppData\\Local\\LayanX",token:"lxm_secret_token",log,platform:"win32",spawnFn:fake});
assert.ok(child);
assert.equal(call!.cmd,"powershell.exe");
assert.ok(call!.args.includes("-File")&&call!.args.includes(ISLAND_SCRIPT));
assert.equal(call!.args[call!.args.indexOf("-Port")+1],"3123");
assert.ok(call!.args.includes("-InputFormat")&&call!.args[call!.args.indexOf("-InputFormat")+1]==="None","stdin is readable by the script");
assert.ok(!call!.args.join(" ").includes("lxm_secret_token"),"token never on the command line");
assert.equal(stdin,"lxm_secret_token\n");
assert.equal(call!.opts.env.OPENAI_API_KEY,undefined,"no LayanX secrets in its environment");
assert.equal(call!.opts.windowsHide,true);
delete process.env.OPENAI_API_KEY;

// The script: UTF-8 with BOM and CRLF (Windows PowerShell 5.1 reads Arabic correctly), reads the feed, decides nothing.
const raw=fs.readFileSync(ISLAND_SCRIPT);
assert.deepEqual([...raw.subarray(0,3)],[0xef,0xbb,0xbf],"BOM");
const text=raw.toString("utf8");
assert.ok(!/[^\r]\n/.test(text),"CRLF line endings");
assert.match(text,/\/v1\/companion\/feed/);
assert.ok(!/\/approve|\/revoke/.test(text),"approvals are decided in the control center or on the phone, never from the island");
assert.match(text,/Local\\LayanXDesktopIsland/,"one island per session");

// Setting: on by default, can be turned off from the setup page.
assert.equal(DEFAULT_SETTINGS.desktopIsland,true);
assert.equal(sanitizeSettings({desktopIsland:false}).desktopIsland,false);
assert.equal(sanitizeSettings({desktopIsland:"no"}).desktopIsland,true);
console.log("desktop-island: started on Windows only, token over stdin, read-only, one per session");
