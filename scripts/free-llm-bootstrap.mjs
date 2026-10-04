import {readFileSync} from "node:fs";

const path="config/free-llm-providers.json";
const catalog=JSON.parse(readFileSync(path,"utf8"));
if(!catalog || !Array.isArray(catalog.providers)) throw new Error("Free LLM catalog is missing providers.");
const ids=new Set();
for(const entry of catalog.providers){
 if(!entry.id||!entry.env||!entry.keyUrl) throw new Error("Invalid free LLM catalog entry.");
 if(ids.has(entry.id)) throw new Error("Duplicate free LLM provider id: "+entry.id);
 ids.add(entry.id);
 if(!/^https:\/\//.test(entry.keyUrl)) throw new Error("Invalid key URL for "+entry.id);
}
const providers=catalog.providers.map(entry=>({
 provider:entry.id,
 configured:Boolean(process.env[entry.env]),
 keySource:process.env[entry.env]?"env":"none",
 keyUrl:entry.keyUrl
}));
console.log(JSON.stringify({source:catalog.source,providers},null,2));
console.log("\nFree LLM bootstrap catalog: "+providers.filter(x=>x.configured).length+"/"+providers.length+" providers configured.");
