import {execFileSync} from "node:child_process";
import {mkdtempSync,writeFileSync,mkdirSync,cpSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const root=process.cwd();
const temp=mkdtempSync(join(tmpdir(),"layanx-bootstrap-"));
mkdirSync(join(temp,"scripts"),{recursive:true});
cpSync(join(root,"scripts","bootstrap.mjs"),join(temp,"scripts","bootstrap.mjs"));
writeFileSync(join(temp,"package.json"),JSON.stringify({name:"fixture",scripts:{build:"node -e \"process.exit(0)\"",layanx:"node -e \"process.exit(0)\""}},null,2));
writeFileSync(join(temp,".env.example"),"LAYANX_AI_MODE=local\n");
const result=execFileSync(process.execPath,[join(temp,"scripts","bootstrap.mjs"),"--skip-install"],{cwd:temp,encoding:"utf8"});
if(!result.includes("Bootstrap completed."))throw new Error("Bootstrap did not complete.");
const env=readFileSync(join(temp,".env"),"utf8");
if(env!=="LAYANX_AI_MODE=local\n")throw new Error("Bootstrap did not create .env safely.");
console.log("Bootstrap installer test passed.");
