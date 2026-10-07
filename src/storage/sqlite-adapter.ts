import fs from "node:fs";
import path from "node:path";
import type {StorageAdapter,Transaction} from "./repository.js";
import {loadSqlite,openSqlite,type SqliteDatabase} from "./node-sqlite.js";

/**
 * Key-value runtime storage on Node's built-in SQLite (WAL journal: a crash or power cut
 * never leaves a half-written state file). Same transaction contract as JsonStorageAdapter:
 * writes are staged and applied atomically on commit.
 */
export class SqliteAdapter implements StorageAdapter{
  private db:SqliteDatabase|null=null;
  constructor(private readonly dbPath:string){}

  static available(env:NodeJS.ProcessEnv=process.env):boolean{return loadSqlite(env)!==null;}

  private open():SqliteDatabase{
    if(this.db)return this.db;
    fs.mkdirSync(path.dirname(path.resolve(this.dbPath)),{recursive:true});
    const db=openSqlite(this.dbPath);
    if(!db)throw new Error("SQLite is not available in this Node.js build (needs Node 22.13+). Use the JSON store.");
    db.exec("CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)");
    this.db=db;
    return db;
  }

  async transaction<T>(work:(tx:Transaction)=>Promise<T>):Promise<T>{
    // The database is opened per transaction and closed afterwards: no file handle stays open,
    // so Windows can back up, move or delete the data folder while LayanX is idle.
    const db=this.open();
    try{return await this.run(db,work);}finally{this.close();}
  }

  private async run<T>(db:SqliteDatabase,work:(tx:Transaction)=>Promise<T>):Promise<T>{
    const staged=new Map<string,unknown>();
    let closed=false;
    const read=(key:string)=>{const row=db.prepare("SELECT value FROM kv WHERE key=?").get(key) as {value?:string}|undefined;return row?.value===undefined?undefined:JSON.parse(row.value) as unknown;};
    const tx:Transaction={
      get:async<T>(key:string)=>structuredClone(staged.has(key)?staged.get(key):read(key)) as T|undefined,
      set:async<T>(key:string,value:T)=>{if(closed)throw new Error("Transaction is closed.");staged.set(key,structuredClone(value));},
      commit:async()=>{
        if(closed)return;
        const now=new Date().toISOString();
        db.exec("BEGIN IMMEDIATE");
        try{
          const upsert=db.prepare("INSERT INTO kv(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at");
          for(const [key,value] of staged)upsert.run(key,JSON.stringify(value),now);
          db.exec("COMMIT");
        }catch(error){db.exec("ROLLBACK");throw error;}
        closed=true;
      },
      rollback:async()=>{staged.clear();closed=true;}
    };
    try{
      const result=await work(tx);
      if(!closed)await tx.commit();
      return result;
    }catch(error){
      await tx.rollback();
      throw error;
    }
  }

  /** One-time import of a JSON state file (the previous store) when the database is still empty. */
  importJsonIfEmpty(jsonPath:string):number{
    const db=this.open();
    try{return this.importInto(db,jsonPath);}finally{this.close();}
  }
  private importInto(db:SqliteDatabase,jsonPath:string):number{
    const count=(db.prepare("SELECT COUNT(*) AS n FROM kv").get() as {n:number}).n;
    if(count>0||!fs.existsSync(jsonPath))return 0;
    let state:Record<string,unknown>;
    try{state=JSON.parse(fs.readFileSync(jsonPath,"utf8")) as Record<string,unknown>;}catch{return 0;}
    if(!state||typeof state!=="object"||Array.isArray(state))return 0;
    const now=new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try{
      const insert=db.prepare("INSERT INTO kv(key,value,updated_at) VALUES(?,?,?)");
      for(const [key,value] of Object.entries(state))insert.run(key,JSON.stringify(value),now);
      db.exec("COMMIT");
    }catch(error){db.exec("ROLLBACK");throw error;}
    return Object.keys(state).length;
  }

  path(){return this.dbPath;}
  configured(){return SqliteAdapter.available();}
  close(){try{this.db?.close();}catch{}this.db=null;}
}

/**
 * Pick the runtime store: LAYANX_STORAGE=json|sqlite|auto (default auto = SQLite when this Node
 * has it). "runtime.json" becomes "runtime.db"; the JSON file is imported once and left in place.
 */
export function sqlitePathFor(jsonPath:string):string{return jsonPath.replace(/\.json$/i,"")+".db";}
export function chooseStorageKind(env:NodeJS.ProcessEnv=process.env):"json"|"sqlite"{
  const wanted=(env.LAYANX_STORAGE??"auto").toLowerCase();
  if(wanted==="json")return "json";
  if(wanted==="sqlite"&&!SqliteAdapter.available(env))throw new Error("LAYANX_STORAGE=sqlite needs Node.js 22.13+ (node:sqlite).");
  return SqliteAdapter.available(env)?"sqlite":"json";
}
