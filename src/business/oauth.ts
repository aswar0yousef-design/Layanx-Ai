import {randomBytes,createHash,randomUUID} from "node:crypto";
import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync} from "node:fs";
import {dirname} from "node:path";
import {localSecret,LocalSecretVault} from "../security/local-secret-vault.js";
import type {OAuthProvider,OAuthConnection} from "./types.js";
interface OAuthConfig{authorize:string;token:string;clientId:string;clientSecret?:string;redirectUri:string;scopes:string[];usePkce?:boolean;extra?:Record<string,string>;}
interface Pending{provider:OAuthProvider;state:string;accountId:string;codeVerifier?:string;createdAt:number;redirectUri:string;}
const env=(p:string,k:string)=>process.env[`LAYANX_${p}_OAUTH_${k}`];
const PROVIDER_DEFAULTS:Partial<Record<OAuthProvider,Partial<OAuthConfig>>>={
 meta:{authorize:"https://www.facebook.com/v24.0/dialog/oauth",token:"https://graph.facebook.com/v24.0/oauth/access_token"},
 tiktok:{authorize:"https://www.tiktok.com/v2/auth/authorize/",token:"https://open.tiktokapis.com/v2/oauth/token/",usePkce:false},
 google:{authorize:"https://accounts.google.com/o/oauth2/v2/auth",token:"https://oauth2.googleapis.com/token"},
 youtube:{authorize:"https://accounts.google.com/o/oauth2/v2/auth",token:"https://oauth2.googleapis.com/token"},
 linkedin:{authorize:"https://www.linkedin.com/oauth/v2/authorization",token:"https://www.linkedin.com/oauth/v2/accessToken"},
};
export class OAuthConnectionCenter{
 private readonly vault=new LocalSecretVault();
 private readonly pending=new Map<string,Pending>();
 private readonly connectionsPath=process.env.LAYANX_OAUTH_CONNECTIONS_PATH??".layanx/oauth-connections.json";
 private connections:OAuthConnection[]=[];
 constructor(){this.load();}
 private load(){try{if(existsSync(this.connectionsPath))this.connections=JSON.parse(readFileSync(this.connectionsPath,"utf8")) as OAuthConnection[];}catch{this.connections=[];}}
 private persist(){mkdirSync(dirname(this.connectionsPath),{recursive:true});const tmp=this.connectionsPath+".tmp";writeFileSync(tmp,JSON.stringify(this.connections,null,2),"utf8");renameSync(tmp,this.connectionsPath);}
 private syncProviderToken(provider:OAuthProvider,token:string){if(provider==="meta"){this.vault.set("meta.social.token",token);this.vault.set("facebook.social.token",token);this.vault.set("instagram.social.token",token);}else if(["instagram","facebook","tiktok","youtube","linkedin","x","snapchat","pinterest"].includes(provider))this.vault.set(`${provider}.social.token`,token);if(["meta","tiktok","google","linkedin"].includes(provider))this.vault.set(`${provider}.ads.token`,token);}
 list(){return this.connections.map(c=>this.status(c));}
 get(id:string){const c=this.connections.find(x=>x.id===id);if(!c)throw new Error("oauth_connection_not_found");return c;}

