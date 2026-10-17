import {randomBytes,createHash,randomUUID} from "node:crypto";
import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync} from "node:fs";
import {dirname} from "node:path";
import {localSecret,LocalSecretVault} from "../security/local-secret-vault.js";
import type {OAuthProvider,OAuthConnection} from "./types.js";
interface OAuthConfig{authorize:string;token:string;clientId:string;clientSecret?:string;redirectUri:string;scopes:string[];usePkce?:boolean;extra?:Record<string,string>;}
interface Pending{provider:OAuthProvider;state:string;accountId:string;codeVerifier?:string;createdAt:number;redirectUri:string;}
const env=(p:string,k:string)=>process.env[`LAYANX_${p}_OAUTH_${k}`];
/** What each provider asks for when the owner connects an account (the developer app must allow these). */
const DEFAULT_SCOPES:Partial<Record<OAuthProvider,string>>={
 meta:"pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management",
 google:"https://www.googleapis.com/auth/adwords",
 youtube:"https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
 pinterest:"boards:read,boards:write,pins:read,pins:write",
 linkedin:"openid,profile,r_ads,r_ads_reporting",
 tiktok:"user.info.basic,video.publish,video.upload"
};
/** Providers whose developer app the owner can enter on the Connected Accounts page. */
export const APP_PROVIDERS:OAuthProvider[]=["meta"];
const APP_ID=/^[A-Za-z0-9._-]{4,200}$/,APP_SECRET=/^[A-Za-z0-9._~+/=-]{8,400}$/;
const PROVIDER_DEFAULTS:Partial<Record<OAuthProvider,Partial<OAuthConfig>>>={
 meta:{authorize:"https://www.facebook.com/v24.0/dialog/oauth",token:"https://graph.facebook.com/v24.0/oauth/access_token"},
 tiktok:{authorize:"https://www.tiktok.com/v2/auth/authorize/",token:"https://open.tiktokapis.com/v2/oauth/token/",usePkce:false},
 google:{authorize:"https://accounts.google.com/o/oauth2/v2/auth",token:"https://oauth2.googleapis.com/token"},
 youtube:{authorize:"https://accounts.google.com/o/oauth2/v2/auth",token:"https://oauth2.googleapis.com/token"},
 linkedin:{authorize:"https://www.linkedin.com/oauth/v2/authorization",token:"https://www.linkedin.com/oauth/v2/accessToken"},
 pinterest:{authorize:"https://www.pinterest.com/oauth/",token:"https://api.pinterest.com/v5/oauth/token"} ,
};
export class OAuthConnectionCenter{
 private vault?:LocalSecretVault;
 private getVault(){return this.vault??=new LocalSecretVault();}
 private readonly pending=new Map<string,Pending>();
 private readonly connectionsPath=process.env.LAYANX_OAUTH_CONNECTIONS_PATH??".layanx/oauth-connections.json";
 private connections:OAuthConnection[]=[];
 private readonly http:typeof fetch;
 constructor(options:{fetcher?:typeof fetch}={}){this.http=options.fetcher??((...a)=>fetch(...a));this.load();}
 private load(){try{if(existsSync(this.connectionsPath))this.connections=JSON.parse(readFileSync(this.connectionsPath,"utf8")) as OAuthConnection[];}catch{this.connections=[];}}
 private persist(){mkdirSync(dirname(this.connectionsPath),{recursive:true});const tmp=this.connectionsPath+".tmp";writeFileSync(tmp,JSON.stringify(this.connections,null,2),"utf8");renameSync(tmp,this.connectionsPath);}
 private syncProviderToken(provider:OAuthProvider,token:string){if(provider==="meta"){this.getVault().set("meta.social.token",token);this.getVault().set("facebook.social.token",token);this.getVault().set("instagram.social.token",token);}else if(["instagram","facebook","tiktok","youtube","linkedin","x","snapchat","pinterest"].includes(provider))this.getVault().set(`${provider}.social.token`,token);if(["meta","tiktok","google","linkedin"].includes(provider))this.getVault().set(`${provider}.ads.token`,token);}
 list(){return this.connections.map(c=>this.status(c));}
 get(id:string){const c=this.connections.find(x=>x.id===id);if(!c)throw new Error("oauth_connection_not_found");return c;}

