import {mkdir,readFile,writeFile} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import {hostname,platform} from "node:os";
import {join} from "node:path";

let cached:string|undefined;

function filePath(){
  const root=process.env.LAYANX_DATA_DIR?.trim()||".layanx";
  return join(root,"device-id");
}

export async function getDeviceId():Promise<string>{
  if(cached)return cached;
  const configured=process.env.LAYANX_DEVICE_ID?.trim();
  if(configured){
    cached=configured;
    return cached;
  }
  const path=filePath();
  try{
    const value=(await readFile(path,"utf8")).trim();
    if(value){cached=value;return value;}
  }catch{}
  const seed=`${hostname()}|${platform()}|${randomUUID()}`;
  const id=`LYX-${createHash("sha256").update(seed).digest("hex").slice(0,16).toUpperCase()}`;
  await mkdir(join(path,".."),{recursive:true});
  await writeFile(path,id,{encoding:"utf8",mode:0o600});
  cached=id;
  return id;
}

export async function deviceIdentity(){
  return {
    deviceId:await getDeviceId(),
    name:process.env.LAYANX_DEVICE_NAME?.trim()||hostname(),
    platform,
    apiVersion:"v1",
  };
}
