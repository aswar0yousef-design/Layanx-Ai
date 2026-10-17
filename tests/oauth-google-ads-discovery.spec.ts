import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {OAuthConnectionCenter} from "../src/business/oauth.js";

const dir=mkdtempSync(join(tmpdir(),"layanx-google-ads-oauth-"));
const old={key:process.env.LAYANX_SECRET_VAULT_KEY,path:process.env.LAYANX_SECRET_VAULT_PATH,connections:process.env.LAYANX_OAUTH_CONNECTIONS_PATH,dev:process.env.LAYANX_GOOGLE_ADS_DEVELOPER_TOKEN,client:process.env.LAYANX_GOOGLE_OAUTH_CLIENT_ID,secret:process.env.LAYANX_GOOGLE_OAUTH_CLIENT_SECRET,redirect:process.env.LAYANX_GOOGLE_OAUTH_REDIRECT_URI,token:process.env.LAYANX_GOOGLE_OAUTH_TOKEN_URL,authorize:process.env.LAYANX_GOOGLE_OAUTH_AUTHORIZE_URL};
process.env.LAYANX_SECRET_VAULT_KEY="google-ads-test-key-32-characters-long";
process.env.LAYANX_SECRET_VAULT_PATH=join(dir,"vault");
process.env.LAYANX_OAUTH_CONNECTIONS_PATH=join(dir,"connections.json");
process.env.LAYANX_GOOGLE_OAUTH_CLIENT_ID="google-client";
process.env.LAYANX_GOOGLE_OAUTH_CLIENT_SECRET="google-secret";
process.env.LAYANX_GOOGLE_OAUTH_REDIRECT_URI="http://127.0.0.1/callback";
process.env.LAYANX_GOOGLE_OAUTH_AUTHORIZE_URL="https://example.test/authorize";
process.env.LAYANX_GOOGLE_OAUTH_TOKEN_URL="https://example.test/token";
const original=globalThis.fetch;
globalThis.fetch=(async(url,init)=>{
 const target=String(url);
 if(target==="https://example.test/token")return new Response(JSON.stringify({access_token:"google-access",expires_in:3600,scope:"https://www.googleapis.com/auth/adwords"}),{status:200});
 if(target==="https://googleads.googleapis.com/v25/customers:listAccessibleCustomers"){
  const headers=init?.headers as Record<string,string>;
  assert.equal(headers.Authorization,"Bearer google-access");
  assert.equal(headers["developer-token"],"dev-token");
  assert.equal(headers["login-customer-id"],"1234567890");
  return new Response(JSON.stringify({resourceNames:["customers/123","customers/456"]}),{status:200});
 }
 throw new Error("unexpected_fetch:"+target);
}) as typeof fetch;
try{
 const center=new OAuthConnectionCenter();
 const started=center.begin("google");
 const connection=await center.callback(started.state,"google-code");
 delete process.env.LAYANX_GOOGLE_ADS_DEVELOPER_TOKEN;
 await assert.rejects(()=>center.discoverAds(connection.id),/google_ads_developer_token_required/);
 process.env.LAYANX_GOOGLE_ADS_DEVELOPER_TOKEN="dev-token";
 process.env.LAYANX_GOOGLE_ADS_LOGIN_CUSTOMER_ID="123-456-7890";
 const found=await center.discoverAds(connection.id);
 assert.deepEqual(found.accounts.map((x:any)=>x.externalId),["123","456"]);
}finally{
 globalThis.fetch=original;
 for(const [key,value] of Object.entries({LAYANX_SECRET_VAULT_KEY:old.key,LAYANX_SECRET_VAULT_PATH:old.path,LAYANX_OAUTH_CONNECTIONS_PATH:old.connections,LAYANX_GOOGLE_ADS_DEVELOPER_TOKEN:old.dev,LAYANX_GOOGLE_OAUTH_CLIENT_ID:old.client,LAYANX_GOOGLE_OAUTH_CLIENT_SECRET:old.secret,LAYANX_GOOGLE_OAUTH_REDIRECT_URI:old.redirect,LAYANX_GOOGLE_OAUTH_TOKEN_URL:old.token,LAYANX_GOOGLE_OAUTH_AUTHORIZE_URL:old.authorize})){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 rmSync(dir,{recursive:true,force:true});
}
console.log("Google Ads OAuth discovery requires developer token and sends required headers: ok");
