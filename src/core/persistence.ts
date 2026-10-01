import {mkdir,readFile,rename,writeFile} from "node:fs/promises";
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
    await mkdir(dirname(this.path),{recursive:true});
    const temp=this.path+".tmp";
    await writeFile(temp,JSON.stringify({version:this.version,updatedAt:new Date().toISOString(),data},null,2),"utf8");
    await rename(temp,this.path);
  }
}