 private config(provider:OAuthProvider):OAuthConfig{
  const p=provider.toUpperCase(),d=PROVIDER_DEFAULTS[provider]??{};
  const clientId=env(p,"CLIENT_ID")??localSecret(`${provider}.oauth.client_id`)??"";const clientSecret=localSecret(`${provider}.oauth.client_secret`,env(p,"CLIENT_SECRET"));
  const redirectUri=env(p,"REDIRECT_URI")??process.env.LAYANX_OAUTH_REDIRECT_URI??"";
  const authorize=env(p,"AUTHORIZE_URL")??d.authorize??"";const token=env(p,"TOKEN_URL")??d.token??"";
  const scopes=(env(p,"SCOPES")??DEFAULT_SCOPES[provider]??"").split(/[ ,]+/).filter(Boolean);
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
  const form=new URLSearchParams({client_id:c.clientId,code,grant_type:"authorization_code",redirect_uri:p.redirectUri});if(c.clientSecret&&p.provider!=="pinterest")form.set("client_secret",c.clientSecret);if(p.codeVerifier)form.set("code_verifier",p.codeVerifier);
  const headers:Record<string,string>={"content-type":"application/x-www-form-urlencoded"};if(p.provider==="pinterest"&&c.clientSecret)headers.Authorization=`Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`;
  const response=await this.http(c.token,{method:"POST",headers,body:form});const raw=await response.text();let d:any={};try{d=JSON.parse(raw);}catch{d={raw};}if(!response.ok)throw new Error(`oauth_token_exchange_${response.status}`);
  let token=String(d.access_token??"");if(!token)throw new Error("oauth_access_token_missing");
  let expiresIn=typeof d.expires_in==="number"?d.expires_in:undefined;
  // Meta's login token lasts about an hour: exchanged for the 60-day one (its Page tokens then do not expire).
  if(p.provider==="meta"){const long=await this.metaLongLived(token).catch(()=>null);if(long){token=long.token;expiresIn=long.expiresIn;}}
  const who=await this.identity(p.provider,token).catch(()=>null);
  return this.save(p.provider,who?.id??p.accountId,who?.name,token,d.refresh_token?String(d.refresh_token):undefined,expiresIn,typeof d.scope==="string"?d.scope.split(/[ ,]+/).filter(Boolean):c.scopes);
 }
 /**
  * Keep a connection. Each account the owner signs in with is its own connection (by the provider's user
  * id): signing in with a second Facebook user adds it; signing in with the same one again renews it.
  */
 private save(provider:OAuthProvider,accountId:string,accountName:string|undefined,token:string,refresh:string|undefined,expiresIn:number|undefined,scopes:string[]):OAuthConnection{
  const id=randomUUID(),secret=`${provider}.oauth.access.${id}`;this.getVault().set(secret,token);this.syncProviderToken(provider,token);
  let refreshSecret:string|undefined;if(refresh){refreshSecret=`${provider}.oauth.refresh.${id}`;this.getVault().set(refreshSecret,refresh);}
  const now=new Date().toISOString();
  const connection:OAuthConnection={id,provider,accountId,...(accountName?{accountName}:{}),scopes,tokenSecret:secret,refreshTokenSecret:refreshSecret,expiresAt:expiresIn?new Date(Date.now()+expiresIn*1000).toISOString():undefined,createdAt:now,updatedAt:now};
  for(const old of this.connections.filter(x=>x.provider===provider&&x.accountId===accountId)){this.getVault().delete(old.tokenSecret);if(old.refreshTokenSecret)this.getVault().delete(old.refreshTokenSecret);}
  this.connections=this.connections.filter(x=>!(x.provider===provider&&x.accountId===accountId));this.connections.push(connection);this.persist();
  return connection;
 }
 /** Who signed in (so two Facebook users are two connections, not one replacing the other). */
 private async identity(provider:OAuthProvider,token:string):Promise<{id:string;name?:string}|null>{
  if(provider!=="meta")return null;
  const r=await this.http("https://graph.facebook.com/v24.0/me?fields=id,name",{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15_000)});
  const d=await r.json().catch(()=>({})) as {id?:unknown;name?:unknown;error?:{message?:string}};
  if(!r.ok||!d.id)throw new Error("meta_token_rejected"+(d.error?.message?": "+d.error.message:""));
  return{id:String(d.id),...(typeof d.name==="string"?{name:d.name}:{})};
 }
 private async metaLongLived(token:string):Promise<{token:string;expiresIn?:number}|null>{
  const clientId=env("META","CLIENT_ID")??localSecret("meta.oauth.client_id")??"",secret=localSecret("meta.oauth.client_secret",env("META","CLIENT_SECRET"));
  if(!clientId||!secret)return null;
  const u=new URL("https://graph.facebook.com/v24.0/oauth/access_token");
  u.searchParams.set("grant_type","fb_exchange_token");u.searchParams.set("client_id",clientId);u.searchParams.set("client_secret",secret);u.searchParams.set("fb_exchange_token",token);
  const r=await this.http(u,{signal:AbortSignal.timeout(15_000)});const d=await r.json().catch(()=>({})) as {access_token?:unknown;expires_in?:unknown;error?:{message?:string}};
  if(!r.ok||typeof d.access_token!=="string")throw new Error("meta_token_exchange_failed"+(d.error?.message?": "+d.error.message:""));
  return{token:d.access_token,...(typeof d.expires_in==="number"?{expiresIn:d.expires_in}:{})};
 }
 /**
  * A token the owner pasted (Meta's Graph API Explorer, with their own app): works without a redirect
  * address. It is exchanged for the 60-day token when the app's keys are known, then kept like a sign-in.
  */
 async importToken(provider:OAuthProvider,token:string):Promise<OAuthConnection>{
  if(provider!=="meta")throw new Error(`oauth_token_import_not_supported:${provider}`);
  const t=token.trim();if(!/^[A-Za-z0-9_|.-]{20,2048}$/.test(t))throw new Error("oauth_token_invalid_format");
  const long=await this.metaLongLived(t);
  const access=long?.token??t;
  const who=await this.identity(provider,access);
  return this.save(provider,who!.id,who!.name,access,undefined,long?.expiresIn,(DEFAULT_SCOPES.meta??"").split(","));
 }
 /** The owner's developer app for a provider: its ID (shown) and secret (kept in the local vault, never shown). */
 setApp(provider:OAuthProvider,clientId:string,clientSecret?:string){
  if(!APP_PROVIDERS.includes(provider))throw new Error(`oauth_app_not_supported:${provider}`);
  const id=clientId.trim(),secret=(clientSecret??"").trim();
  if(!APP_ID.test(id))throw new Error("oauth_app_id_invalid");
  if(secret&&!APP_SECRET.test(secret))throw new Error("oauth_app_secret_invalid");
  this.getVault().set(`${provider}.oauth.client_id`,id);if(secret)this.getVault().set(`${provider}.oauth.client_secret`,secret);
  return this.appStatus(provider);
 }
 appStatus(provider:OAuthProvider){
  const p=provider.toUpperCase();
  const clientId=env(p,"CLIENT_ID")??localSecret(`${provider}.oauth.client_id`)??"";
  return{provider,clientId,hasSecret:!!localSecret(`${provider}.oauth.client_secret`,env(p,"CLIENT_SECRET")),redirectUri:env(p,"REDIRECT_URI")??process.env.LAYANX_OAUTH_REDIRECT_URI??"",scopes:(env(p,"SCOPES")??DEFAULT_SCOPES[provider]??"").split(/[ ,]+/).filter(Boolean)};
 }
 async token(connection:OAuthConnection){
  const value=this.getVault().get(connection.tokenSecret);
  if(value&&(!connection.expiresAt||Date.parse(connection.expiresAt)>Date.now()+60_000))return value;
  if(!connection.refreshTokenSecret)throw new Error("oauth_access_token_expired");
  const refresh=this.getVault().get(connection.refreshTokenSecret);if(!refresh)throw new Error("oauth_refresh_token_missing");
  const c=this.config(connection.provider);const form=new URLSearchParams({client_id:c.clientId,refresh_token:refresh,grant_type:"refresh_token"});if(c.clientSecret&&c.clientId&&connection.provider!=="pinterest")form.set("client_secret",c.clientSecret);const headers:Record<string,string>={"content-type":"application/x-www-form-urlencoded"};if(connection.provider==="pinterest"&&c.clientSecret)headers.Authorization=`Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`;
  const response=await this.http(c.token,{method:"POST",headers,body:form});const raw=await response.text();let d:any={};try{d=JSON.parse(raw);}catch{d={raw};}if(!response.ok)throw new Error(`oauth_refresh_${response.status}`);
  const access=String(d.access_token??"");if(!access)throw new Error("oauth_access_token_missing");
  this.getVault().set(connection.tokenSecret,access);this.syncProviderToken(connection.provider,access);connection.expiresAt=typeof d.expires_in==="number"?new Date(Date.now()+d.expires_in*1000).toISOString():undefined;connection.updatedAt=new Date().toISOString();
  if(d.refresh_token)this.getVault().set(connection.refreshTokenSecret,String(d.refresh_token));this.persist();return access;
 }
 async discover(id:string){
  const connection=this.get(id);
  const access=await this.token(connection);
  const request=async(url:string,init:RequestInit={})=>{
   const r=await this.http(url,{...init,headers:{Authorization:`Bearer ${access}`,Accept:"application/json",...(init.headers??{})}});
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
      if(page.access_token){this.getVault().set(`meta.page.${page.id}.token`,String(page.access_token));}
      accounts.push({platform:"facebook",externalId:String(page.id),name:String(page.name??page.id),tokenManaged:true});
     }
     const ig=page.instagram_business_account;
     if(ig?.id){
      if(page.access_token)this.getVault().set(`meta.page.${ig.id}.token`,String(page.access_token)); accounts.push({platform:"instagram",externalId:String(ig.id),name:String(ig.username??ig.name??ig.id),pageId:String(page.id),tokenManaged:Boolean(page.access_token)});
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
   case "pinterest":{
    const user=await request("https://api.pinterest.com/v5/user_account");
    const boards=await request("https://api.pinterest.com/v5/boards?page_size=250");
    return {provider:"pinterest",user:user?.username?{externalId:String(user.username),name:String(user.business_name??user.username)}:undefined,accounts:(Array.isArray(boards?.items)?boards.items:[]).map((x:any)=>({platform:"pinterest",externalId:String(x.id),name:String(x.name??x.id)}))};
   }
   default: throw new Error(`oauth_discovery_not_implemented:${connection.provider}`);
  }
 } async discoverAds(id:string){
  const connection=this.get(id);
  const access=await this.token(connection);
  const headers:Record<string,string>={Authorization:`Bearer ${access}`,Accept:"application/json"};
  const get=async(url:string,extra:Record<string,string>={})=>{const r=await this.http(url,{headers:{...headers,...extra}});const t=await r.text();let d:any={};try{d=t?JSON.parse(t):{}}catch{d={raw:t}}if(!r.ok)throw new Error(`oauth_ads_discovery_http_${r.status}`);return d;};
  switch(connection.provider){
   case "google":{
    const d=await get("https://googleads.googleapis.com/v25/customers:listAccessibleCustomers");
    return {provider:"google",accounts:(d.resourceNames??[]).map((x:string)=>({platform:"google",externalId:x.split("/").pop()??x,name:x}))};
   }
   case "linkedin":{
    const d=await get("https://api.linkedin.com/rest/adAccounts?q=search&search.status.values[0]=ACTIVE&search.test=false",{ "Linkedin-Version":process.env.LAYANX_LINKEDIN_API_VERSION??"202604","X-Restli-Protocol-Version":"2.0.0"});
    return {provider:"linkedin",accounts:(d.elements??[]).map((x:any)=>({platform:"linkedin",externalId:String(x.id),name:String(x.name??x.id),currency:String(x.currency??"USD")}))};
   }
   case "meta":{
    const d=await get("https://graph.facebook.com/v24.0/me/adaccounts?fields=id,name,currency,account_status");
    return {provider:"meta",accounts:(d.data??[]).map((x:any)=>({platform:"meta",externalId:String(x.id),name:String(x.name??x.id),currency:String(x.currency??"USD")}))};
   }
   case "tiktok":{
    const d=await get("https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/");
    return {provider:"tiktok",accounts:(d.data?.list??d.data?.advertiser_list??[]).map((x:any)=>({platform:"tiktok",externalId:String(x.advertiser_id??x.id),name:String(x.advertiser_name??x.name??x.advertiser_id),currency:String(x.currency??"USD")}))};
   }
   default: throw new Error(`oauth_ads_discovery_not_implemented:${connection.provider}`);
  }
 }

 revoke(connection:OAuthConnection){this.getVault().delete(connection.tokenSecret);if(connection.refreshTokenSecret)this.getVault().delete(connection.refreshTokenSecret);for(const key of [connection.provider==="meta"?"meta.social.token":undefined,connection.provider==="meta"?"facebook.social.token":undefined,connection.provider==="meta"?"instagram.social.token":undefined,`${connection.provider}.social.token`,`${connection.provider}.ads.token`].filter(Boolean) as string[])this.getVault().delete(key);this.connections=this.connections.filter(x=>x.id!==connection.id);this.persist();}
 /** A connected Facebook Page or Instagram account was removed: its Page token goes too. */
 forgetAccountToken(platform:string,externalId:string){if((platform==="facebook"||platform==="instagram")&&/^[0-9]{1,30}$/.test(externalId))this.getVault().delete(`meta.page.${externalId}.token`);}
 /** The local vault, for the keys the Connected Accounts page keeps (store keys). */
 secrets(){return this.getVault();}
 status(connection:OAuthConnection){return {id:connection.id,provider:connection.provider,accountId:connection.accountId,accountName:connection.accountName,scopes:connection.scopes,expiresAt:connection.expiresAt,configured:true};}
}

