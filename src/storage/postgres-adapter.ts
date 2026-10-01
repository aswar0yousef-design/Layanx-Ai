import {Pool,type PoolClient, type PoolConfig} from "pg";
import type {StorageAdapter,Transaction} from "./repository.js";

export class PostgresStorageAdapter implements StorageAdapter{
  private readonly pool:Pool;
  private initialized=false;

  constructor(config:PoolConfig|string){
    this.pool=new Pool(typeof config==="string"?{connectionString:config}:config);
  }

  private async ensureSchema(client:PoolClient):Promise<void>{
    if(this.initialized)return;
    await client.query(`CREATE TABLE IF NOT EXISTS layanx_runtime_kv (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    this.initialized=true;
  }

  async transaction<T>(work:(tx:Transaction)=>Promise<T>):Promise<T>{
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      await this.ensureSchema(client);
      let closed=false;
      const tx:Transaction={
        get:async<T>(key:string)=>{
          const result=await client.query<{value:T}>(
            "SELECT value FROM layanx_runtime_kv WHERE key=$1", [key]
          );
          return result.rows[0]?.value;
        },
        set:async<T>(key:string,value:T)=>{
          if(closed)throw new Error("Transaction is closed.");
          await client.query(
            "INSERT INTO layanx_runtime_kv(key,value,updated_at) VALUES($1,$2::jsonb,NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()",
            [key,JSON.stringify(value)]
          );
        },
        commit:async()=>{
          if(closed)return;
          await client.query("COMMIT");
          closed=true;
        },
        rollback:async()=>{
          if(closed)return;
          await client.query("ROLLBACK");
          closed=true;
        }
      };
      try{
        const result=await work(tx);
        if(!closed)await tx.commit();
        return result;
      }catch(error){
        await tx.rollback();
        throw error;
      }
    }finally{
      client.release();
    }
  }

  async health():Promise<{healthy:boolean;writable:boolean;reason:string}>{
    try{
      await this.transaction(async tx=>{
        const key="storage:health:probe";
        await tx.set(key,{checkedAt:new Date().toISOString()});
        await tx.get(key);
      });
      return{healthy:true,writable:true,reason:"PostgreSQL storage is readable and writable."};
    }catch(error){
      return{healthy:false,writable:false,reason:error instanceof Error?error.message:String(error)};
    }
  }

  async close():Promise<void>{await this.pool.end();}
}
