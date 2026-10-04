import {mkdir,rm} from "node:fs/promises";
import {dirname} from "node:path";
import {dirname} from "node:path";

export class FileLock{
  constructor(private readonly lockPath:string,private readonly retryMs=25,private readonly timeoutMs=5000){}
  async acquire():Promise<()=>Promise<void>>{
    const started=Date.now();
    await mkdir(dirname(this.lockPath),{recursive:true});
    while(true){
      try{
        await mkdir(this.lockPath);
        let released=false;
        return async()=>{if(released)return;released=true;await rm(this.lockPath,{recursive:true,force:true});};
      }catch(error){
        if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;
        if(Date.now()-started>=this.timeoutMs)throw new Error("Storage lock acquisition timed out.");
        await new Promise(resolve=>setTimeout(resolve,this.retryMs));
      }
    }
  }
}
