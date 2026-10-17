import {randomBytes,createHash,randomUUID} from "node:crypto";
import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync} from "node:fs";
import {dirname} from "node:path";
import {localSecret,LocalSecretVault} from "../security/local-secret-vault.js";
import type {OAuthProvider,OAuthConnection} from "./types.js";
interface OAuthConfig{authorize:string;token:string;clientId:string;clientSecret?:string;redirectUri:string;scopes:string[];usePkce?:boolean;extra?:Record<string,string>;}
interface Pending{provider:OAuthProvider;state:string;accountId:string;codeVerifier?:string;createdAt:number;redirectUri:string;}
const env=(p:string,k:string)=>process.env[`LAYANX_${p}_OAUTH_${k}`];
const OAUTH_PROVIDERS=new Set<OAuthProvider>(["meta","instagram","facebook","tiktok","google","linkedin","x","youtube","snapchat","pinterest"]);
function tokenPayload(value:any){return value?.data&&typeof value.data==="object"?value.data:value;}
function providerScopes(provider:OAuthProvider):string{
 switch(provider){
  case "meta": return "pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,ads_read,ads_management,business_management";
  case "instagram": return "instagram_basic,instagram_content_publish";
  case "facebook": return "pages_show_list,pages_read_engagement,pages_manage_posts";
  case "tiktok": return "user.info.basic,video.publish,video.upload";
  case "google": return "https://www.googleapis.com/auth/adwords";
  case "youtube": return "https://www.googleapis.com/auth/youtube.upload,https://www.googleapis.com/auth/youtube.readonly";
  case "linkedin": return "openid,profile,email,w_member_social,r_ads,r_ads_reporting";
  case "x": return "tweet.read,users.read,tweet.write,offline.access";
  case "pinterest": return "boards:read,boards:write,pins:read,pins:write";
  case "snapchat": return "https://adsapi.snapchat.com/ads";
 }
}
const PROVIDER_DEFAULTS:Partial<Record<OAuthProvider,Partial<OAuthConfig>>>={
 meta:{authorize:"https://www.facebook.com/v24.0/dialog/oauth",token:"https://graph.facebook.com/v24.0/oauth/access_token"},
 tiktok:{authorize:"https://www.tiktok.com/v2/auth/authorize/",token:"https://open.tiktokapis.com/v2/oauth/token/",usePkce:true},
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
 constructor(){this.load();}
 private load(){try{if(existsSync(this.connectionsPath))this.connections=JSON.parse(readFileSync(this.connectionsPath,"utf8")) as OAuthConnection[];}catch{this.connections=[];}}
 private persist(){mkdirSync(dirname(this.connectionsPath),{recursive:true});const tmp=this.connectionsPath+".tmp";writeFileSync(tmp,JSON.stringify(this.connections,null,2),"utf8");renameSync(tmp,this.connectionsPath);}
 private syncProviderToken(provider:OAuthProvider,token:string){if(provider==="meta"){this.getVault().set("meta.social.token",token);this.getVault().set("facebook.social.token",token);this.getVault().set("instagram.social.token",token);}else if(["instagram","facebook","tiktok","youtube","linkedin","x","snapchat","pinterest"].includes(provider))this.getVault().set(`${provider}.social.token`,token);if(["meta","tiktok","google","linkedin"].includes(provider))this.getVault().set(`${provider}.ads.token`,token);}
 list(){return this.connections.map(c=>this.status(c));}
 get(id:string){const c=this.connections.find(x=>x.id===id);if(!c)throw new Error("oauth_connection_not_found");return c;}

 private config(provider:OAuthProvider):OAuthConfig{
  if(!OAUTH_PROVIDERS.has(provider))throw new Error("oauth_provider_unsupported");
  const p=provider.toUpperCase(),d=PROVIDER_DEFAULTS[provider]??{};
  const clientId=env(p,"CLIENT_ID")??"";const clientSecret=localSecret(`${provider}.oauth.client_secret`,env(p,"CLIENT_SECRET"));
  const redirectUri=env(p,"REDIRECT_URI")??process.env.LAYANX_OAUTH_REDIRECT_URI??"";
  const authorize=env(p,"AUTHORIZE_URL")??d.authorize??"";const token=env(p,"TOKEN_URL")??d.token??"";
  const scopes=(env(p,"SCOPES")??providerScopes(provider)).split(/[ ,]+/).filter(Boolean);
  if(!clientId||!redirectUri||!authorize||!token)throw new Error(`oauth_${provider}_not_configured`);
  let extra:Record<string,string>|undefined;
  try{extra=env(p,"EXTRA_JSON")?JSON.parse(env(p,"EXTRA_JSON")!):undefined;}catch{throw new Error(`oauth_${provider}_extra_json_invalid`);}
  const reserved=new Set(["client_id","client_key","response_type","redirect_uri","scope","state","code_challenge","code_challenge_method"]);
  if(extra&&Object.keys(extra).some(k=>reserved.has(k.toLowerCase())))throw new Error(`oauth_${provider}_extra_overrides_reserved_parameter`);
  return {authorize,token,clientId,clientSecret,redirectUri,scopes,usePkce:provider==="tiktok"||env(p,"USE_PKCE")==="true",extra};
 }
 begin(provider:OAuthProvider,accountId="default"){
  const c=this.config(provider),state=randomBytes(32).toString("base64url");for(const [key,p] of this.pending)if(Date.now()-p.createdAt>10*60_000)this.pending.delete(key);const pending:Pending={provider,state,accountId,createdAt:Date.now(),redirectUri:c.redirectUri};
  if(c.usePkce){const verifier=randomBytes(48).toString("base64url");pending.codeVerifier=verifier;}
  this.pending.set(state,pending);
  const u=new URL(c.authorize);u.searchParams.set(provider==="tiktok"?"client_key":"client_id",c.clientId);u.searchParams.set("response_type","code");u.searchParams.set("redirect_uri",c.redirectUri);u.searchParams.set("scope",c.scopes.join(provider==="pinterest"?",":" "));u.searchParams.set("state",state);
  if(provider==="google"||provider==="youtube"){u.searchParams.set("access_type","offline");u.searchParams.set("prompt","consent");}
  if(pending.codeVerifier){u.searchParams.set("code_challenge",createHash("sha256").update(pending.codeVerifier).digest("base64url"));u.searchParams.set("code_challenge_method","S256");}
  for(const [k,v] of Object.entries(c.extra??{}))u.searchParams.set(k,v);
  return {authorizationUrl:u.toString(),state,accountId};
 }
 async callback(state:string,code:string){
  const p=this.pending.get(state);if(!p||Date.now()-p.createdAt>10*60_000){this.pending.delete(state);throw new Error("oauth_state_invalid_or_expired");}
  this.pending.delete(state);const c=this.config(p.provider);
  const form=new URLSearchParams({[p.provider==="tiktok"?"client_key":"client_id"]:c.clientId,code,grant_type:"authorization_code",redirect_uri:p.redirectUri});if(c.clientSecret&&p.provider!=="pinterest")form.set("client_secret",c.clientSecret);if(p.codeVerifier)form.set("code_verifier",p.codeVerifier);
  const headers:Record<string,string>={"content-type":"application/x-www-form-urlencoded"};if(p.provider==="pinterest"&&c.clientSecret)headers.Authorization=`Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`;
  let response:Response;
  if(p.provider==="meta"){
   const u=new URL(c.token);for(const [k,v] of form)u.searchParams.set(k,v);
   response=await fetch(u,{method:"GET",signal:AbortSignal.timeout(15_000)});
  }else response=await fetch(c.token,{method:"POST",headers,body:form,signal:AbortSignal.timeout(15_000)});
  const raw=await response.text();let d:any={};try{d=JSON.parse(raw);}catch{d={raw};}if(!response.ok)throw new Error(`oauth_token_exchange_${response.status}`);
  const payload=tokenPayload(d);if(d?.error||payload?.error)throw new Error("oauth_token_exchange_rejected");
  const token=String(payload.access_token??"");if(!token)throw new Error("oauth_access_token_missing");
  const id=randomUUID(),secret=`${p.provider}.oauth.access.${id}`;this.getVault().set(secret,token);this.syncProviderToken(p.provider,token);
  let refreshSecret:string|undefined;if(payload.refresh_token){refreshSecret=`${p.provider}.oauth.refresh.${id}`;this.getVault().set(refreshSecret,String(payload.refresh_token));}
  const responseScopes=Array.isArray(payload.scope)?payload.scope:typeof payload.scope==="string"?payload.scope.split(/[ ,]+/).filter(Boolean):c.scopes;
  const connection:OAuthConnection={id,provider:p.provider,accountId:p.accountId,scopes:responseScopes,tokenSecret:secret,refreshTokenSecret:refreshSecret,expiresAt:typeof payload.expires_in==="number"?new Date(Date.now()+payload.expires_in*1000).toISOString():undefined,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  this.connections=this.connections.filter(x=>!(x.provider===connection.provider&&x.accountId===connection.accountId));this.connections.push(connection);this.persist();
  return connection;
 }
 async token(connection:OAuthConnection){
  const value=this.getVault().get(connection.tokenSecret);
  if(value&&(!connection.expiresAt||Date.parse(connection.expiresAt)>Date.now()+60_000))return value;
  if(!connection.refreshTokenSecret)throw new Error("oauth_access_token_expired");
  const refresh=this.getVault().get(connection.refreshTokenSecret);if(!refresh)throw new Error("oauth_refresh_token_missing");
  const c=this.config(connection.provider);const form=new URLSearchParams({[connection.provider==="tiktok"?"client_key":"client_id"]:c.clientId,refresh_token:refresh,grant_type:"refresh_token"});if(c.clientSecret&&c.clientId&&connection.provider!=="pinterest")form.set("client_secret",c.clientSecret);const headers:Record<string,string>={"content-type":"application/x-www-form-urlencoded"};if(connection.provider==="pinterest"&&c.clientSecret)headers.Authorization=`Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`;
  const response=await fetch(c.token,{method:"POST",headers,body:form,signal:AbortSignal.timeout(15_000)});const raw=await response.text();let d:any={};try{d=JSON.parse(raw);}catch{d={raw}}if(!response.ok)throw new Error(`oauth_refresh_${response.status}`);
  const payload=tokenPayload(d);if(d?.error||payload?.error)throw new Error("oauth_refresh_rejected");
  const access=String(payload.access_token??"");if(!access)throw new Error("oauth_access_token_missing");
  this.getVault().set(connection.tokenSecret,access);this.syncProviderToken(connection.provider,access);connection.expiresAt=typeof payload.expires_in==="number"?new Date(Date.now()+payload.expires_in*1000).toISOString():undefined;connection.updatedAt=new Date().toISOString();
  if(payload.refresh_token&&connection.refreshTokenSecret)this.getVault().set(connection.refreshTokenSecret,String(payload.refresh_token));this.persist();return access;
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
  const get=async(url:string,extra:Record<string,string>={})=>{const r=await fetch(url,{headers:{...headers,...extra}});const t=await r.text();let d:any={};try{d=t?JSON.parse(t):{}}catch{d={raw:t}}if(!r.ok)throw new Error(`oauth_ads_discovery_http_${r.status}`);return d;};
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
 status(connection:OAuthConnection){return {id:connection.id,provider:connection.provider,accountId:connection.accountId,accountName:connection.accountName,scopes:connection.scopes,expiresAt:connection.expiresAt,configured:true};}
}
