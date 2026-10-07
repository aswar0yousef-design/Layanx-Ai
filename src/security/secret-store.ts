import {spawn} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {writeFileAtomic} from "../platform/paths.js";
import {safeChildEnv} from "../platform/safe-env.js";

/**
 * Secrets stay on this computer, encrypted for the current OS user.
 *
 * Windows (default): DPAPI with CurrentUser scope. The encryption key is
 *   derived from the user's Windows logon credentials, so the file is useless
 *   if copied to another machine or opened by another Windows account. No
 *   master key is stored anywhere on disk or in .env.
 * Other OSes: AES-256-GCM with a random key file (mode 0600) next to it.
 *
 * Nothing is sent over the network. Values are never logged or returned by
 * the setup API (names only).
 */
export type SecretBackend="dpapi"|"file";
export type PowerShellRunner=(script:string,stdin:string)=>Promise<string>;

export interface SecretStore{
  readonly backend:SecretBackend;
  readonly location:string;
  names():string[];
  get(name:string):string|undefined;
  set(name:string,value:string):Promise<void>;
  delete(name:string):Promise<boolean>;
}

const NAME=/^[A-Z][A-Z0-9_]{1,63}$/;
const MAX_VALUE=16*1024;
const DPAPI_ENTROPY="LayanX.SecretStore.v1";

export function assertSecretName(name:unknown):string{
  if(typeof name!=="string"||!NAME.test(name))throw new Error("Secret names use UPPER_CASE letters, digits and _ (2-64 chars).");
  return name;
}
function assertSecretValue(value:unknown):string{
  if(typeof value!=="string"||value.length===0||value.length>MAX_VALUE)throw new Error("Secret value must be a non-empty string up to 16 KB.");
  return value;
}

function dpapiScript(op:"Protect"|"Unprotect"):string{
  return [
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName System.Security",
    "$raw=[Console]::In.ReadToEnd().Trim()",
    "$bytes=[Convert]::FromBase64String($raw)",
    `$entropy=[Text.Encoding]::UTF8.GetBytes('${DPAPI_ENTROPY}')`,
    `$out=[Security.Cryptography.ProtectedData]::${op}($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)`,
    "[Console]::Out.Write([Convert]::ToBase64String($out))"
  ].join("\n");
}

/** Runs Windows PowerShell by absolute path (no PATH hijacking); data travels on stdin, never argv. */
export const runWindowsPowerShell:PowerShellRunner=(script,stdin)=>new Promise((resolve,reject)=>{
  const systemRoot=process.env.SystemRoot??process.env.SYSTEMROOT??"C:\\Windows";
  const exe=path.win32.join(systemRoot,"System32","WindowsPowerShell","v1.0","powershell.exe");
  const encoded=Buffer.from(script,"utf16le").toString("base64");
  const child=spawn(fs.existsSync(exe)?exe:"powershell.exe",
    ["-NoLogo","-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-InputFormat","None","-EncodedCommand",encoded],
    {shell:false,windowsHide:true,stdio:["pipe","pipe","pipe"],env:safeChildEnv()});
  let out="",err="";
  const timer=setTimeout(()=>{child.kill();reject(new Error("PowerShell DPAPI call timed out."));},30_000);
  child.stdout.setEncoding("utf8").on("data",(c:string)=>{out+=c;});
  child.stderr.setEncoding("utf8").on("data",(c:string)=>{err+=c;});
  child.on("error",error=>{clearTimeout(timer);reject(error);});
  child.on("close",code=>{
    clearTimeout(timer);
    if(code===0&&out.trim())resolve(out.trim());
    else reject(new Error("DPAPI operation failed"+(err.trim()?": "+err.trim().slice(0,300):".")));
  });
  child.stdin.end(stdin);
});

interface Payload{v:1;secrets:Record<string,string>}

abstract class BaseStore implements SecretStore{
  abstract readonly backend:SecretBackend;
  readonly location:string;
  protected data:Record<string,string>={};
  private chain:Promise<void>=Promise.resolve();
  constructor(location:string){this.location=location;}
  names(){return Object.keys(this.data).sort();}
  get(name:string){return Object.prototype.hasOwnProperty.call(this.data,name)?this.data[name]:undefined;}
  async set(name:string,value:string){
    assertSecretName(name);assertSecretValue(value);
    await this.enqueue(()=>{this.data[name]=value;});
  }
  async delete(name:string){
    assertSecretName(name);
    if(!(name in this.data))return false;
    await this.enqueue(()=>{delete this.data[name];});
    return true;
  }
  private enqueue(mutate:()=>void):Promise<void>{
    const next=this.chain.then(async()=>{mutate();await this.persist({v:1,secrets:this.data});});
    this.chain=next.catch(()=>undefined);
    return next;
  }
  protected abstract persist(payload:Payload):Promise<void>;
}

