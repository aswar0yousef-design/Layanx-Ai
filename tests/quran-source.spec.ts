import assert from "node:assert/strict";
import {QuranFoundationSource} from "../src/quran/source.js";
let calls=0;
const mock=async (input:RequestInfo|URL,init?:RequestInit)=>{calls++;const url=String(input);if(url.includes("/oauth2/token"))return new Response(JSON.stringify({access_token:"tok",expires_in:3600}),{status:200});if(url.includes("/verses/by_chapter/1"))return new Response(JSON.stringify({verses:[{verse_number:1,verse_key:"1:1",text_uthmani:"بِسْمِ ٱللَّهِ",audio:{url:"https://audio.test/1.mp3"},translations:[{text:"In the name"}]}],pagination:{next_page:null}}),{status:200});throw new Error("unexpected_request");};
const source=new QuranFoundationSource({clientId:"id",clientSecret:"secret",environment:"production",recitationId:7,translationId:131},mock as typeof fetch);
const verses=await source.chapter(1);assert.equal(verses[0].arabic,"بِسْمِ ٱللَّهِ");assert.equal(verses[0].audioUrl,"https://audio.test/1.mp3");assert.equal(verses[0].translation,"In the name");assert.ok(calls>=2);
console.log("quran source: ok");