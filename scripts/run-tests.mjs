import {readdir} from "node:fs/promises";
import {join} from "node:path";
import {spawn} from "node:child_process";
import process from "node:process";

const root=process.cwd();
const testsDir=join(root,"tests");
const entries=await readdir(testsDir,{withFileTypes:true});
const files=entries.filter(e=>e.isFile()&&e.name.endsWith(".spec.ts")).map(e=>join(testsDir,e.name)).sort();
if(files.length===0){console.error("No test files found in tests/.");process.exit(1);}
console.log(`Discovered ${files.length} test files.`);
const tsx=process.platform==="win32"?join(root,"node_modules",".bin","tsx.cmd"):join(root,"node_modules",".bin","tsx");
let passed=0;
let failed=0;
for(const file of files){
  const rel=file.slice(root.length+1);
  process.stdout.write(`\n=== ${rel} ===\n`);
  const code=await new Promise(resolve=>{
    const child=spawn(tsx,[file],{cwd:root,env:process.env,stdio:"inherit",shell:false});
    child.on("error",()=>resolve(127));
    child.on("exit",c=>resolve(c??1));
  });
  if(code===0)passed++; else {failed++;console.error(`FAILED: ${rel} (exit ${code})`);}
}
console.log(`\nTest summary: ${passed} passed, ${failed} failed, ${files.length} total.`);
if(failed>0)process.exit(1);
