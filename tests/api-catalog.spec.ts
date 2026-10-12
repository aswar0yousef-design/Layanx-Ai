import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {PINNED_CATALOG,catalogUrl,cleanUrl,loadCatalog,parseCatalog,resetCatalogMemo,searchCatalog} from "../src/autonomy/api-catalog.js";

// The public-apis list as a catalog the agent searches when a project needs outside data.
const md=fs.readFileSync(new URL("./fixtures/public-apis-sample.md",import.meta.url),"utf8");
const entries=parseCatalog(md);

// 1. Parsing: the category tables only. The advertising sections are skipped, and so is the MCP servers
//    table: tool servers for LayanX come from mcp.registry.search (pinned packages, owner approval).
assert.deepEqual(entries.map(e=>[e.name,e.category]),[
  ["Frankfurter","Currency Exchange"],["1Forge","Currency Exchange"],["OldRates","Currency Exchange"],
  ["Open-Meteo","Weather"],["WeatherAPI","Weather"]],"no APILayer adverts, no MCP list, no javascript: links");
const fr=entries.find(e=>e.name==="Frankfurter")!;
assert.deepEqual({auth:fr.auth,https:fr.https,cors:fr.cors},{auth:"No",https:true,cors:"yes"});
assert.equal(entries.find(e=>e.name==="1Forge")!.auth,"apiKey","backticks removed");
assert.equal(entries.find(e=>e.name==="1Forge")!.url,"https://1forge.com/forex-data-api/api-documentation","tracking parameters dropped");
assert.equal(entries.find(e=>e.name==="OldRates")!.description,"Old exchange rates","HTML removed from descriptions");
assert.equal(cleanUrl("javascript:alert(1)"),"");

// 2. Search: Arabic words find the English entries; no-key, HTTPS and CORS filters.
assert.deepEqual(searchCatalog(entries,{query:"أسعار العملات للمتجر"}).map(e=>e.name),["Frankfurter","1Forge"],"HTTPS only by default; no-key first");
assert.deepEqual(searchCatalog(entries,{query:"exchange",auth:"none",https:false}).map(e=>e.name).sort(),["Frankfurter","OldRates"],"https:false also lists plain-HTTP APIs");
assert.deepEqual(searchCatalog(entries,{query:"حالة الطقس",auth:"none",cors:true}).map(e=>e.name),["Open-Meteo"]);
assert.equal(searchCatalog(entries,{query:"products mcp"}).length,0,"MCP servers are not in this catalog");
assert.deepEqual(searchCatalog(entries,{category:"weather"}).map(e=>e.name),["Open-Meteo","WeatherAPI"],"a whole category");
assert.equal(searchCatalog(entries,{query:"zzzz nothing"}).length,0);

// 3. Download: pinned commit, SHA-256 checked, cached; a changed file is refused and not cached.
assert.match(PINNED_CATALOG.commit,/^[0-9a-f]{40}$/);assert.match(PINNED_CATALOG.sha256,/^[0-9a-f]{64}$/);
assert.equal(catalogUrl(),`https://raw.githubusercontent.com/public-apis/public-apis/${PINNED_CATALOG.commit}/README.md`);
const store=fs.mkdtempSync(path.join(os.tmpdir(),"lx-catalog-"));const env={LAYANX_STORE_DIR:store};
const bytes=Buffer.from(md,"utf8");const pin={commit:"1".repeat(40),sha256:createHash("sha256").update(bytes).digest("hex")};
let calls=0;const fetcher=(async(url:string)=>{calls++;assert.ok(String(url).includes(pin.commit),"the pinned commit is downloaded");return new Response(bytes,{status:200});}) as unknown as typeof fetch;
await assert.rejects(loadCatalog(env,fetcher,{...pin,sha256:"0".repeat(64)}),/does not match its pinned SHA-256/);
assert.equal(fs.existsSync(path.join(store,"catalog")),false,"nothing cached from a mismatching download");
resetCatalogMemo();
assert.equal((await loadCatalog(env,fetcher,pin)).length,entries.length);
resetCatalogMemo();
assert.equal((await loadCatalog(env,fetcher,pin)).length,entries.length,"second load from the cache");
assert.equal(calls,2,"downloaded once (plus the refused attempt)");
// A cache written by the first version (it kept the MCP table) is parsed again, not reused.
const cacheFile=path.join(store,"catalog",`public-apis-${pin.commit.slice(0,12)}.json`);
fs.writeFileSync(cacheFile,JSON.stringify({commit:pin.commit,entries:[{kind:"mcp",name:"Old",url:"https://x",description:"",category:"MCP Servers",auth:"No"}]}));
resetCatalogMemo();
assert.deepEqual((await loadCatalog(env,fetcher,pin)).map(e=>e.name),entries.map(e=>e.name),"old cache format replaced");
assert.equal(calls,3);
await assert.rejects(loadCatalog({...env,LAYANX_API_CATALOG:"off"},fetcher,pin),/turned off/);
fs.rmSync(store,{recursive:true,force:true});
console.log("api-catalog: public-apis tables parsed, adverts and the MCP list skipped, Arabic search, filters, pinned SHA-256 download and cache");
