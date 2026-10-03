import {randomBytes,createHash,randomUUID} from "node:crypto";
import {localSecret,LocalSecretVault} from "../security/local-secret-vault.js";
import type {OAuthProvider,OAuthConnection} from "./types.js";
interface OAuthConfig{authorize:string;token:string;clientId:string;clientSecret?:string;redirectUri:string;scopes:string[];usePkce?:boolean;extra?:Record<string,string>;}
interface Pending{provider:OAuthProvider;state:string;codeVerifier?:string;createdAt:number;redirectUri:string;}
const env=(p:string,k:string)=>process.env[`LAYANX_${p}_OAUTH_${k}`];
const PROVIDER_DEFAULTS:Partial<Record<OAuthProvider,Partial<OAuthConfig>>>={
 tiktok:{authorize:"https://www.tiktok.com/v2/auth/authorize/",token:"https://open.tiktokapis.com/v2/oauth/token/",usePkce:false},
 google:{authorize:"https://accounts.google.com/o/oauth2/v2/auth",token:"https://oauth2.googleapis.com/token"},
 linkedin:{authorize:"https://www.linkedin.com/oauth/v2/authorization",token:"https://www.linkedin.com/oauth/v2/accessToken"},
};
export class OAuthConnectionCenter{
 private readonly vault=new LocalSecretVault();
 private readonly pending=new Map<string,Pending>();
 constructor(private readonly storageKey="oauth:connections"){}
 private config(provider:OAuthProvider):OAuthConfig{
  const p=provider.toUpperCase(),d=PROVIDER_DEFAULTS[provider]??{};
  const clientId=env(p,"CLIENT_ID")??"";const clientSecret=localSecret(`${provider}.oauth.client_secret`,env(p,"CLIENT_SECRET"));
  const redirectUri=env(p,"REDIRECT_URI")??process.env.LAYANX_OAUTH_REDIRECT_URI??"";
  const authorize=env(p,"AUTHORIZE_URL")??d.authorize??"";const token=env(p,"TOKEN_URL")??d.token??"";
  const scopes=(env(p,"SCOPES")??(provider==="google"?"https://www.googleapis.com/auth/adwords":"user.info.basic")).split(/[ ,]+/).filter(Boolean);
  if(!clientId||!redirectUri||!authorize||!token)throw new Error(`oauth_${provider}_not_configured`);
  return {authorize,token,clientId,clientSecret,redirectUri,scopes,usePkce:provider==="tiktok"||env(p,"USE_PKCE")==="true",extra:env(p,"EXTRA_JSON")?JSON.parse(env(p,"EXTRA_JSON")!):undefined};
 }
 begin(provider:OAuthProvider,accountId="default"){
  const c=this.config(provider),state=randomBytes(32).toString("base64url");const pending:Pending={provider,state,createdAt:Date.now(),redirectUri:c.redirectUri};
  if(c.usePkce){const verifier=randomBytes(48).toString("base64url");pending.codeVerifier=verifier;}
  this.pending.set(state,pending);
  const u=new URL(c.authorize);u.searchParams.set("client_id",c.clientId);u.searchParams.set("response_type","code");u.searchParams.set("redirect_uri",c.redirectUri);u.searchParams.set("scope",c.scopes.join(" "));u.searchParams.set("state",state);
  if(pending.codeVerifier){u.searchParams.set("code_challenge",createHash("sha256").update(pending.codeVerifier).digest("base64url"));u.searchParams.set("code_challenge_method","S256");}
  for(const [k,v] of Object.entries(c.extra??{}))u.searchParams.set(k,v);
  return {authorizationUrl:u.toString(),state,accountId};
 }
 async callback(state:string,code:string,accountId="default"){
  const p=this.pending.get(state);if(!p||Date.now()-p.createdAt>10*60_000){this.pending.delete(state);throw new Error("oauth_state_invalid_or_expired");}
  this.pending.delete(state);const c=this.config(p.provider);
  const form=new URLSearchParams({client_id:c.clientId,code,grant_type:"authorization_code",redirect_uri:p.redirectUri});if(c.clientSecret)form.set("client_secret",c.clientSecret);if(p.codeVerifier)form.set("code_verifier",p.codeVerifier);
  const response=await fetch(c.token,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:form});const raw=await response.text();let d:any={};try{d=JSON.parse(raw);}catch{d={raw};}if(!response.ok)throw new Error(`oauth_token_exchange_${response.status}`);
  const token=String(d.access_token??"");if(!token)throw new Error("oauth_access_token_missing");
  const id=randomUUID(),secret=`${p.provider}.oauth.access.${id}`;this.vault.set(secret,token);
  let refreshSecret:string|undefined;if(d.refresh_token){refreshSecret=`${p.provider}.oauth.refresh.${id}`;this.vault.set(refreshSecret,String(d.refresh_token));}
  const connection:OAuthConnection={id,provider:p.provider,accountId,scopes:typeof d.scope==="string"?d.scope.split(/[ ,]+/).filter(Boolean):c.scopes,tokenSecret:secret,refreshTokenSecret:refreshSecret,expiresAt:typeof d.expires_in==="number"?new Date(Date.now()+d.expires_in*1000).toISOString():undefined,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  return connection;
 }
 token(connection:OAuthConnection){const value=this.vault.get(connection.tokenSecret);if(!value)throw new Error("oauth_access_token_missing");return value;}
 revoke(connection:OAuthConnection){this.vault.delete(connection.tokenSecret);if(connection.refreshTokenSecret)this.vault.delete(connection.refreshTokenSecret);}
 status(connection:OAuthConnection){return {id:connection.id,provider:connection.provider,accountId:connection.accountId,scopes:connection.scopes,expiresAt:connection.expiresAt,configured:true};}
}
