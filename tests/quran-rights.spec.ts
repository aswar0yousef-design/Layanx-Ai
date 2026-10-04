import assert from "node:assert/strict";
import {QuranRightsCatalog} from "../src/quran/rights.js";
const catalog=new QuranRightsCatalog();
assert.throws(()=>catalog.assertPublishable(7,["youtube","tiktok"]),/license_missing/);
catalog.register({recitationId:7,reciterName:"Test Reciter",status:"approved",allowedPlatforms:["youtube","tiktok"],allowsSocialVideo:true,proofUrl:"https://example.test/license",creditText:"Recitation: Test Reciter"});
assert.equal(catalog.assertPublishable(7,["youtube","tiktok"]).reciterName,"Test Reciter");
assert.throws(()=>catalog.assertPublishable(7,["instagram"]),/platform_not_permitted/);
console.log("quran rights: ok");