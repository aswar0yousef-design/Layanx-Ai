import {inspectFreeLlmDirectory,FREE_LLM_DIRECTORY_SOURCE} from "../src/providers/free-llm-directory.js";

const entries=inspectFreeLlmDirectory();
console.log(JSON.stringify({
 source:FREE_LLM_DIRECTORY_SOURCE,
 providers:entries.map(entry=>({
  provider:entry.name,
  configured:entry.configured,
  keySource:entry.keySource,
  models:entry.models,
  keyUrl:entry.keyUrl
 }))
},null,2));

const configured=entries.filter(x=>x.configured).length;
console.log("\nFree LLM bootstrap: "+configured+"/"+entries.length+" providers configured.");
if(!configured)console.log("No free cloud key is configured; LayanX will continue using its local provider.");
