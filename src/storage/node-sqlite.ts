import {createRequire} from "node:module";

/**
 * Node's built-in SQLite (node:sqlite, unflagged from Node 22.13). Loaded lazily so older
 * Node builds keep working with the JSON stores; LAYANX_SQLITE=off forces the JSON fallback.
 * The one-time "SQLite is experimental" warning is filtered so it does not alarm users in logs.
 */
export interface SqliteStatement{run(...params:unknown[]):unknown;get(...params:unknown[]):unknown;all(...params:unknown[]):unknown[];}
export interface SqliteDatabase{exec(sql:string):void;prepare(sql:string):SqliteStatement;close():void;}
type DatabaseSyncCtor=new(path:string,options?:Record<string,unknown>)=>SqliteDatabase;

let cached:DatabaseSyncCtor|null|undefined;

export function loadSqlite(env:NodeJS.ProcessEnv=process.env):DatabaseSyncCtor|null{
 if(env.LAYANX_SQLITE==="off")return null;
 if(cached!==undefined)return cached;
 const original=process.emitWarning;
 try{
  process.emitWarning=((warning:string|Error,...rest:unknown[])=>{
   const text=typeof warning==="string"?warning:warning?.message??"";
   if(/SQLite is an experimental feature/i.test(text))return;
   return (original as (...a:unknown[])=>void).call(process,warning,...rest);
  }) as typeof process.emitWarning;
  const mod=createRequire(import.meta.url)("node:sqlite") as {DatabaseSync?:DatabaseSyncCtor};
  cached=mod.DatabaseSync??null;
 }catch{cached=null;}
 finally{process.emitWarning=original;}
 return cached;
}

export function openSqlite(path:string,env:NodeJS.ProcessEnv=process.env):SqliteDatabase|null{
 const Ctor=loadSqlite(env);
 if(!Ctor)return null;
 const db=new Ctor(path);
 db.exec("PRAGMA journal_mode=WAL;PRAGMA synchronous=NORMAL;PRAGMA busy_timeout=5000;");
 return db;
}
