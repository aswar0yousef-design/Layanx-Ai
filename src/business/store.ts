import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync} from "node:fs";
import {dirname} from "node:path";
import type {BusinessSnapshot} from "./types.js";
import {PostgresStorageAdapter} from "../storage/postgres-adapter.js";
const empty=():BusinessSnapshot=>({stores:[],products:[],orders:[],socialAccounts:[],media:[],content:[],campaigns:[],adAccounts:[],paidCampaigns:[],adGroups:[],adCreatives:[],paidAds:[],adMetrics:[]});
export class BusinessStore{
 private state:BusinessSnapshot; private readonly postgres?:PostgresStorageAdapter; private writeQueue:Promise<void>=Promise.resolve(); private hydrated=false;
 constructor(private readonly filePath=process.env.LAYANX_BUSINESS_STORAGE_PATH??".layanx/business.json"){const databaseUrl=process.env.LAYANX_DATABASE_URL??process.env.DATABASE_URL;this.postgres=databaseUrl?new PostgresStorageAdapter(databaseUrl):undefined;this.state=this.load();}
 private load():BusinessSnapshot{try{if(!existsSync(this.filePath))return empty();return {...empty(),...JSON.parse(readFileSync(this.filePath,"utf8"))};catch{return empty();}}
 async hydrate():Promise<void>{if(!this.postgres||this.hydrated){this.hydrated=true;return;}const remote=await this.postgres.transaction(async tx=>tx.get<BusinessSnapshot>("business:snapshot"));if(remote)this.state={...empty(),...remote};this.hydrated=true;}
 private persistLocal(){mkdirSync(dirname(this.filePath),{recursive:true});const t=this.filePath+".tmp";writeFileSync(t,JSON.stringify(this.state,null,2),"utf8");renameSync(t,this.filePath);}
 private persistRemote(snapshot:BusinessSnapshot){if(!this.postgres)return;this.writeQueue=this.writeQueue.then(()=>this.postgres!.transaction(async tx=>{await tx.set("business:snapshot",snapshot);})).catch(()=>undefined);}
 snapshot(){return structuredClone(this.state);}
 mutate(fn:(s:BusinessSnapshot)=>void){fn(this.state);const snapshot=this.snapshot();this.persistLocal();this.persistRemote(snapshot);return snapshot;}
 async close(){if(this.postgres){await this.writeQueue;await this.postgres.close();}}
}