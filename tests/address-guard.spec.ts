import assert from "node:assert/strict";
import {assertPublicAddress,isPrivateAddress} from "../src/tools/http-read.js";

// A public-looking name that points at the owner's machine or network must not get through (found 2026-11-12).
for(const a of ["127.0.0.1","10.1.2.3","192.168.1.1","172.20.0.5","169.254.169.254","100.64.0.1","0.0.0.0","::1","fd00::1","fe80::1","::ffff:192.168.0.10"])assert.ok(isPrivateAddress(a),a);
for(const a of ["8.8.8.8","172.32.0.1","2001:4860:4860::8888"])assert.ok(!isPrivateAddress(a),a);
const fake=(answer:string[])=>async()=>answer.map(address=>({address}));
await assert.rejects(assertPublicAddress(new URL("http://looks-public.example/"),fake(["127.0.0.1"])),/Private or local/);
await assert.rejects(assertPublicAddress(new URL("http://mixed.example/"),fake(["93.184.216.34","10.0.0.1"])),/Private or local/,"one private answer is enough to refuse");
await assertPublicAddress(new URL("http://public.example/"),fake(["93.184.216.34"]));
await assert.rejects(assertPublicAddress(new URL("http://[::1]/")),/Private or local/);
await assert.rejects(assertPublicAddress(new URL("http://nowhere.invalid/"),async()=>{throw new Error("ENOTFOUND");}),/could not be resolved/);
console.log("address-guard: names are resolved and every private or local answer is refused");
