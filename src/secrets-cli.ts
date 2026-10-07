/**
 *   npm run secrets -- list
 *   npm run secrets -- set OPENAI_API_KEY          (prompts without echo)
 *   npm run secrets -- delete OPENAI_API_KEY
 *   npm run secrets -- import .env                 (moves secret values out of .env)
 *   npm run secrets -- selftest                    (verifies DPAPI round-trip on Windows)
 */
import fs from "node:fs";
import path from "node:path";
import {resolveDataPaths} from "./platform/paths.js";
import {assertSecretName,openSecretStore} from "./security/secret-store.js";
import {parseDotEnv} from "./platform/dotenv.js";

const SECRET_LIKE=/(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)S?$/;

function readHidden(prompt:string):Promise<string>{
  return new Promise((resolve,reject)=>{
    const stdin=process.stdin;
    if(!stdin.isTTY){
      let data="";
      stdin.setEncoding("utf8").on("data",c=>{data+=c;}).on("end",()=>resolve(data.replace(/\r?\n$/,""))).on("error",reject);
      return;
    }
    process.stdout.write(prompt);
    let value="";
    stdin.setRawMode(true);stdin.resume();stdin.setEncoding("utf8");
    const onData=(chunk:string)=>{
      for(const ch of chunk){
        if(ch==="\r"||ch==="\n"){stdin.setRawMode(false);stdin.pause();stdin.off("data",onData);process.stdout.write("\n");resolve(value);return;}
        if(ch==="\u0003"){stdin.setRawMode(false);process.stdout.write("\n");process.exit(130);}
        if(ch==="\u007f"||ch==="\b"){value=value.slice(0,-1);continue;}
        value+=ch;
      }
    };
    stdin.on("data",onData);
  });
}

async function main(){
  const [command,arg]=process.argv.slice(2);
  const paths=resolveDataPaths();
  const store=await openSecretStore(paths.dataDir);
  switch(command){
    case "list":{
      console.log(`backend: ${store.backend}  file: ${store.location}`);
      for(const name of store.names())console.log("  "+name);
      if(!store.names().length)console.log("  (empty)");
      return;
    }
    case "set":{
      const name=assertSecretName(arg);
      const value=await readHidden(`${name}: `);
      await store.set(name,value);
      console.log(`saved ${name} (${store.backend}). Restart LayanX to apply.`);
      return;
    }
    case "delete":{
      const name=assertSecretName(arg);
      console.log((await store.delete(name))?`deleted ${name}`:`${name} was not stored`);
      return;
    }
    case "import":{
      const file=path.resolve(arg??".env");
      const text=fs.readFileSync(file,"utf8");
      const entries=parseDotEnv(text).filter(e=>SECRET_LIKE.test(e.key)&&e.value);
      const lines=text.split(/\r?\n/);
      for(const entry of entries){
        await store.set(entry.key,entry.value);
        lines[entry.line]=`${entry.key}=`;
        console.log(`moved ${entry.key} into the ${store.backend} store`);
      }
      fs.writeFileSync(file,lines.join(text.includes("\r\n")?"\r\n":"\n"));
      console.log(entries.length?`${entries.length} secret values removed from ${file}. Non-secret settings were left as they were.`:"No secret values found.");
      return;
    }
    case "selftest":{
      const probe="LAYANX_SELFTEST_PROBE";
      const value="probe-"+Date.now();
      await store.set(probe,value);
      const reopened=await openSecretStore(paths.dataDir);
      const ok=reopened.get(probe)===value;
      await reopened.delete(probe);
      console.log(ok?`OK: ${store.backend} round-trip works (${store.location})`:"FAILED: value did not survive a round-trip");
      process.exitCode=ok?0:1;
      return;
    }
    default:
      console.log("usage: npm run secrets -- list | set NAME | delete NAME | import [.env] | selftest");
      process.exitCode=command?1:0;
  }
}

main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exit(1);});
