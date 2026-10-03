import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync} from "node:fs";
import {dirname} from "node:path";
import type {GrowthSnapshot} from "./growth-types.js";
const empty=():GrowthSnapshot=>({experiments:[],metrics:[],actions:[],updatedAt:new Date().toISOString(),version:1});
export class GrowthStore{
 private state:GrowthSnapshot;
 constructor(private readonly filePath=process.env.LAYANX_GROWTH_STORAGE_PATH??".layanx/growth.json"){this.state=this.load();}
 private load(){try{if(!existsSync(this.filePath))return empty();return {...empty(),...(JSON.parse(readFileSync(this.filePath,"utf8")) as Partial<GrowthSnapshot>)}}catch{return empty();}}
 snapshot(){return structuredClone(this.state);}
 mutate(fn:(s:GrowthSnapshot)=>void){fn(this.state);this.state.updatedAt=new Date().toISOString();mkdirSync(dirname(this.filePath),{recursive:true});const tmp=this.filePath+".tmp";writeFileSync(tmp,JSON.stringify(this.state,null,2),"utf8");renameSync(tmp,this.filePath);return this.snapshot();}
}
