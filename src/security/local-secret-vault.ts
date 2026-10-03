import {createCipheriv,createDecipheriv,randomBytes,scryptSync} from "node:crypto";
import {existsSync,readFileSync,mkdirSync,writeFileSync,renameSync,chmodSync} from "node:fs";
import {dirname,join} from "node:path";
import {homedir} from "node:os";

interface VaultEntry{iv:string;tag:string;ciphertext:string;updatedAt:string;}
interface VaultFile{version:1;salt:string;entries:Record<string,VaultEntry>;}

export class LocalSecretVault{
 private readonly path:string;
 private readonly key:Buffer;
 constructor(path=process.env.LAYANX_SECRET_VAULT_PATH??join(homedir(),".layanx","secrets.vault"),masterKey=process.env.LAYANX_SECRET_VAULT_KEY){
  if(!masterKey||masterKey.length<16)throw new Error("LAYANX_SECRET_VAULT_KEY must be at least 16 characters and must remain local.");
  this.path=path;
  const salt=this.readSalt()??randomBytes(16).toString("base64");
  this.key=scryptSync(masterKey,salt,32);
  if(!this.readFile())this.writeFile({version:1,salt,entries:{}});
 }
 private readFile():VaultFile|undefined{
  try{if(!existsSync(this.path))return undefined;return JSON.parse(readFileSync(this.path,"utf8")) as VaultFile;}catch{throw new Error("secret_vault_corrupt");}
 }
 private readSalt(){return this.readFile()?.salt;}
 private writeFile(file:VaultFile){
  mkdirSync(dirname(this.path),{recursive:true});
  const tmp=this.path+".tmp";
  writeFileSync(tmp,JSON.stringify(file,null,2),{encoding:"utf8",mode:0o600});
  chmodSync(tmp,0o600);renameSync(tmp,this.path);chmodSync(this.path,0o600);
 }
 private file(){const file=this.readFile();if(!file)throw new Error("secret_vault_missing");if(file.version!==1)throw new Error("secret_vault_version_unsupported");return file;}
 set(name:string,value:string){
  if(!name.trim())throw new Error("secret_name_required");
  const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",this.key,iv);
  const ciphertext=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
  const file=this.file();
  file.entries[name]={iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),ciphertext:ciphertext.toString("base64"),updatedAt:new Date().toISOString()};
  this.writeFile(file);
 }
 get(name:string):string|undefined{
  const entry=this.file().entries[name];if(!entry)return undefined;
  try{const decipher=createDecipheriv("aes-256-gcm",this.key,Buffer.from(entry.iv,"base64"));decipher.setAuthTag(Buffer.from(entry.tag,"base64"));return Buffer.concat([decipher.update(Buffer.from(entry.ciphertext,"base64")),decipher.final()]).toString("utf8");}catch{throw new Error("secret_vault_decryption_failed");}
 }
 has(name:string){return this.get(name)!==undefined;}
 delete(name:string){const file=this.file();if(name in file.entries){delete file.entries[name];this.writeFile(file);return true;}return false;}
 names(){return Object.keys(this.file().entries);}
}

export function localSecret(name:string,fallback?:string){
 try{const vault=new LocalSecretVault();return vault.get(name)??fallback;}catch(error){
  if(error instanceof Error&&["LAYANX_SECRET_VAULT_KEY must be at least 16 characters and must remain local.","secret_vault_corrupt","secret_vault_decryption_failed"].includes(error.message))throw error;
  return fallback;
 }
}
