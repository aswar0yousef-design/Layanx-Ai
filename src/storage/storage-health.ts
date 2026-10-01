import type {StorageAdapter} from "./repository.js";
import {MigrationRunner,type MigrationContext} from "./migrations.js";

export interface StorageHealthResult{
  healthy:boolean;
  writable:boolean;
  schemaVersion:number;
  reason:string;
}

export class StorageHealth{
  async check(storage:StorageAdapter,versionKey="storage:schemaVersion"):Promise<StorageHealthResult>{
    try{
      let writable=false;
      const context:MigrationContext={
        get:<T>(key:string)=>storage.transaction(async tx=>tx.get<T>(key)),
        set:<T>(key:string,value:T)=>storage.transaction(async tx=>{await tx.set(key,value);})
      };
      const before=await context.get<number>(versionKey)??0;
      const probeKey="storage:health:probe";
      await context.set(probeKey,new Date().toISOString());
      writable=true;
      return{healthy:true,writable,schemaVersion:before,reason:"Storage is readable and writable."};
    }catch(error){
      return{healthy:false,writable:false,schemaVersion:0,reason:error instanceof Error?error.message:String(error)};
    }
  }

  async migrate(storage:StorageAdapter,migrations:MigrationRunner):Promise<number>{
    const context:MigrationContext={
      get:<T>(key:string)=>storage.transaction(async tx=>tx.get<T>(key)),
      set:<T>(key:string,value:T)=>storage.transaction(async tx=>{await tx.set(key,value);})
    };
    const current=await context.get<number>("storage:schemaVersion")??0;
    const runner=new MigrationRunner(
      await migrations.plan().then(plan=>plan),
      current
    );
    return runner.run(context);
  }
}
