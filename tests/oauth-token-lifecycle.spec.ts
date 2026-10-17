import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {OAuthConnectionCenter} from "../src/business/oauth.js";

const dir=mkdtempSync(join(tmpdir(),"layanx-oauth-token-"));
process.env.LAYANX_SECRET_VAULT_KEY="oauth-token-test-key-32-chars-minimum";
process.env.LAYANX_SECRET_VAULT_PATH=join(dir,"vault");
process.env.LAYANX_OAUTH_CONNECTIONS_PATH=join(dir,"connections.json");
process.env.LAYANX_X_OAUTH_CLIENT_ID="x-test";
process.env.LAYANX_X_OAUTH_CLIENT_SECRET="x-secret";
process.env.LAYANX_X_OAUTH_REDIRECT_URI="http://127.0.0.1/callback";
process.env.LAYANX_X_OAUTH_AUTHORIZE_URL="https://example.test/authorize";
process.env.LAYANX_X_OAUTH_TOKEN_URL="https://example.test/token";
process.env.LAYANX_X_OAUTH_SCOPES="tweet.read users.read";

const original=globalThis.fetch;
globalThis.fetch=(async(url,init)=>{
 if(String(url)==="https://example.test/token"){
  assert.equal(init?.method,"POST");const headers=init?.headers as Record<string,string>;assert.equal(headers.Authorization,"Basic "+Buffer.from("x-test:x-secret").toString("base64"));
  const form=new URLSearchParams(String(init?.body));assert.equal(form.get("client_id"),null);assert.equal(form.get("client_secret"),null);assert.ok(form.get("code_verifier"));
  return new Response(JSON.stringify({access_token:"x-token"}),{status:200});
 }
 throw new Error("unexpected_fetch:"+String(url));
}) as typeof fetch;

const center=new OAuthConnectionCenter();
const started=center.begin("x");const authorize=new URL(started.authorizationUrl);assert.equal(authorize.searchParams.get("code_challenge_method"),"S256");assert.ok(authorize.searchParams.get("code_challenge"));
const connection=await center.callback(started.state,"code");
const first=await center.token(connection);
const second=await center.token(connection);
assert.equal(first,"x-token");
assert.equal(second,"x-token");

globalThis.fetch=original;
rmSync(dir,{recursive:true,force:true});
console.log("oauth non-expiring token lifecycle: ok");
