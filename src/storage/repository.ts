export interface Repository<T extends {id:string}>{get(id:string):Promise<T|undefined>;list():Promise<T[]>;upsert(value:T):Promise<void>;remove(id:string):Promise<void>;}
export interface Transaction{
  commit():Promise<void>;
  rollback():Promise<void>;
  get<T>(key:string):Promise<T|undefined>;
  set<T>(key:string,value:T):Promise<void>;
}
export interface StorageAdapter{
  transaction<T>(work:(tx:Transaction)=>Promise<T>):Promise<T>;
}
