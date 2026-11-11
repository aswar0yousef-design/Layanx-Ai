import assert from "node:assert/strict";
import {MAX_SEGMENT_CHARS,cleanForSpeech,splitForSpeech} from "../src/voice/speech-text.js";

const words=(text:string)=>text.split(/\s+/).filter(Boolean);
const said=(text:string,lang?:string)=>words(splitForSpeech(text,lang).map(s=>s.text).join(" "));

// Marks that only make sense on screen are not read out; the words around them are.
assert.equal(cleanForSpeech("**مهم** جداً ✅"),"مهم جداً");
assert.equal(cleanForSpeech("# Title\n- first item\n1. second item"),"Title\nfirst item\nsecond item");
assert.equal(cleanForSpeech("افتح [الصفحة](https://example.com/x) ثم https://example.com/y تابع"),"افتح الصفحة ثم تابع");
assert.equal(cleanForSpeech("قبل\n```js\nconst a=1;\n```\nبعد"),"قبل\nبعد");
assert.equal(cleanForSpeech("snake_case_name stays"),"snake_case_name stays");
assert.equal(cleanForSpeech("use `npm test` now"),"use npm test now");

// Every sentence becomes its own part, in order.
assert.deepEqual(splitForSpeech("الجملة الأولى هنا. الجملة الثانية هنا؟ الجملة الثالثة هنا!","ar").map(s=>s.text),["الجملة الأولى هنا.","الجملة الثانية هنا؟","الجملة الثالثة هنا!"]);
assert.deepEqual(splitForSpeech("The price is 3.5 dollars today. Dr. Ali agreed with that.","en").map(s=>s.text),["The price is 3.5 dollars today.","Dr. Ali agreed with that."]);

// Long text: nothing is lost, and no part is over the limit. This is the case that used to stop part way.
const paragraph="هذه جملة طويلة تصف ما تم في المشروع، وما بقي منه، وكيف سيتم التحقق منه خطوة بعد خطوة دون تكرار. ".repeat(120);
const long=splitForSpeech(paragraph,"ar");
assert.ok(paragraph.length>10_000);
assert.ok(long.length>=100);
assert.ok(long.every(s=>s.text.length<=MAX_SEGMENT_CHARS));
assert.deepEqual(words(long.map(s=>s.text).join(" ")),words(paragraph));

// One sentence longer than the limit, with and without commas, breaks between words.
const noCommas=Array.from({length:120},(_,i)=>"word"+i).join(" ");
assert.deepEqual(said(noCommas,"en"),words(noCommas));
assert.ok(splitForSpeech(noCommas,"en").every(s=>s.text.length<=MAX_SEGMENT_CHARS));
const noSpaces="x".repeat(500);
assert.equal(splitForSpeech(noSpaces,"en").map(s=>s.text).join(""),noSpaces);

// A sentence is read by the voice of its own language, wherever the page language is set.
assert.deepEqual(splitForSpeech("This sentence is written in English. وهذه الجملة مكتوبة بالعربية.","ar").map(s=>s.lang),["en","ar"]);
// A product name inside a sentence does not break it into two voices.
assert.deepEqual(splitForSpeech("افتح برنامج LayanX الآن من فضلك","ar").map(s=>[s.lang,s.text]),[["ar","افتح برنامج LayanX الآن من فضلك"]]);
// A full English phrase inside an Arabic sentence is read in English, and every word stays in order.
const mixed="قال المهندس إن النتيجة كانت the build finished without errors وهذا ما توقعناه تماماً";
const parts=splitForSpeech(mixed,"ar");
assert.deepEqual(parts.map(s=>s.lang),["ar","en","ar"]);
assert.deepEqual(words(parts.map(s=>s.text).join(" ")),words(mixed));

// Numbers alone follow the page language.
assert.equal(splitForSpeech("123","en")[0]!.lang,"en");
assert.equal(splitForSpeech("123","ar")[0]!.lang,"ar");

// A one-word sentence is said together with the next instead of sounding clipped.
assert.deepEqual(splitForSpeech("نعم. سأبدأ العمل على هذا الطلب الآن.","ar").map(s=>s.text),["نعم. سأبدأ العمل على هذا الطلب الآن."]);

// Pauses fall at sentence ends, and the last part leaves none behind.
const paused=splitForSpeech("جملة أولى كاملة هنا. جملة ثانية كاملة هنا.\nفقرة جديدة كاملة هنا.","ar");
assert.deepEqual(paused.map(s=>s.pauseMs),[140,240,0]);

assert.deepEqual(splitForSpeech("   \n  "),[]);
assert.deepEqual(splitForSpeech("✅ 🎉"),[]);
console.log("speech-text: cleaning, sentence splitting, language runs and pauses verified");
