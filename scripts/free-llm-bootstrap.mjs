import {FREE_LLM_DIRECTORY,FREE_LLM_DIRECTORY_SOURCE,inspectFreeLlmDirectory} from "../dist/providers/free-llm-directory.js";

const ids=new Set();
for(const entry of FREE_LLM_DIRECTORY){
 if(!entry.providerId||!entry.keyEnv||!entry.keyUrl||!entry.baseUrl) throw new Error("Invalid free LLM directory entry.");
 if(ids.has(entry.providerId)) throw new Error("Duplicate free LLM provider id: "+entry.providerId);
 ids.add(entry.providerId);
 if(!/^https:\/\//.test(entry.keyUrl)||!/^https:\/\//.test(entry.baseUrl)) throw new Error("Invalid URL for "+entry.providerId);
 if(entry.apiKey) throw new Error("Embedded API secret detected for "+entry.providerId);
}
const entries=inspectFreeLlmDirectory();
console.log(JSON.stringify({
 source:FREE_LLM_DIRECTORY_SOURCE,
 providers:entries.map(entry=>({provider:entry.providerId,configured:entry.configured,keySource:entry.keySource,models:entry.models,keyUrl:entry.keyUrl}))
},null,2));
console.log("\nFree LLM bootstrap: "+entries.filter(x=>x.configured).length+"/"+entries.length+" providers configured.");
