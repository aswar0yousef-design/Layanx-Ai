import type {StorageAdapter,Transaction} from "./repository.js";
import {JsonStorageAdapter} from "./json-adapter.js";

export interface RuntimeStorageKeys{
  snapshot:string;
}

export class RuntimeStorage{
  constructor(private readonly storage:StorageAdapter,private readonly keys:RuntimeStorageKeys={snapshot:"runtime:snapshots"}){}

  async get<T>(key=this.keys.snapshot):Promise<T|undefined>{
    return this.storage.transaction(async tx=>tx.get<T>(key));
  }

  async set<T>(value:T,key=this.keys.snapshot):Promise<void>{
    await this.storage.transaction(async tx=>{await tx.set(key,value);});
  }

  static json(path:string):RuntimeStorage{
    return new RuntimeStorage(new JsonStorageAdapter(path));
  }
}
