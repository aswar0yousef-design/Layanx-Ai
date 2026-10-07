import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {applySecretsToEnv,ensureGeneratedSecret,openSecretStore,type PowerShellRunner} from "../src/security/secret-store.js";
import {AccessManager,hashToken} from "../src/security/access.js";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-sec-"));

// ---------- file backend (non-Windows default)
const store=await openSecretStore(dir,{backend:"file"});
await store.set("OPENAI_API_KEY","sk-test-123");
await store.set("LAYANX_SHOPIFY_ACCESS_TOKEN","shpat_abc");
const onDisk=fs.readFileSync(path.join(dir,"secrets.enc"),"utf8");
assert.ok(!onDisk.includes("sk-test-123"),"secret must not be stored in plain text");
if(process.platform!=="win32")assert.equal(fs.statSync(path.join(dir,"secrets.enc.key")).mode&0o777,0o600);
const reopened=await openSecretStore(dir,{backend:"file"});
assert.equal(reopened.get("OPENAI_API_KEY"),"sk-test-123");
assert.deepEqual(reopened.names(),["LAYANX_SHOPIFY_ACCESS_TOKEN","OPENAI_API_KEY"]);
assert.equal(await reopened.delete("LAYANX_SHOPIFY_ACCESS_TOKEN"),true);
assert.equal((await openSecretStore(dir,{backend:"file"})).get("LAYANX_SHOPIFY_ACCESS_TOKEN"),undefined);
await assert.rejects(store.set("bad-name","x"));
await assert.rejects(store.set("GOOD_NAME",""));

// tampering is detected (GCM auth tag)
const box=JSON.parse(fs.readFileSync(path.join(dir,"secrets.enc"),"utf8"));
box.data=Buffer.from("tampered").toString("base64");
fs.writeFileSync(path.join(dir,"secrets.enc"),JSON.stringify(box));
await assert.rejects(openSecretStore(dir,{backend:"file"}));

// env precedence: explicit environment wins over the store
const envDir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-env-"));
const envStore=await openSecretStore(envDir,{backend:"file"});
await envStore.set("A_KEY","from-store");
await envStore.set("B_KEY","from-store");
const env:NodeJS.ProcessEnv={A_KEY:"from-env"};
assert.deepEqual(applySecretsToEnv(envStore,env),["B_KEY"]);
assert.equal(env.A_KEY,"from-env");
const token=await ensureGeneratedSecret(envStore,"LAYANX_API_TOKEN","lxm_");
assert.match(token,/^lxm_[\w-]{43}$/);
assert.equal(await ensureGeneratedSecret(envStore,"LAYANX_API_TOKEN","lxm_"),token,"generated once, then stable");

// ---------- DPAPI backend code path with a fake PowerShell (real DPAPI only exists on Windows)
const calls:string[]=[];
const fakePs:PowerShellRunner=async(script,stdin)=>{
  calls.push(script.includes("::Protect(")?"protect":"unprotect");
  assert.ok(!script.includes("sk-"),"secret values must travel on stdin, never in the script/argv");
  const flipped=Buffer.from(stdin,"base64").reverse().toString("base64");
  return flipped;
};
const dpDir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-dp-"));
const dp=await openSecretStore(dpDir,{backend:"dpapi",powershell:fakePs});
await dp.set("OPENAI_API_KEY","sk-dpapi");
assert.ok(fs.existsSync(path.join(dpDir,"secrets.dpapi")));
const dp2=await openSecretStore(dpDir,{backend:"dpapi",powershell:fakePs});
assert.equal(dp2.get("OPENAI_API_KEY"),"sk-dpapi");
assert.deepEqual(calls,["protect","unprotect"]);
assert.equal(dp2.backend,"dpapi");

// ---------- access manager
let now=1_000_000;
const accessDir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-acc-"));
const files={devicesFile:path.join(accessDir,"devices.json"),launchTicketFile:path.join(accessDir,"ticket.json"),sessionsFile:path.join(accessDir,"sessions.json")};
const access=new AccessManager({...files,masterToken:"lxm_master",now:()=>now});
assert.equal(access.isMasterToken("lxm_master"),true);
assert.equal(access.isMasterToken("lxm_other"),false);

// launch ticket -> session (single use, expires)
access.issueLaunchTicket();
const ticket=JSON.parse(fs.readFileSync(files.launchTicketFile,"utf8")) as {code:string};
const session=access.exchangeLaunchTicket(ticket.code);
assert.ok(session&&session.startsWith("lxs_"));
assert.equal(access.exchangeLaunchTicket(ticket.code),null,"launch ticket is single-use");
assert.equal(access.verifySession(session!),true);
assert.ok(!fs.readFileSync(files.sessionsFile,"utf8").includes(session!),"only session hashes are persisted");
const afterRestart=new AccessManager({...files,masterToken:"lxm_master",now:()=>now});
assert.equal(afterRestart.verifySession(session!),true,"session survives restart");
access.issueLaunchTicket();
const late=JSON.parse(fs.readFileSync(files.launchTicketFile,"utf8")) as {code:string};
now+=3*60_000;
assert.equal(access.exchangeLaunchTicket(late.code),null,"expired ticket rejected");

// pairing
const p=access.startPairing();
assert.match(p.code,/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
const wrong=access.completePairing("AAAA-AAAA","x","1.2.3.4");
assert.equal(wrong.ok,false);
const good=access.completePairing(p.code.toLowerCase(),"Ahmed's Phone <script>","1.2.3.4");
assert.ok(good.ok);
if(!good.ok)throw new Error("unreachable");
assert.ok(good.deviceToken.startsWith("lxd_"));
assert.equal(access.completePairing(p.code,"again","1.2.3.4").ok,false,"code is single use");
const device=access.verifyDeviceToken(good.deviceToken);
assert.equal(device?.name,"Ahmed's Phone script");
const stored=fs.readFileSync(files.devicesFile,"utf8");
assert.ok(!stored.includes(good.deviceToken)&&stored.includes(hashToken(good.deviceToken)),"device tokens stored as hashes only");
assert.equal(access.verifyDeviceToken("lxd_forged"),null);
assert.equal(access.revokeDevice(good.deviceId),true);
assert.equal(access.verifyDeviceToken(good.deviceToken),null,"revoked device is rejected");

// brute force: 5 wrong guesses kill the code; 10 attempts per address per window
const p2=access.startPairing();
for(let i=0;i<5;i++)access.completePairing("ZZZZ-ZZZZ","x","5.6.7.8");
const afterLockout=access.completePairing(p2.code,"x","5.6.7.8");
assert.equal(afterLockout.ok,false);
if(!afterLockout.ok)assert.equal(afterLockout.status,410,"code invalidated after 5 failures");
for(let i=0;i<10;i++)access.completePairing("ZZZZ-ZZZZ","x","9.9.9.9");
const limited=access.completePairing("ZZZZ-ZZZZ","x","9.9.9.9");
if(!limited.ok)assert.equal(limited.status,429);

// two installations never accept each other's tokens
const other=new AccessManager({devicesFile:path.join(accessDir,"other-devices.json"),launchTicketFile:path.join(accessDir,"other-ticket.json"),masterToken:"lxm_other_install"});
const p3=access.startPairing();
const mine=access.completePairing(p3.code,"phone","1.1.1.1");
if(!mine.ok)throw new Error("pairing failed");
assert.equal(other.verifyDeviceToken(mine.deviceToken),null);
assert.equal(other.isMasterToken("lxm_master"),false);

console.log("local-security: all assertions passed");
