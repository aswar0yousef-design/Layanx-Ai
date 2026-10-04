import assert from "node:assert/strict";
import {QuranRenderer} from "../src/quran/renderer.js";
const renderer=new QuranRenderer("definitely-not-ffmpeg");
const segment={surah:1,fromAyah:1,toAyah:1,durationSec:20,verses:[{surah:1,ayah:1,arabic:"آية",recitationDurationSec:20}]};
await assert.rejects(()=>renderer.render(segment,{outputPath:"/tmp/quran.mp4"}),/duration_out_of_range/);
console.log("quran renderer guard: ok");