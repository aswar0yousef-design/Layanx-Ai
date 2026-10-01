#!/usr/bin/env node
import {existsSync,copyFileSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {platform} from "node:os";

const root=process.cwd();
const args=new Set(process.argv.slice(2));
const envFile=root+"/.env";
const envExample=root+"/.env.example";
const packageFile=root+"/package.json";

function run(command,args=[]){return execFileSync(command,args,{cwd:root,stdio:"inherit",shell:platform()==="win32"});}
function check(command,args=[]){try{execFileSync(command,args,{cwd:root,stdio:"ignore",shell:platform()==="win32"});return true;}catch{return false;}}

console.log("LayanX AI Bootstrap");
console.log("===================");

if(!existsSync(packageFile)){console.error("Run this bootstrap from the LayanX repository root.");process.exit(1);}
if(!check("node",["--version"])){console.error("Node.js is required.");process.exit(1);}
const nodeVersion=process.versions.node.split(".").map(Number);
if(nodeVersion[0]<22){console.error("Node.js 22 or newer is required.");process.exit(1);}
console.log("Node.js:",process.versions.node);

if(!existsSync(envFile)){
 if(!existsSync(envExample)){console.error(".env.example is missing.");process.exit(1);}
 copyFileSync(envExample,envFile);
 console.log("Created .env from .env.example.");
}else console.log(".env already exists; keeping it unchanged.");

if(!args.has("--skip-install")){
 console.log("Installing dependencies...");
 run(process.platform==="win32"?"npm.cmd":"npm",["install"]);
}

console.log("Building LayanX...");
run(process.platform==="win32"?"npm.cmd":"npm",["run","build"]);

console.log("Checking runtime configuration...");
run(process.platform==="win32"?"npm.cmd":"npm",["run","layanx","--","check"]);

console.log("Checking local provider setup...");
try{run(process.platform==="win32"?"npm.cmd":"npm",["run","doctor"]);}catch{console.log("Provider doctor reported a setup warning. Continue with 'npm run doctor' after Ollama is installed.");}

if(args.has("--pull-ollama-model")){
 console.log("Explicit model download requested.");
 if(!check("ollama",["--version"])){console.error("Ollama executable was not found; install Ollama first.");process.exit(2);}
 const model=process.env.OLLAMA_MODEL??"llama3.2:3b";
 run("ollama",["pull",model]);
}

console.log("Bootstrap completed.");
console.log("Next: npm run layanx -- health");
