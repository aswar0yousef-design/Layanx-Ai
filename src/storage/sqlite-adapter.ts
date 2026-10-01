import type {StorageAdapter,Transaction} from "./repository.js";

export class SqliteAdapter implements StorageAdapter{
  constructor(private readonly dbPath:string){}
  async transaction<T>(_work:(tx:Transaction)=>Promise<T>):Promise<T>{
    throw new Error("SQLite adapter is not configured yet. Use JsonStorageAdapter or install a supported SQLite driver.");
  }
  path(){return this.dbPath;}
  configured(){return false as const;}
}
