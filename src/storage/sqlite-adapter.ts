import type {StorageAdapter,Transaction} from "./repository.js";
export class SqliteAdapter implements StorageAdapter{
 constructor(private readonly dbPath:string){}
 async transaction<T>(work:(tx:Transaction)=>Promise<T>):Promise<T>{
  const tx:Transaction={commit:async()=>{},rollback:async()=>{}};
  try{const result=await work(tx);await tx.commit();return result;}catch(error){await tx.rollback();throw error;}
 }
 path(){return this.dbPath;}
}