/** What the sign-in window shows after the platform sends the owner back: done (it closes itself) or why not. Served with a CSP that allows only this nonce. */
export function oauthDonePage(ok:boolean,detail:string,nonce:string):string{
  const esc=(x:string)=>x.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
  const title=ok?"تم ربط الحساب · Account connected":"لم يتم الربط · Not connected";
  return`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style nonce="${esc(nonce)}">body{font-family:system-ui,"Segoe UI",Tahoma,sans-serif;background:#0B1424;color:#E8EEF8;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:32rem;padding:2rem;text-align:center}h1{font-size:1.3rem;color:${ok?"#86EFAC":"#FCA5A5"}}p{color:#93A4BF}</style></head>
<body><main><h1>${esc(title)}</h1><p dir="auto">${esc(detail)}</p><p>${ok?"عد إلى LayanX: ستظهر صفحاتك وحساباتك هناك. يمكنك إغلاق هذه النافذة.":"عد إلى LayanX وحاول مرة أخرى، أو الصق رمز الوصول بدل تسجيل الدخول."}</p></main>
<script nonce="${esc(nonce)}">try{if(window.opener)window.opener.postMessage({type:"layanx-oauth",ok:${ok}},location.origin);${ok?"setTimeout(function(){window.close()},1500)":""}}catch(e){}</script></body></html>`;
}

