import {existsSync,readFileSync,mkdirSync,writeFileSync,renameSync} from "node:fs";
import {dirname} from "node:path";
import {LocalSecretVault} from "../security/local-secret-vault.js";

export interface QuranAdminSettings {
  environment:"prelive"|"production";
  recitationId:number;
  translationId?:number;
  platforms:string[];
  outputDir:string;
  reciterName:string;
  reciterCredit:string;
  licenseApproved:boolean;
  licenseProofUrl?:string;
  timingSource:string;
  youtubeConnectionId?:string;
  tiktokConnectionId?:string;
}

const DEFAULTS:QuranAdminSettings={
  environment:"production",
  recitationId:0,
  platforms:["youtube","tiktok"],
  outputDir:".layanx/quran",
  reciterName:"Configured reciter",
  reciterCredit:"Recitation: Configured reciter",
  licenseApproved:false,
  timingSource:"qud-universal-audio"
};

export class QuranAdminConfigStore {
  private readonly settingsPath=process.env.LAYANX_QURAN_ADMIN_SETTINGS_PATH??".layanx/quran-admin.json";
  private readonly vault=new LocalSecretVault();
  private settings:QuranAdminSettings;
  constructor(){this.settings={...DEFAULTS,...this.load()};}
  private load():Partial<QuranAdminSettings>{
    try{
      if(!existsSync(this.settingsPath))return {};
      const parsed=JSON.parse(readFileSync(this.settingsPath,"utf8")) as Partial<QuranAdminSettings>;
      return parsed;
    }catch{throw new Error("quran_admin_settings_corrupt");}
  }
  private persist(){
    mkdirSync(dirname(this.settingsPath),{recursive:true});
    const tmp=this.settingsPath+".tmp";
    writeFileSync(tmp,JSON.stringify(this.settings,null,2),"utf8");
    renameSync(tmp,this.settingsPath);
  }
  get(){
    const clientId=this.vault.get("quran.foundation.client_id");
    const clientSecret=this.vault.get("quran.foundation.client_secret");
    return {
      ...structuredClone(this.settings),
      credentialsConfigured:Boolean(clientId&&clientSecret),
      clientIdMasked:clientId?clientId.slice(0,4)+"…"+clientId.slice(-4):undefined
    };
  }
  config(){
    return {
      ...structuredClone(this.settings),
      clientId:this.vault.get("quran.foundation.client_id")??"",
      clientSecret:this.vault.get("quran.foundation.client_secret")??""
    };
  }
  save(input:Partial<QuranAdminSettings>&{clientId?:string;clientSecret?:string}){
    if(input.clientId!==undefined){
      if(!input.clientId.trim())throw new Error("quran_foundation_client_id_required");
      this.vault.set("quran.foundation.client_id",input.clientId.trim());
    }
    if(input.clientSecret!==undefined){
      if(!input.clientSecret.trim())throw new Error("quran_foundation_client_secret_required");
      this.vault.set("quran.foundation.client_secret",input.clientSecret.trim());
    }
    const next={...this.settings};
    if(input.environment!==undefined){if(input.environment!=="prelive"&&input.environment!=="production")throw new Error("quran_environment_invalid");next.environment=input.environment;}
    if(input.recitationId!==undefined){if(!Number.isInteger(input.recitationId)||input.recitationId<1)throw new Error("quran_recitation_id_invalid");next.recitationId=input.recitationId;}
    if(input.translationId!==undefined)next.translationId=input.translationId;
    if(input.platforms!==undefined){const platforms=input.platforms.filter(x=>x==="youtube"||x==="tiktok");if(!platforms.length)throw new Error("quran_platforms_required");next.platforms=[...new Set(platforms)];}
    if(input.outputDir!==undefined&&input.outputDir.trim())next.outputDir=input.outputDir.trim();
    if(input.reciterName!==undefined&&input.reciterName.trim())next.reciterName=input.reciterName.trim();
    if(input.reciterCredit!==undefined&&input.reciterCredit.trim())next.reciterCredit=input.reciterCredit.trim();
    if(input.licenseApproved!==undefined)next.licenseApproved=Boolean(input.licenseApproved);
    if(input.licenseProofUrl!==undefined)next.licenseProofUrl=input.licenseProofUrl?.trim()||undefined;
    if(input.timingSource!==undefined&&input.timingSource.trim())next.timingSource=input.timingSource.trim();
    if(input.youtubeConnectionId!==undefined)next.youtubeConnectionId=input.youtubeConnectionId?.trim()||undefined;
    if(input.tiktokConnectionId!==undefined)next.tiktokConnectionId=input.tiktokConnectionId?.trim()||undefined;
    this.settings=next;this.persist();return this.get();
  }
  clearCredentials(){this.vault.delete("quran.foundation.client_id");this.vault.delete("quran.foundation.client_secret");return this.get();}
}
