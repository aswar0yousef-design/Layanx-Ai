import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {QuranPublicationLedger} from "../src/quran/pipeline.js";
const dir=mkdtempSync(join(tmpdir(),"layanx-quran-ledger-"));const ledger=new QuranPublicationLedger(join(dir,"ledger.json"));
const entry={surah:1,fromAyah:1,toAyah:5,durationSec:42,publicationIds:["yt","tt"],publishedAt:new Date().toISOString(),recitationId:7,videoPath:"/tmp/video.mp4",platforms:["youtube","tiktok"],idempotencyKey:"abc"};
assert.equal(ledger.add(entry),true);assert.equal(ledger.add(entry),false);assert.equal(ledger.has("abc"),true);assert.equal(ledger.list().length,1);
rmSync(dir,{recursive:true,force:true});console.log("quran ledger: ok");