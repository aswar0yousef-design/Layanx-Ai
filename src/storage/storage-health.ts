import type {Repository} from "./repository.js";
export class StorageHealth{
 async check<T extends {id:string}>(repo:Repository<T>){try{await repo.list();return{healthy:true,reason:"Storage readable."};}catch(error){return{healthy:false,reason:error instanceof Error?error.message:String(error)};}}
}
