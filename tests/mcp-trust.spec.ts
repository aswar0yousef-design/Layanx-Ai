import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {publisherOf,searchRegistry,trustOf} from "../src/mcp/manager.js";

// The publisher is the namespace the registry verified: a GitHub account or a domain.
assert.equal(publisherOf("io.github.microsoft/playwright-mcp"),"github.com/microsoft");
assert.equal(publisherOf("com.pulsemcp/playwright-stealth"),"pulsemcp.com");

const entry=(name:string,args:string[],secrets:string[]=[])=>({name,description:"",version:"1",secrets,suggested:{id:"x",name,transport:"stdio" as const,command:"npx",args,source:{package:args[0]!.replace(/@[^@]*$/,"")}}});
assert.equal(trustOf(entry("io.github.big/one",["big@1.0.0"]),2_000_000).level,"high");
assert.equal(trustOf(entry("io.github.mid/one",["mid@1.0.0"]),900).level,"medium");
const few=trustOf(entry("io.github.few/one",["few@1.0.0"],["API_KEY"]),40);
assert.equal(few.level,"low");
assert.deepEqual(few.warnings,["needs-keys","few-users"]);
// No exact version: low, whatever its popularity, and the panel offers no Add button.
const unpinned=trustOf(entry("io.github.bytedance/fs",["fs@latest"]),99_999);
assert.equal(unpinned.level,"low");
assert.ok(!unpinned.pinned&&unpinned.warnings.includes("no-exact-version"));
// Download counts that cannot be read are unknown, not zero.
assert.equal(trustOf(entry("io.github.x/y",["y@1.0.0"]),null).level,"low");

// Search ranks by trust, not by name: the well-known server comes first even when the registry lists it last.
const registry={servers:[
  {server:{name:"io.github.aaa/tiny",version:"1.0.0",packages:[{registryType:"npm",identifier:"tiny-mcp",version:"1.0.0",transport:{type:"stdio"}}]}},
  {server:{name:"io.github.bbb/latest-only",version:"1.0.0",packages:[{registryType:"npm",identifier:"latest-mcp",version:"latest",transport:{type:"stdio"}}]}},
  {server:{name:"io.github.zzz/popular",version:"2.0.0",packages:[{registryType:"npm",identifier:"popular-mcp",version:"2.0.0",transport:{type:"stdio"}}]}}
]};
const downloads:Record<string,number>={"tiny-mcp":12,"latest-mcp":500_000,"popular-mcp":3_000_000};
const asked:string[]=[];
const fetcher=(async(url:URL|string)=>{
  const u=String(url);asked.push(u);
  if(u.includes("registry"))return new Response(JSON.stringify(registry),{status:200});
  const pkg=u.split("/last-week/")[1]!;
  return downloads[pkg]===undefined?new Response("",{status:404}):new Response(JSON.stringify({downloads:downloads[pkg]}),{status:200});
}) as typeof fetch;
const ranked=await searchRegistry("anything",{fetcher,limit:3});
assert.deepEqual(ranked.map(r=>r.name),["io.github.zzz/popular","io.github.aaa/tiny","io.github.bbb/latest-only"]);
assert.equal(ranked[0]!.trust!.weeklyDownloads,3_000_000);
assert.ok(asked[0]!.includes("limit=9"),"a wider pool is fetched than shown, so ranking can lift a good server");
// Without ranking, the registry's own order and no extra requests.
asked.length=0;
assert.deepEqual((await searchRegistry("anything",{fetcher,limit:3,trust:false})).map(r=>r.name),["io.github.aaa/tiny","io.github.bbb/latest-only","io.github.zzz/popular"]);
assert.equal(asked.length,1);

// The panel shows the trust level and offers Add only for an exact version.
const app=await readFile(fileURLToPath(new URL("../web/app.js",import.meta.url)),"utf8");
assert.match(app,/t\("mcpTrust_"\+x\.trust\.level\)/);
assert.match(app,/x\.suggested&&\(!x\.trust\|\|x\.trust\.pinned\)/);
assert.match(app,/mcpTrust_high:"موثوق"/);

console.log("mcp-trust: registry results ranked by publisher, exact version and installs; unpinned servers are never offered");