 private config(provider:OAuthProvider):OAuthConfig{
  const p=provider.toUpperCase(),d=PROVIDER_DEFAULTS[provider]??{};
  const clientId=env(p,"CLIENT_ID")??"";const clientSecret=localSecret(`${provider}.oauth.client_secret`,env(p,"CLIENT_SECRET"));
  const redirectUri=env(p,"REDIRECT_URI")??process.env.LAYANX_OAUTH_REDIRECT_URI??"";
  const authorize=env(p,"AUTHORIZE_URL")??d.authorize??"";const token=env(p,"TOKEN_URL")??d.token??"";
  const scopes=(env(p,"SCOPES")??(provider==="google"?"https://www.googleapis.com/auth/adwords":provider==="youtube"?"https://www.googleapis.com/auth/youtube.upload":"user.info.basic")).split(/[ ,]+/).filter(Boolean);
  if(!clientId||!redirectUri||!authorize||!token)throw new Error(`oauth_${provider}_not_configured`);
  return {authorize,token,clientId,clientSecret,redirectUri,scopes,usePkce:provider==="tiktok"||env(p,"USE_PKCE")==="true",extra:env(p,"EXTRA_JSON")?JSON.parse(env(p,"EXTRA_JSON")!):undefined};
 }
 begin(provider:OAuthProvider,accountId="default"){
  const c=this.config(provider),state=randomBytes(32).toString("base64url");const pending:Pending={provider,state,accountId,createdAt:Date.now(),redirectUri:c.redirectUri};
  if(c.usePkce){const verifier=randomBytes(48).toString("base64url");pending.codeVerifier=verifier;}
  this.pending.set(state,pending);
  const u=new URL(c.authorize);u.searchParams.set("client_id",c.clientId);u.searchParams.set("response_type","code");u.searchParams.set("redirect_uri",c.redirectUri);u.searchParams.set("scope",c.scopes.join(" "));u.searchParams.set("state",state);
  if(pending.codeVerifier){u.searchParams.set("code_challenge",createHash("sha256").update(pending.codeVerifier).digest("base64url"));u.searchParams.set("code_challenge_method","S256");}
  for(const [k,v] of Object.entries(c.extra??{}))u.searchParams.set(k,v);
  return {authorizationUrl:u.toString(),state,accountId};
 }
 async callback(state:string,code:string){
  const p=this.pending.get(state);if(!p||Date.now()-p.createdAt>10*60_000){this.pending.delete(state);throw new Error("oauth_state_invalid_or_expired");}
  this.pending.delete(state);const c=this.config(p.provider);
  const form=new URLSearchParams({client_id:c.clientId,code,grant_type:"authorization_code",redirect_uri:p.redirectUri});if(c.clientSecret)form.set("client_secret",c.clientSecret);if(p.codeVerifier)form.set("code_verifier",p.codeVerifier);
  const response=await fetch(c.token,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:form});const raw=await response.text();let d:any={};try{d=JSON.parse(raw);}catch{d={raw};}if(!response.ok)throw new Error(`oauth_token_exchange_${response.status}`);
  const token=String(d.access_token??"");if(!token)throw new Error("oauth_access_token_missing");
  const id=randomUUID(),secret=`${p.provider}.oauth.access.${id}`;this.vault.set(secret,token);this.syncProviderToken(p.provider,token);
  let refreshSecret:string|undefined;if(d.refresh_token){refreshSecret=`${p.provider}.oauth.refresh.${id}`;this.vault.set(refreshSecret,String(d.refresh_token));}
  const connection:OAuthConnection={id,provider:p.provider,accountId:p.accountId,scopes:typeof d.scope==="string"?d.scope.split(/[ ,]+/).filter(Boolean):c.scopes,tokenSecret:secret,refreshTokenSecret:refreshSecret,expiresAt:typeof d.expires_in==="number"?new Date(Date.now()+d.expires_in*1000).toISOString():undefined,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  this.connections=this.connections.filter(x=>!(x.provider===connection.provider&&x.accountId===connection.accountId));this.connections.push(connection);this.persist();
  return connection;
 }
 async token(connection:OAuthConnection){
  if(connection.expiresAt&&Date.parse(connection.expiresAt)>Date.now()+60_000){const value=this.vault.get(connection.tokenSecret);if(value)return value;}
  if(!connection.refreshTokenSecret)throw new Error("oauth_access_token_expired");
  const refresh=this.vault.get(connection.refreshTokenSecret);if(!refresh)throw new Error("oauth_refresh_token_missing");
  const c=this.config(connection.provider);const form=new URLSearchParams({client_id:c.clientId,refresh_token:refresh,grant_type:"refresh_token"});if(c.clientSecret)form.set("client_secret",c.clientSecret);
  const response=await fetch(c.token,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:form});const raw=await response.text();let d:any={};try{d=JSON.parse(raw);}catch{d={raw};}if(!response.ok)throw new Error(`oauth_refresh_${response.status}`);
  const access=String(d.access_token??"");if(!access)throw new Error("oauth_access_token_missing");
  this.vault.set(connection.tokenSecret,access);this.syncProviderToken(connection.provider,access);connection.expiresAt=typeof d.expires_in==="number"?new Date(Date.now()+d.expires_in*1000).toISOString():undefined;connection.updatedAt=new Date().toISOString();
  if(d.refresh_token)this.vault.set(connection.refreshTokenSecret,String(d.refresh_token));this.persist();return access;
 }
 async discover(id:string){
  const connection=this.get(id);
  const access=await this.token(connection);
  const request=async(url:string,init:RequestInit={})=>{
   const r=await fetch(url,{...init,headers:{Authorization:`Bearer ${access}`,Accept:"application/json",...(init.headers??{})}});
   const text=await r.text();let data:any={};try{data=text?JSON.parse(text):{}}catch{data={raw:text}};
   if(!r.ok)throw new Error(`oauth_discovery_http_${r.status}`);
   return data;
  };
  switch(connection.provider){
   case "meta":{
    const data=await request("https://graph.facebook.com/v24.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name}");
    const accounts:Array<any>=[];
    for(const page of Array.isArray(data?.data)?data.data:[]){
     if(page.id){
      if(page.access_token)this.vault.set(`meta.page.${page.id}.token`,String(page.access_token));
      accounts.push({platform:"facebook",externalId:String(page.id),name:String(page.name??page.id),tokenManaged:true});
     }
     const ig=page.instagram_business_account;
     if(ig?.id){
      accounts.push({platform:"instagram",externalId:String(ig.id),name:String(ig.username??ig.name??ig.id),pageId:String(page.id),tokenManaged:Boolean(page.access_token)});
     }
    }
    return {provider:"meta",accounts};
   }
   case "tiktok":{
    const data=await request("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url");
    const u=data?.data?.user;
    return {provider:"tiktok",accounts:u?.open_id?[{platform:"tiktok",externalId:String(u.open_id),name:String(u.display_name??u.open_id)}]:[]};
   }
   case "youtube":{
    const u=await request("https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&mine=true");
    return {provider:"youtube",accounts:(Array.isArray(u?.items)?u.items:[]).map((x:any)=>({platform:"youtube",externalId:String(x.id),name:String(x.snippet?.title??x.id)}))};
   }
   case "linkedin":{
    const u=await request("https://api.linkedin.com/v2/userinfo");
    return {provider:"linkedin",accounts:u?.sub?[{platform:"linkedin",externalId:String(u.sub),name:String(u.name??u.sub)}]:[]};
   }
   case "x":{
    const u=await request("https://api.x.com/2/users/me");
    const user=u?.data;
    return {provider:"x",accounts:user?.id?[{platform:"x",externalId:String(user.id),name:String(user.name??user.username??user.id)}]:[]};
   }
   default: throw new Error(`oauth_discovery_not_implemented:${connection.provider}`);
  }
 }
 revoke(connection:OAuthConnection){this.vault.delete(connection.tokenSecret);if(connection.refreshTokenSecret)this.vault.delete(connection.refreshTokenSecret);this.vault.delete(`${connection.provider}.social.token`);this.vault.delete(`${connection.provider}.ads.token`);this.connections=this.connections.filter(x=>x.id!==connection.id);this.persist();}
 status(connection:OAuthConnection){return {id:connection.id,provider:connection.provider,accountId:connection.accountId,accountName:connection.accountName,scopes:connection.scopes,expiresAt:connection.expiresAt,configured:true};}
}
