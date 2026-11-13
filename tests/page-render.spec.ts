import assert from "node:assert/strict";
import {checkedUrl,createPageRenderAdapter,obscuraArgs,runObscura} from "../src/tools/page-render.js";

// Local, private and credentialed addresses are refused before any engine starts.
for(const bad of ["http://localhost:3000/","http://127.0.0.1/","http://10.0.0.5/","http://192.168.1.1/admin","http://[::1]/","http://172.20.0.1/","http://user:pw@example.com/","file:///C:/Windows/win.ini","ftp://example.com/"])
  assert.throws(()=>checkedUrl(bad),undefined,bad);
assert.equal(checkedUrl("https://example.com/a?b=1").hostname,"example.com");

// The command line is fixed: only the URL comes from the request, never stealth or private-network flags.
const args=obscuraArgs(new URL("https://example.com/"),"--stealth",999);
assert.deepEqual(args,["fetch","https://example.com/","--dump","text","--wait-until","load","--timeout","60","--quiet"]);
assert.ok(!args.join(" ").includes("stealth"));
await assert.rejects(runObscura(process.execPath,["fetch","https://example.com/","--stealth"],5000),/refused/);
await assert.rejects(runObscura(process.execPath,["fetch","https://example.com/","--allow-private-network"],5000),/refused/);

const publicDns=async()=>[{address:"93.184.216.34"}];
const request=(payload:Record<string,unknown>)=>({tool:"browser.render",action:"read",payload,projectId:"default",missionId:"m"} as any);
// A public-looking name that resolves to a private address is refused too.
await assert.rejects(createPageRenderAdapter({obscura:null,resolve:async()=>[{address:"192.168.1.10"}]}).execute(request({url:"https://intranet.example.com/"})),/Private or local/);

// Obscura failing (here: a program that is not Obscura exits with an error) falls back to Chromium, and says so.
let chromiumUsed=0;
const fakeBrowser={newContext:async()=>({newPage:async()=>({route:async()=>undefined,goto:async()=>undefined,title:async()=>"Shop",url:()=>"https://example.com/",evaluate:async()=>"Rendered by JavaScript: 3 products"}),close:async()=>undefined})};
const launch=async()=>{chromiumUsed++;return fakeBrowser;};
const fell=await createPageRenderAdapter({obscura:process.execPath,launchChromium:launch,resolve:publicDns}).execute(request({url:"https://example.com/"})) as any;
assert.equal(fell.engine,"chromium");assert.match(fell.fellBackFrom,/Obscura/);assert.match(fell.text,/3 products/);assert.equal(chromiumUsed,1);
// Not installed: Chromium directly; asking for Obscura alone says how to install it.
assert.equal((await createPageRenderAdapter({obscura:null,launchChromium:launch,resolve:publicDns}).execute(request({url:"https://example.com/"})) as any).engine,"chromium");
await assert.rejects(createPageRenderAdapter({obscura:null,launchChromium:launch,resolve:publicDns}).execute(request({url:"https://example.com/",engine:"obscura"})),/install-obscura/);

console.log("page-render: private targets refused, fixed Obscura command (no stealth), Chromium fallback reported");
