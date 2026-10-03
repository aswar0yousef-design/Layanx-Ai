import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {OAuthConnectionCenter} from "../src/business/oauth.js";

const dir=mkdtempSync(join(tmpdir(),"layanx-oauth-discovery-"));
process.env.LAYANX_SECRET_VAULT_KEY="oauth-discovery-test-key-32-chars-minimum";
process.env.LAYANX_SECRET_VAULT_PATH=join(dir,"vault");
process.env.LAYANX_OAUTH_CONNECTIONS_PATH=join(dir,"connections.json");
process.env.LAYANX_META_OAUTH_CLIENT_ID="meta-test";
process.env.LAYANX_META_OAUTH_CLIENT_SECRET="meta-secret";
process.env.LAYANX_META_OAUTH_REDIRECT_URI="http://127.0.0.1/callback";
process.env.LAYANX_META_OAUTH_SCOPES="pages_show_list,instagram_basic";

const original=globalThis.fetch;
globalThis.fetch=(async(url,init)=>{
 const u=String(url);
 if(u.includes("/oauth/access_token")){
  return new Response(JSON.stringify({access_token:"user-token",expires_in:3600,scope:"pages_show_list instagram_basic"}),{status:200});
 }
 if(u.includes("/me/accounts")){
  return new Response(JSON.stringify({data:[{id:"page-1",name:"Demo Page",access_token:"page-token",instagram_business_account:{id:"ig-1",username:"demo.ig"}}]}),{status:200});
 }
 throw new Error("unexpected_fetch:"+u);
}) as typeof fetch;

const center=new OAuthConnectionCenter();
const started=center.begin("meta","demo-project");
const connection=await center.callback(started.state,"auth-code");
assert.equal(connection.provider,"meta");
assert.equal(center.status(connection).configured,true);
const discovered=await center.discover(connection.id) as any;
assert.equal(discovered.accounts.length,2);
assert.deepEqual(discovered.accounts.map((x:any)=>x.externalId),["page-1","ig-1"]);
assert.equal(discovered.accounts[0].platform,"facebook");
assert.equal(discovered.accounts[1].platform,"instagram");

globalThis.fetch=original;
rmSync(dir,{recursive:true,force:true});
console.log("oauth account discovery: ok");
