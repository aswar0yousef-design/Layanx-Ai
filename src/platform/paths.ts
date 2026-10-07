import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Every piece of state that belongs to ONE installation lives in a per-user
 * directory outside the Git checkout. Pulling a new version from GitHub never
 * touches it, and two people who download the same repo never share it.
 *
 *   Windows : %LOCALAPPDATA%\LayanX
 *   macOS   : ~/Library/Application Support/LayanX
 *   Linux   : $XDG_DATA_HOME/layanx (default ~/.local/share/layanx)
 *
 * LAYANX_DATA_DIR overrides the location (used by tests and portable installs).
 */
export interface DataPaths{
  dataDir:string;
  storeDir:string;
  logsDir:string;
  settingsFile:string;
  installFile:string;
  devicesFile:string;
  sessionsFile:string;
  launchTicketFile:string;
  pidFile:string;
  modelsCacheFile:string;
  logFile:string;
}

export function defaultDataDir(env:NodeJS.ProcessEnv=process.env,platform:NodeJS.Platform=process.platform):string{
  const override=env.LAYANX_DATA_DIR?.trim();
  if(override)return path.resolve(override);
  if(platform==="win32"){
    const base=env.LOCALAPPDATA?.trim()||path.join(os.homedir(),"AppData","Local");
    return path.win32.join(base,"LayanX");
  }
  if(platform==="darwin")return path.join(os.homedir(),"Library","Application Support","LayanX");
  const xdg=env.XDG_DATA_HOME?.trim()||path.join(os.homedir(),".local","share");
  return path.join(xdg,"layanx");
}

export function resolveDataPaths(env:NodeJS.ProcessEnv=process.env,platform:NodeJS.Platform=process.platform):DataPaths{
  const dataDir=defaultDataDir(env,platform);
  const paths:DataPaths={
    dataDir,
    storeDir:path.join(dataDir,"store"),
    logsDir:path.join(dataDir,"logs"),
    settingsFile:path.join(dataDir,"settings.json"),
    installFile:path.join(dataDir,"install.json"),
    devicesFile:path.join(dataDir,"devices.json"),
    sessionsFile:path.join(dataDir,"sessions.json"),
    launchTicketFile:path.join(dataDir,"launch-ticket.json"),
    pidFile:path.join(dataDir,"layanx.pid"),
    modelsCacheFile:path.join(dataDir,"ollama-models.json"),
    logFile:path.join(dataDir,"logs","layanx.log")
  };
  for(const dir of [paths.dataDir,paths.storeDir,paths.logsDir])fs.mkdirSync(dir,{recursive:true,mode:0o700});
  return paths;
}

/**
 * Point the existing runtime's file-based stores at the per-user directory,
 * unless the user already configured them explicitly.
 */
export function applyStorageDefaults(env:NodeJS.ProcessEnv,paths:DataPaths):string[]{
  const defaults:Record<string,string>={
    LAYANX_STORE_DIR:paths.storeDir,
    LAYANX_RUNTIME_STORAGE_PATH:path.join(paths.storeDir,"runtime.json"),
    LAYANX_BUSINESS_STORAGE_PATH:path.join(paths.storeDir,"business.json"),
    LAYANX_MEDIA_STORAGE_PATH:path.join(paths.storeDir,"media.json"),
    LAYANX_SECRET_VAULT_PATH:path.join(paths.storeDir,"secrets.vault"),
    LAYANX_FREE_POOL_CONFIG:path.join(paths.storeDir,"free-providers.json"),
    LAYANX_GOOGLE_INVOICE_REGISTRY:path.join(paths.storeDir,"google-invoices.json"),
    LAYANX_CREATOR_OUTPUT_DIR:path.join(paths.storeDir,"creator"),
    LAYANX_QURAN_OUTPUT_DIR:path.join(paths.storeDir,"quran")
  };
  const applied:string[]=[];
  for(const [key,value] of Object.entries(defaults)){
    if(!env[key]?.trim()){env[key]=value;applied.push(key);}
  }
  return applied;
}

/**
 * One-time copy of the old repo-relative `.layanx/` folder into the per-user
 * store. Existing files in the store are never overwritten and the legacy
 * folder is left in place (it is git-ignored) so nothing is lost.
 */
export function migrateLegacyStore(legacyDir:string,paths:DataPaths):boolean{
  const marker=path.join(paths.dataDir,".legacy-migrated");
  if(fs.existsSync(marker)||!fs.existsSync(legacyDir))return false;
  fs.cpSync(legacyDir,paths.storeDir,{recursive:true,force:false,errorOnExist:false});
  fs.writeFileSync(marker,new Date().toISOString());
  return true;
}

/** Write a file atomically (temp file + rename) with owner-only permissions where supported. */
export function writeFileAtomic(file:string,data:string|Buffer):void{
  const tmp=file+".tmp-"+process.pid+"-"+Math.random().toString(36).slice(2);
  fs.writeFileSync(tmp,data,{mode:0o600});
  let lastError:unknown;
  for(let attempt=0;attempt<5;attempt++){
    try{fs.renameSync(tmp,file);return;}
    catch(error){
      lastError=error;
      // Windows: antivirus / indexer can briefly lock the destination.
      const code=(error as NodeJS.ErrnoException).code;
      if(code!=="EPERM"&&code!=="EBUSY"&&code!=="EACCES")break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50*(attempt+1));
    }
  }
  try{fs.unlinkSync(tmp);}catch{}
  throw lastError;
}

export function readJsonFile<T>(file:string,fallback:T):T{
  try{return JSON.parse(fs.readFileSync(file,"utf8")) as T;}
  catch{return fallback;}
}
