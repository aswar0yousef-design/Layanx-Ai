import type {ToolAdapter} from "../tools/executor.js";
import type {ToolRequest} from "../core/types.js";
type R=Record<string,unknown>;
function rec(r:ToolRequest):R{return r.payload&&typeof r.payload==="object"&&!Array.isArray(r.payload)?r.payload as R:{}}
function s(v:unknown,n:string){if(typeof v!=="string"||!v.trim())throw new Error(n+" is required.");return v.trim()}
function b64url(v:string){return Buffer.from(v).toString("base64url")}
export interface YahooMailOptions{accessToken?:string;clientId?:string;clientSecret?:string;refreshToken?:string;email?:string;fetcher?:typeof fetch}
export function createYahooMailAdapter(o:YahooMailOptions={}):ToolAdapter{
 const f=o.fetcher??fetch;let cached:{token:string;expiresAt:number;refresh?:string}|undefined;
 async function token(){if(o.accessToken)return o.accessToken;if(cached&&cached.expiresAt>Date.now()+60000)return cached.token;if(!o.clientId||!o.clientSecret||!o.refreshToken)throw new Error("Yahoo OAuth is not configured. Set YAHOO_ACCESS_TOKEN or YAHOO_CLIENT_ID/YAHOO_CLIENT_SECRET/YAHOO_REFRESH_TOKEN.");
  const auth=Buffer.from(o.clientId+":"+o.clientSecret).toString("base64");const body=new URLSearchParams({client_id:o.clientId,client_secret:o.clientSecret,redirect_uri:process.env.YAHOO_OAUTH_REDIRECT_URI??"oob",refresh_token:cached?.refresh??o.refreshToken,grant_type:"refresh_token"});
  const r=await f("https://api.login.yahoo.com/oauth2/get_token",{method:"POST",headers:{authorization:"Basic "+auth,"content-type":"application/x-www-form-urlencoded"},body});const t=await r.text();if(!r.ok)throw new Error("Yahoo OAuth refresh failed ("+r.status+").");const j=JSON.parse(t) as {access_token?:string;refresh_token?:string;expires_in?:number};if(!j.access_token)throw new Error("Yahoo OAuth response did not contain an access token.");cached={token:j.access_token,refresh:j.refresh_token??cached?.refresh,expiresAt:Date.now()+(j.expires_in??3600)*1000};return cached.token}
 async function api(path:string,init:RequestInit={}){const r=await f("https://api.login.yahoo.com"+path,{...init,redirect:"error",headers:{accept:"application/json",authorization:"Bearer "+await token(),...(init.headers??{})}});const t=await r.text();if(!r.ok)throw new Error("Yahoo Mail API request failed ("+r.status+").");return t?JSON.parse(t):{ok:true,status:r.status}}
 async function mail(path:string,init:RequestInit={}){const account=s(o.email??process.env.YAHOO_EMAIL,"YAHOO_EMAIL");const r=await f("https://mail.yahooapis.com"+path,{...init,redirect:"error",headers:{accept:"application/json",authorization:"Bearer "+await token(),...(init.headers??{})}});const t=await r.text();if(!r.ok)throw new Error("Yahoo Mail request failed ("+r.status+").");return t?JSON.parse(t):{ok:true,status:r.status}}
 return {async execute(req){const i=rec(req),a=req.action.toLowerCase();
  if(a==="search yahoo mail")return mail("/v1/"+encodeURIComponent(s(o.email??process.env.YAHOO_EMAIL,"YAHOO_EMAIL"))+"/search?query="+encodeURIComponent(typeof i.query==="string"?i.query:"")+"&limit="+String(typeof i.limit==="number"?Math.min(Math.max(i.limit,1),50):20));
  if(a==="read yahoo mail")return mail("/v1/"+encodeURIComponent(s(o.email??process.env.YAHOO_EMAIL,"YAHOO_EMAIL"))+"/messages/"+encodeURIComponent(s(i.messageId,"messageId")));
  if(a==="send yahoo mail"){const to=s(i.to,"to"),subject=s(i.subject,"subject"),body=s(i.body,"body");return mail("/v1/"+encodeURIComponent(s(o.email??process.env.YAHOO_EMAIL,"YAHOO_EMAIL"))+"/send",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({to:[to],subject,body})})}
  throw new Error("Unsupported Yahoo Mail action.");
 }}
}