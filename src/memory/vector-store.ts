import path from "node:path";
import fs from "node:fs";
import {openSqlite,type SqliteDatabase} from "../storage/node-sqlite.js";

/**
 * Embedding cache for memory entries, keyed by entry id + embedding model. Lives in
 * <store>/memory-vectors.db (node:sqlite) so vectors survive restarts; falls back to an
 * in-process map when SQLite is unavailable. Vectors are stored as Float32 blobs.
 */
export class VectorStore{
 private readonly memory=new Map<string,Float32Array>();
 private readonly db:SqliteDatabase|null;
 constructor(file?:string){
  let db:SqliteDatabase|null=null;
  if(file){
   try{
    fs.mkdirSync(path.dirname(file),{recursive:true});
    db=openSqlite(file);
    db?.exec("CREATE TABLE IF NOT EXISTS vectors(id TEXT NOT NULL,model TEXT NOT NULL,dims INTEGER NOT NULL,vec BLOB NOT NULL,PRIMARY KEY(id,model))");
   }catch{db=null;}
  }
  this.db=db;
 }
 static forStore(env:NodeJS.ProcessEnv=process.env):VectorStore{
  return new VectorStore(env.LAYANX_STORE_DIR?path.join(env.LAYANX_STORE_DIR,"memory-vectors.db"):undefined);
 }
 persistent(){return this.db!==null;}
 get(id:string,model:string):Float32Array|undefined{
  const key=model+"\u0000"+id;
  const hit=this.memory.get(key);if(hit)return hit;
  if(!this.db)return undefined;
  const row=this.db.prepare("SELECT vec FROM vectors WHERE id=? AND model=?").get(id,model) as {vec?:Uint8Array}|undefined;
  if(!row?.vec)return undefined;
  const bytes=Uint8Array.from(row.vec);
  const vec=new Float32Array(bytes.buffer,bytes.byteOffset,Math.floor(bytes.byteLength/4));
  this.memory.set(key,vec);
  return vec;
 }
 put(id:string,model:string,vector:number[]):void{
  const vec=Float32Array.from(vector);
  this.memory.set(model+"\u0000"+id,vec);
  this.db?.prepare("INSERT OR REPLACE INTO vectors(id,model,dims,vec) VALUES(?,?,?,?)").run(id,model,vec.length,new Uint8Array(vec.buffer,vec.byteOffset,vec.byteLength));
 }
 close(){try{this.db?.close();}catch{}}
}
