import {readFile} from "node:fs/promises";
import {readdir} from "node:fs/promises";
const roots=["src","tests","scripts","config"];
const forbidden=/(api[_ -]?key|secret[_ -]?key|private[_ -]?key|password)\s*[:=]\s*["'`][^"'`]{8,}["'`]/i;
let failures=[];
async function walk(dir){
 for(const entry of await readdir(dir,{withFileTypes:true})){
  const path=dir+"/"+entry.name;
  if(entry.isDirectory())await walk(path);
  else if(/\.(ts|tsx|js|mjs|json)$/.test(entry.name)){
   const text=await readFile(path,"utf8");
   if(forbidden.test(text))failures.push(path);
  }
 }
}
for(const root of roots)await walk(root);
if(failures.length){console.error("Potential secret material found:",failures.join(", "));process.exit(1);}
console.log("Static secret check passed.");
