import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {MemoryEngine} from "../src/core/memory.js";
import {searchTerms,normalizeText} from "../src/memory/text-normalize.js";
import {VectorStore} from "../src/memory/vector-store.js";
import {createOllamaEmbedder,embeddingModelFromEnv} from "../src/memory/embedder.js";
import {SqliteAdapter,chooseStorageKind,sqlitePathFor} from "../src/storage/sqlite-adapter.js";
import {RuntimeStorage} from "../src/storage/runtime-storage.js";

// 1. Arabic normalisation: hamza/alef forms, ta marbuta, diacritics, attached prefixes.
assert.equal(normalizeText("إصلاحُ الصفحةِ"),"اصلاح الصفحه");
assert.deepEqual(searchTerms("المشروع"),searchTerms("مشروع"));
assert.deepEqual(searchTerms("والصفحات"),searchTerms("الصفحة"));

const memory=new MemoryEngine();
const add=(summary:string,kind:"fact"|"decision"|"failure"|"success"="fact",projectId="shop")=>memory.remember({missionId:"m",projectId,kind,summary,content:{},confidence:1,tags:[]});
add("تم إصلاح صفحة الدفع في المتجر بعد خطأ في بوابة الدفع","success");
add("المستخدمون يفضلون الوضع الداكن");
add("Database uses PostgreSQL","decision");
add("صفحة الدفع في مشروع آخر","fact","other");

assert.equal(memory.recall("اصلاح صفحه الدفع",5,"shop")[0]?.summary.startsWith("تم إصلاح"),true,"different spelling still matches");
assert.equal(memory.recall("المستخدم",5,"shop").length,1,"prefix/suffix variants match");
assert.equal(memory.recall("ما هو حل مشكلة صفحة الدفع في المتجر",5,"shop")[0]?.kind,"success","long Arabic question with stopwords finds the fix");
assert.equal(memory.recall("صفحة الدفع",5,"shop").every(e=>e.projectId==="shop"),true,"project isolation kept");
assert.equal(memory.recall("postgres database",5,"shop").length,1,"English partial term matches");
assert.equal(memory.recall("kubernetes cluster",5,"shop").length,0,"unrelated query returns nothing");

// 2. Hybrid recall: an embedder adds meaning-based matches; failures fall back to lexical.
let calls=0;
const fakeEmbedder={model:"fake-embed",async embed(texts:string[]){calls++;return texts.map(t=>/داكن|dark|night|ليلي/i.test(t)?[1,0,0]:/دفع|payment|checkout/i.test(t)?[0,1,0]:[0,0,1]);}};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-mem-"));
const vectors=new VectorStore(path.join(dir,"memory-vectors.db"));
memory.setEmbedder(fakeEmbedder,vectors);
const semantic=await memory.recallAsync("night mode theme",5,"shop");
assert.equal(semantic[0]?.summary,"المستخدمون يفضلون الوضع الداكن","meaning match across languages");
assert.ok(vectors.get(semantic[0]!.id,"fake-embed"),"entry vectors are cached");
if(SqliteAdapter.available()){
  assert.equal(vectors.persistent(),true);
  const reopened=new VectorStore(path.join(dir,"memory-vectors.db"));
  assert.ok(reopened.get(semantic[0]!.id,"fake-embed"),"vectors survive a restart");
  reopened.close();
}
const before=calls;await memory.recallAsync("checkout",5,"shop");assert.ok(calls>before);
memory.setEmbedder({model:"broken",async embed(){throw new Error("ollama down");}});
assert.equal((await memory.recallAsync("اصلاح صفحه الدفع",5,"shop"))[0]?.kind,"success","embedding failure falls back to lexical");
assert.equal(memory.semanticEnabled(),false,"a failing embedder is paused");
vectors.close();

// 3. Embedder wiring from the local host's model plan.
assert.equal(embeddingModelFromEnv({LAYANX_OLLAMA_MODEL_PLAN:JSON.stringify({embedding:"nomic-embed-text"})}),"nomic-embed-text");
assert.equal(embeddingModelFromEnv({LAYANX_OLLAMA_MODEL_PLAN:JSON.stringify({embedding:"x"}),LAYANX_SEMANTIC_MEMORY:"off"}),undefined);
const sent:any[]=[];
const embedder=createOllamaEmbedder("nomic-embed-text",{fetcher:(async(url:string,init:any)=>{sent.push({url,body:JSON.parse(init.body)});return new Response(JSON.stringify({embeddings:[[0.1,0.2]]}),{status:200});}) as any});
assert.deepEqual(await embedder.embed(["hello"]),[[0.1,0.2]]);
assert.match(sent[0].url,/\/api\/embed$/);assert.equal(sent[0].body.model,"nomic-embed-text");

// 4. SQLite runtime storage: atomic transactions and one-time import of the old JSON store.
if(SqliteAdapter.available()){
  const json=path.join(dir,"runtime.json");
  fs.writeFileSync(json,JSON.stringify({"runtime:snapshots":{missions:[{id:"m1"}]},other:42}));
  assert.equal(chooseStorageKind({}),"sqlite");
  assert.equal(chooseStorageKind({LAYANX_STORAGE:"json"}),"json");
  const storage=RuntimeStorage.local(json,{});
  assert.deepEqual(await storage.get(),{missions:[{id:"m1"}]},"JSON state imported");
  await storage.set({missions:[{id:"m2"}]});
  assert.ok(fs.existsSync(sqlitePathFor(json)));
  const again=RuntimeStorage.local(json,{});
  assert.deepEqual(await again.get(),{missions:[{id:"m2"}]},"database wins over the old JSON after import");
  const adapter=new SqliteAdapter(path.join(dir,"tx.db"));
  await assert.rejects(adapter.transaction(async tx=>{await tx.set("k",1);throw new Error("boom");}),/boom/);
  assert.equal(await adapter.transaction(async tx=>tx.get("k")),undefined,"failed transaction leaves nothing behind");
  await adapter.transaction(async tx=>{await tx.set("k",{a:"عربي"});});
  assert.deepEqual(await adapter.transaction(async tx=>tx.get("k")),{a:"عربي"});
  adapter.close();
}else{
  assert.equal(chooseStorageKind({}),"json","no node:sqlite -> JSON store");
}
fs.rmSync(dir,{recursive:true,force:true});
console.log("memory-arabic-hybrid: Arabic recall, hybrid embeddings, vector cache and SQLite storage verified");
