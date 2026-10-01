import {mkdir,open,readFile,rename} from "node:fs/promises";
import {dirname} from "node:path";

export interface PersistedState<T>{version:number;updatedAt:string;data:T;}

export class JsonStateStore<T>{
  constructor(private readonly path:string,private readonly version=1){}
  lockPath():string{return this.path+".lock";}

  async load():Promise<T|undefined>{
    try{
      const raw=await readFile(this.path,"utf8");
      const state=JSON.parse(raw) as PersistedState<T>;
      if(state.version!==this.version)throw new Error("Unsupported state version.");
      return state.data;
    }catch(error){
      if((error as NodeJS.ErrnoException).code==="ENOENT")return undefined;
      throw error;
    }
  }

  async save(data:T):Promise<void>{
    const directory=dirname(this.path);
    await mkdir(directory,{recursive:true});
    const temp=this.path+`.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload=JSON.stringify({version:this.version,updatedAt:new Date().toISOString(),data},null,2);
    const handle=await open(temp,"wx",0o600);
    try{
      await handle.writeFile(payload,"utf8");
      await handle.sync();
    }finally{
      await handle.close();
    }
    try{
      await rename(temp,this.path);
      const directoryHandle=await open(directory,"r");
      try{await directoryHandle.sync();}finally{await directoryHandle.close();}
    }catch(error){
      try{await (await import("node:fs/promises")).rm(temp,{force:true});}catch{}
      throw error;
    }
  }
}
