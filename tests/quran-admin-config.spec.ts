import {strict as assert} from "node:assert";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

const root=await mkdtemp(join(tmpdir(),"layanx-quran-admin-"));
process.env.LAYANX_SECRET_VAULT_KEY="quran-admin-test-master-key-2026";
process.env.LAYANX_SECRET_VAULT_PATH=join(root,"secrets.vault");
process.env.LAYANX_QURAN_ADMIN_SETTINGS_PATH=join(root,"quran-admin.json");
const {QuranAdminConfigStore}=await import("../src/quran/admin-config.js");
const store=new QuranAdminConfigStore();
const saved=store.save({
 clientId:"client-123456",
 clientSecret:"secret-abcdef",
 environment:"production",
 recitationId:7,
 platforms:["youtube","tiktok","youtube"],
 reciterName:"Test Reciter",
 reciterCredit:"Recitation: Test Reciter",
 youtubeConnectionId:"yt-1",
 tiktokConnectionId:"tt-1"
});
assert.equal(saved.credentialsConfigured,true);
assert.equal(saved.clientIdMasked,"clie…3456");
assert.deepEqual(saved.platforms,["youtube","tiktok"]);
const cfg=store.config();
assert.equal(cfg.clientId,"client-123456");
assert.equal(cfg.clientSecret,"secret-abcdef");
assert.equal(cfg.recitationId,7);
assert.equal(cfg.environment,"production");
const masked=store.get();
assert.equal((masked as any).clientSecret,undefined);
store.clearCredentials();
assert.equal(store.get().credentialsConfigured,false);
await rm(root,{recursive:true,force:true});
console.log("quran-admin-config: ok");