class DpapiStore extends BaseStore{
  readonly backend="dpapi" as const;
  private readonly run:PowerShellRunner;
  constructor(location:string,run:PowerShellRunner){super(location);this.run=run;}
  async load(){
    if(!fs.existsSync(this.location))return;
    const blob=fs.readFileSync(this.location,"utf8").trim();
    if(!blob)return;
    const plain=Buffer.from(await this.run(dpapiScript("Unprotect"),blob),"base64").toString("utf8");
    const payload=JSON.parse(plain) as Payload;
    this.data={...payload.secrets};
  }
  protected async persist(payload:Payload){
    const plain=Buffer.from(JSON.stringify(payload),"utf8").toString("base64");
    writeFileAtomic(this.location,await this.run(dpapiScript("Protect"),plain));
  }
}

class FileStore extends BaseStore{
  readonly backend="file" as const;
  private key!:Buffer;
  load(){
    const keyFile=this.location+".key";
    if(!fs.existsSync(keyFile)){
      try{fs.writeFileSync(keyFile,crypto.randomBytes(32).toString("base64"),{mode:0o600,flag:"wx"});}
      catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;}
    }
    this.key=Buffer.from(fs.readFileSync(keyFile,"utf8").trim(),"base64");
    if(this.key.length!==32)throw new Error("Secret key file is corrupted: "+keyFile);
    if(!fs.existsSync(this.location))return;
    const box=JSON.parse(fs.readFileSync(this.location,"utf8")) as {iv:string;tag:string;data:string};
    const decipher=crypto.createDecipheriv("aes-256-gcm",this.key,Buffer.from(box.iv,"base64"));
    decipher.setAuthTag(Buffer.from(box.tag,"base64"));
    const plain=Buffer.concat([decipher.update(Buffer.from(box.data,"base64")),decipher.final()]).toString("utf8");
    this.data={...(JSON.parse(plain) as Payload).secrets};
  }
  protected async persist(payload:Payload){
    const iv=crypto.randomBytes(12);
    const cipher=crypto.createCipheriv("aes-256-gcm",this.key,iv);
    const data=Buffer.concat([cipher.update(JSON.stringify(payload),"utf8"),cipher.final()]);
    writeFileAtomic(this.location,JSON.stringify({v:1,alg:"aes-256-gcm",iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),data:data.toString("base64")}));
  }
}

export interface OpenSecretStoreOptions{
  backend?:SecretBackend;
  platform?:NodeJS.Platform;
  powershell?:PowerShellRunner;
}

/**
 * On Windows the store FAILS CLOSED: if DPAPI is unavailable we stop with a
 * clear error instead of silently downgrading to a weaker format. Set
 * LAYANX_SECRET_BACKEND=file to opt into the fallback explicitly.
 */
export async function openSecretStore(dir:string,options:OpenSecretStoreOptions={}):Promise<SecretStore>{
  const platform=options.platform??process.platform;
  const requested=(options.backend??process.env.LAYANX_SECRET_BACKEND) as SecretBackend|undefined;
  const backend:SecretBackend=requested==="file"||requested==="dpapi"?requested:platform==="win32"?"dpapi":"file";
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  if(backend==="dpapi"){
    const store=new DpapiStore(path.join(dir,"secrets.dpapi"),options.powershell??runWindowsPowerShell);
    await store.load();
    return store;
  }
  const store=new FileStore(path.join(dir,"secrets.enc"));
  store.load();
  return store;
}

/** Copy stored secrets into an env object without overriding values the user set explicitly. */
export function applySecretsToEnv(store:SecretStore,env:NodeJS.ProcessEnv):string[]{
  const applied:string[]=[];
  for(const name of store.names()){
    if(env[name]!==undefined&&env[name]!=="")continue;
    const value=store.get(name);
    if(value!==undefined){env[name]=value;applied.push(name);}
  }
  return applied;
}

/** Generate a random secret once and keep it in the store (API token, vault key...). */
export async function ensureGeneratedSecret(store:SecretStore,name:string,prefix=""):Promise<string>{
  const existing=store.get(name);
  if(existing)return existing;
  const value=prefix+crypto.randomBytes(32).toString("base64url");
  await store.set(name,value);
  return value;
}
