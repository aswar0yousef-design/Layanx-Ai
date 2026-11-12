import assert from "node:assert/strict";
import fs from "node:fs";
import {arabicLetters,pdfPageImages,pdfText,readPdfAttachment} from "../src/business/pdf-text.js";

const pdf=(name:string)=>fs.readFileSync(new URL("./fixtures/pdf/"+name,import.meta.url));
// An English invoice PDF made by Chromium: its text, line by line.
const dhl=await pdfText(pdf("dhl-invoice.pdf"));
assert.match(dhl.text,/Invoice Number DHL-2026-88417/);assert.match(dhl.text,/Total Amount Due SAR 460\.00/);
// Arabic: pdf.js gives one glyph per item in presentation forms ("أرا ﻣ ﻜ ﺲ", seen 2026-11-13); read back as words.
const aramex=await pdfText(pdf("aramex-invoice.pdf"));
assert.match(aramex.text,/^أرامكس$/m);assert.match(aramex.text,/رقم الفاتورة ARX-90012/);assert.match(aramex.text,/الإجمالي المستحق 275\.50 ريال/);
assert.equal(arabicLetters("ﻓﺎﺗﻮ"),"فاتو");
// A scanned invoice has no text; its page is rendered to an image for the vision model.
assert.equal((await pdfText(pdf("smsa-scanned.pdf"))).text,"");
const [png]=await pdfPageImages(pdf("smsa-scanned.pdf"),1);
assert.equal(Buffer.from(png!,"base64").subarray(1,4).toString(),"PNG");
const seen=await readPdfAttachment(pdf("smsa-scanned.pdf"),async()=>"Invoice No SM-30566\nGrand Total SAR 1,830.25");
assert.deepEqual([seen.source,seen.text.includes("SM-30566")],["image",true]);
assert.equal((await readPdfAttachment(pdf("smsa-scanned.pdf"))).source,"none","no vision model: said so, nothing guessed");
await assert.rejects(pdfText(Buffer.from("<html>not a pdf</html>")),/not a PDF/);
console.log("pdf-text: text PDFs (English and Arabic) read, scanned pages rendered for the vision model");
