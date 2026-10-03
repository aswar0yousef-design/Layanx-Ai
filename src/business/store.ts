import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync} from "node:fs";
import {dirname} from "node:path";
import type {BusinessSnapshot} from "./types.js";
import {PostgresStorageAdapter} from "../storage/postgres-adapter.js";

const empty=():BusinessSnapshot=>({
 stores:[],products:[],orders:[],socialAccounts:[],media:[],content:[],campaigns:[],
 adAccounts:[],paidCampaigns:[],adGroups:[],adCreatives:[],paidAds:[],adMetrics:[]
});

export class BusinessStore{
 private state:BusinessSnapshot;
 private readonly postgres?:PostgresStorageAdapter;
 private writeQueue:Promise<void>=Promise.resolve();
 private hydrated=false;
 private persistenceError?:string;

 constructor(private readonly filePath=process.env.LAYANX_BUSINESS_STORAGE_PATH??".layanx/business.json"){
  const databaseUrl=process.env.LAYANX_DATABASE_URL??process.env.DATABASE_URL;
  this.postgres=databaseUrl?new PostgresStorageAdapter(databaseUrl):undefined;
  this.state=this.load();
 }

 private load():BusinessSnapshot{
  try{
   if(!existsSync(this.filePath))return empty();
   const raw=readFileSync(this.filePath,"utf8");
   return {...empty(),...(JSON.parse(raw) as Partial<BusinessSnapshot>)};
  }catch{
   return empty();
  }
 }

 async hydrate():Promise<void>{
  if(!this.postgres||this.hydrated){this.hydrated=true;return;}
  const remote=await this.postgres.transaction(async tx=>tx.get<BusinessSnapshot>("business:snapshot"));
  if(remote)this.state={...empty(),...remote};
  this.hydrated=true;
 }

 private persistLocal():void{
  mkdirSync(dirname(this.filePath),{recursive:true});
  const temporary=this.filePath+".tmp";
  writeFileSync(temporary,JSON.stringify(this.state,null,2),"utf8");
  renameSync(temporary,this.filePath);
 }

 persistenceStatus(){return {mode:this.postgres?"postgres":"local",healthy:!this.persistenceError,error:this.persistenceError};}

 private persistRemote(snapshot:BusinessSnapshot):void{
  if(!this.postgres)return;
  this.writeQueue=this.writeQueue.then(async()=>{
   await this.postgres!.transaction(async tx=>{
    await tx.set("business:snapshot",snapshot);
   });
  });
 }

 snapshot():BusinessSnapshot{return structuredClone(this.state);}

 mutate(fn:(s:BusinessSnapshot)=>void):BusinessSnapshot{
  fn(this.state);
  const snapshot=this.snapshot();
  this.persistLocal();
  this.persistRemote(snapshot);
  return snapshot;
 }

 async close():Promise<void>{
  if(this.postgres){
   await this.writeQueue;
   await this.postgres.close();
  }
 }
}