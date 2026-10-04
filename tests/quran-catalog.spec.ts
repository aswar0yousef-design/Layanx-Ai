import assert from "node:assert/strict";
import {QURAN_AUXILIARY_SOURCES,assertAuxiliarySourceUsable,getQuranAuxiliarySource} from "../src/quran/catalog.js";

const qud=getQuranAuxiliarySource("qud-universal-audio");
assert.equal(qud?.license,"CC BY 4.0");
assert.equal(qud?.commercialUse,true);
assert.equal(qud?.audioRightsSeparate,true);
assert.equal(assertAuxiliarySourceUsable("qud-universal-audio","timing").id,"qud-universal-audio");
assert.throws(()=>assertAuxiliarySourceUsable("qud-universal-audio","audio"),/kind_mismatch/);
assert.throws(()=>assertAuxiliarySourceUsable("missing","timing"),/source_unknown/);
assert.equal(QURAN_AUXILIARY_SOURCES.some(x=>x.id==="mushaf-learning-quran-audio"&&x.status==="granted"),true);
console.log("quran catalog: ok");
