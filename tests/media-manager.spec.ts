import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {MediaManager} from "../src/business/media.js";

const dir=mkdtempSync(join(tmpdir(),"layanx-media-"));
process.env.LAYANX_MEDIA_STORAGE_PATH=join(dir,"media.json");
const original=globalThis.fetch;
globalThis.fetch=(async()=>new Response("",{status:200,headers:{"content-type":"image/jpeg","content-length":"1234"}})) as typeof fetch;
const m=new MediaManager();
const first=await m.inspect("https://cdn.example/item.jpg");
assert.equal(first.kind,"image");assert.equal(first.contentLength,1234);assert.equal(first.reachable,true);
const second=await m.inspect("https://cdn.example/item.jpg");assert.equal(second.url,first.url);assert.equal(m.snapshot().length,1);
await assert.rejects(()=>m.inspect("file:///tmp/item.jpg"),/media_url_must_be_http/);
globalThis.fetch=original;rmSync(dir,{recursive:true,force:true});
console.log("media manager validation: ok");
