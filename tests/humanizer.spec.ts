import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.LAYANX_STORE_DIR=fs.mkdtempSync(path.join(os.tmpdir(),"lx-humanizer-"));
const H=await import("../src/business/humanizer.js");
const {cleanText,scanText,humanizeText,protectSpans,diffFacts,extractFacts,measureLength,saveVoice,loadVoice,humanizerMode,platformRule}=H;
const cp=(...codes:number[])=>String.fromCodePoint(...codes);
const ZWSP=cp(0x200B),ZWJ=cp(0x200D),ZWNJ=cp(0x200C),NNBSP=cp(0x202F),NBSP=cp(0xA0),LRI=cp(0x2066),PDI=cp(0x2069),RLO=cp(0x202E),RLM=cp(0x200F),VS16=cp(0xFE0F);
const check=(r:any,id:string)=>r.checks.find((c:any)=>c.id===id);

const AI_EN="In today's fast-paced digital landscape, our innovative coffee solutions seamlessly elevate your morning routine. Whether you're a busy professional or a student, our robust blend fosters productivity. Moreover, it's worth noting that our beans are crucial for a vibrant start. Not only do we deliver quality, but we also deliver passion. In conclusion, the future looks bright for coffee lovers everywhere.";
const HUMAN_EN="New beans landed Tuesday. Ethiopian Guji, washed, roasted on Monday night.\nTastes like peach tea when it cools. We're pulling it at 18g in, 40g out, 28 seconds.\n$4.50 a cup until Sunday. Come try it before the bag runs out.";
const AI_AR="في عالم اليوم المتسارع، لا شك أن القهوة تلعب دوراً محورياً في حياتنا اليومية. نقدم لكم تجربة فريدة من نوعها تجمع بين الجودة العالية والطعم الأصيل. تجدر الإشارة إلى أن منتجاتنا تتميز بمجموعة واسعة من النكهات المختلفة. ليس فقط نقدم القهوة، بل نقدم لكم أسلوب حياة متكامل. في الختام، ارتقِ بتجربتك مع قهوتنا اليوم!";
const HUMAN_AR="وصلتنا حبوب إثيوبية جديدة يوم الثلاثاء 🌿\nمحمصة ليلة الإثنين، طعمها قريب من الشاي بالخوخ لما تبرد.\nالكوب بـ 1.5 ريال لين الأحد.\nتعال جربها قبل ما تخلص الكيسة.";

// ---------- 1. clean: hidden traces go, everything a reader sees stays ----------
{
  const dirty=`Our new ${cp(0x405)}ummer menu${ZWSP}${ZWSP} is here! From 3${NNBSP}OMR${NBSP}today.${LRI}${PDI}${RLO}`;
  const c=cleanText(dirty,{platform:"instagram"});
  assert.equal(c.text,"Our new Summer menu is here! From 3 OMR today.");
  const kinds=Object.fromEntries(c.changes.map(x=>[x.kind,x.count]));
  assert.equal(kinds.hidden,2);assert.equal(kinds.bidi,3);assert.equal(kinds.lookalike,1);assert.equal(kinds.spaces,2);
  // emoji built with joiners, keycaps, tag flags and skin tones survive
  const emoji=`team 👨${ZWJ}💻 rainbow 🏳${VS16}${ZWJ}🌈 one 1${VS16}${cp(0x20E3)} england ${cp(0x1F3F4,0xE0067,0xE0062,0xE0065,0xE006E,0xE0067,0xE007F)} wave 👋🏽`;
  assert.equal(cleanText(emoji).text,emoji);
  // hidden "smuggled" text in tag characters and variation selectors is removed
  assert.equal(cleanText(`hi${cp(0xE0041,0xE0042)} there${cp(0xE0100)}`).text,"hi there");
  // a joiner between letters is a trace; ZWNJ inside Persian words is spelling and stays
  assert.equal(cleanText(`pay${ZWJ}pal`).text,"paypal");
  assert.equal(cleanText(`می${ZWNJ}خواهم`).text,`می${ZWNJ}خواهم`);
  assert.equal(cleanText(`ab${ZWNJ}cd`).text,"abcd");
  // Arabic direction marks are legitimate and kept
  assert.equal(cleanText(`السعر ${RLM}20 ريال`).text,`السعر ${RLM}20 ريال`);
  // presentation forms from PDFs become normal letters; ﷺ and ﴾﴿ stay as written
  assert.equal(cleanText(cp(0xFEE3,0xFEAE,0xFEA3,0xFE92,0xFE8E)).text,"مرحبا");
  assert.equal(cleanText("قال رسول الله "+cp(0xFDFA)).text,"قال رسول الله "+cp(0xFDFA));
  assert.equal(cleanText("SALE ５０％").text,"SALE 50%");
  // markdown: stripped where the platform shows it as symbols, kept on the website
  const md="## Big news\n**Order now** at [our shop](https://shop.example.com)\n* fast delivery";
  assert.equal(cleanText(md,{platform:"instagram"}).text,"Big news\nOrder now at our shop https://shop.example.com\n• fast delivery");
  assert.equal(cleanText(md,{platform:"web"}).text,md);
  assert.equal(cleanText("#عروض #خصم\n#1 in Oman",{platform:"instagram"}).text,"#عروض #خصم\n#1 in Oman","hashtags are not headings");
  // chatbot leftovers around the post, in English and Arabic
  assert.equal(cleanText("Sure! Here's a caption for your post:\n\nFresh croissants at 7am.\n\nI hope this helps! Let me know if you'd like another version.").text,"Fresh croissants at 7am.");
  assert.equal(cleanText("بالتأكيد! إليك منشوراً جذاباً لمتجرك:\nخصم 20٪ على كل العطور حتى الجمعة.\nهل تريد أن أكتب نسخة أخرى؟").text,"خصم 20٪ على كل العطور حتى الجمعة.");
  // …but a human first line that only starts the same way stays
  assert.equal(cleanText("Sure, we deliver on Fridays too.\nOrder by 5pm.").text,"Sure, we deliver on Fridays too.\nOrder by 5pm.");
  assert.equal(cleanText("Feel free to drop by after 6.").text,"Feel free to drop by after 6.","a one-line post is never emptied");
  assert.equal(cleanText("Free coffee today.\nFeel free to bring a friend!").text,"Free coffee today.\nFeel free to bring a friend!","an ordinary closing line stays");
}

// ---------- 2. the five checks: machine copy fails, people pass ----------
{
  const ai=scanText(AI_EN,{platform:"instagram"}),human=scanText(HUMAN_EN,{platform:"instagram"});
  assert.equal(ai.verdict,"fail");assert.equal(human.verdict,"pass");
  assert.ok(human.humanScore-ai.humanScore>=30,`${human.humanScore} vs ${ai.humanScore}`);
  assert.equal(check(ai,"slop").status,"fail");assert.equal(check(ai,"burstiness").status,"fail");assert.equal(check(ai,"specificity").status,"fail");
  assert.deepEqual(ai.checks.map((c:any)=>c.label),["BURSTINESS","SPECIFICITY","SLOP DENSITY","FINGERPRINT","VOICE","PLATFORM"]);
  assert.ok(ai.findings.some((f:any)=>f.text==="delve"||f.text==="seamless"));
  const aiAr=scanText(AI_AR,{platform:"instagram"}),humanAr=scanText(HUMAN_AR,{platform:"instagram"});
  assert.equal(aiAr.lang,"ar");assert.equal(aiAr.verdict,"fail");assert.equal(humanAr.verdict,"pass");
  const found=aiAr.findings.filter((f:any)=>f.check==="slop").map((f:any)=>f.text);
  for(const phrase of ["في عالم اليوم","لا شك ان","تجدر الاشاره","يلعب دورا محوريا","في الختام","تجربه فريده من نوعها","ليس فقط … بل"])assert.ok(found.includes(phrase),phrase+" found in "+found.join(","));
  assert.ok(aiAr.findings.some((f:any)=>f.check==="specificity"&&f.text==="مختلف"),"vague words match with Arabic endings (المختلفة)");
  // diacritics and alef forms do not hide a phrase
  assert.ok(scanText("ولا شكَّ أنَّ هذا المنتج رائع",{}).findings.some((f:any)=>f.text==="لا شك ان"));
  assert.ok(scanText("ارتقِ بتجربتك الآن",{}).findings.some((f:any)=>f.text==="ارتق ب"));
  // hidden characters are a FINGERPRINT failure
  assert.equal(check(scanText("Hello"+ZWSP+" world",{}),"fingerprint").status,"fail");
  // HTML: the visible text is checked
  const page=scanText("<html><head><style>.x{color:red}</style></head><body><h1>Unlock the power of seamless design</h1><p>We leverage cutting-edge tools.</p><script>var delve=1</script></body></html>",{platform:"web",format:"html"});
  assert.ok(page.findings.some((f:any)=>f.text==="leverage"));assert.ok(!page.findings.some((f:any)=>f.text==="delve"),"script is not copy");
}

// ---------- 3. platform rules ----------
{
  assert.equal(measureLength("hi https://example.com/a/very/long/path/that/goes/on","x"),3+23);
  assert.equal(measureLength("👨"+ZWJ+"💻","x"),2);
  assert.equal(measureLength("مرحبا","x"),5,"Arabic counts once on X");
  assert.equal(measureLength("مرحبا","bytes"),10);
  const tags=Array.from({length:6},(_,i)=>"#tag"+i).join(" ");
  assert.equal(check(scanText("Morning bake at 7. "+tags,{platform:"instagram"}),"platform").status,"fail","Instagram: at most 5 hashtags");
  assert.equal(check(scanText("Morning bake at 7. "+tags,{platform:"linkedin"}),"platform").status,"warn");
  assert.equal(check(scanText("x".repeat(281),{platform:"x"}),"platform").status,"fail");
  assert.equal(check(scanText("x".repeat(280),{platform:"x"}),"platform").status,"pass");
  assert.equal(check(scanText("ق".repeat(2600),{platform:"youtube"}),"platform").status,"fail","YouTube counts bytes");
  assert.equal(check(scanText("Plan your week in two taps, offline, with no account needed at all ever.",{platform:"app",kind:"store_short"}),"platform").status,"pass");
  assert.equal(check(scanText("Plan your week in two taps, offline, with no account needed, synced across devices, free.",{platform:"app",kind:"store_short"}),"platform").status,"fail","Google Play short description: 80");
  assert.equal(check(scanText("A".repeat(70),{platform:"web",kind:"title"}),"platform").status,"warn");
  assert.equal(check(scanText("Buy #now",{platform:"web",kind:"cta"}),"platform").status,"warn","no hashtags on a button");
  assert.equal(check(scanText("a ".repeat(600),{platform:"telegram"}),"platform").status,"warn","Telegram media captions stop at 1024");
  assert.equal(platformRule("youtube","title").max,100);
  assert.equal(scanText("hello",{platform:"nope" as any,kind:"weird" as any}).platform,"generic");
}

// ---------- 4. facts and protected passages ----------
{
  assert.deepEqual(diffFacts("السعر ١٫٥ ريال، اتصل +968 9123 4567","السعر 1.5 ريال واتصل على 96891234567"),[],"Arabic digits and a reformatted phone are the same facts");
  assert.deepEqual(diffFacts("Only $4.50 until Sunday, 20% off. @layanx #coffee https://x.example/a","Until Sunday it's $4.50, 20% off. @layanx #coffee https://x.example/a"),[]);
  const lost=diffFacts("Only $4.50 until Sunday, 20% off @layanx #coffee","Cheap until Sunday #Coffee");
  assert.deepEqual(lost.map(l=>l.value).sort(),["20","4.50","@layanx"].sort());
  assert.deepEqual(diffFacts("We serve 1,250 cups","We serve 1250 cups"),[]);
  assert.deepEqual(diffFacts("Roastery Al Noor opens","The roastery opens",["Al Noor"]).map(l=>l.value),["Al Noor"]);
  assert.ok(extractFacts("call 91234567").get("phone")?.has("91234567"));
  const quran="قال تعالى: ﴿وَقُل رَّبِّ زِدْنِي عِلْمًا﴾ تعلّم كل يوم شيئاً جديداً.";
  const p=protectSpans(quran+"\nبِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ\nزورونا https://shop.example.com #إعلان «قهوة النور» info@shop.example.com");
  assert.equal(p.spans.length,6,JSON.stringify(p.spans));
  assert.ok(p.spans.includes("﴿وَقُل رَّبِّ زِدْنِي عِلْمًا﴾"));
  assert.ok(p.spans.includes("بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ"),"a fully vowelled line is quoted, not reworded");
  assert.ok(p.spans.includes("https://shop.example.com")&&p.spans.includes("#إعلان")&&p.spans.includes("«قهوة النور»")&&p.spans.includes("info@shop.example.com"));
  assert.ok(!/﴿|https|إعلان|info@/.test(p.masked));
}

// ---------- 5. rewrite with the local model: only a better, faithful text is kept ----------
{
  const prompts:string[]=[];
  const good="New beans every Tuesday. Ethiopian, roasted Monday night, $4.50 a cup until Sunday.\nIt tastes like peach tea when it cools. Come early, the bag is small.";
  const ai="In today's fast-paced world, our innovative beans seamlessly elevate your mornings. Moreover, it's worth noting they are crucial for a vibrant day. Whether you're a student or a professional, our robust blend is a game-changer. Only $4.50 until Sunday. In conclusion, the future looks bright.";
  // 1st answer loses the price, 2nd is good
  let calls=0;
  const r=await humanizeText(ai,{platform:"instagram"},async prompt=>{prompts.push(prompt);calls++;return calls===1?"Fresh beans this week. Cheap until Sunday.":"Sure! Here's the rewrite:\n\n"+good;});
  assert.equal(r.rewritten,true,JSON.stringify(r));
  assert.equal(r.text,good,"chatbot leftovers around the answer are cleaned too");
  assert.equal(r.attempts,2);
  assert.ok(prompts[1]!.includes("4.50"),"the second prompt says what was lost");
  assert.match(prompts[0]!,/Remove the stock phrase "in today's fast-paced"/);
  assert.match(prompts[0]!,/Instagram/);assert.match(prompts[0]!,/Stay under 2200/);
  assert.equal(r.before.verdict,"fail");assert.equal(r.after.verdict,"pass");
  // a model that keeps losing facts never replaces the text
  const bad=await humanizeText(ai,{platform:"instagram",maxAttempts:2},async()=>"A nice coffee.");
  assert.equal(bad.rewritten,false);assert.equal(bad.note,"rewrite_lost_facts");assert.equal(bad.text,cleanText(ai,{platform:"instagram"}).text);
  // protected passages must come back exactly once
  const withLink=ai+" Order: https://shop.example.com/beans";
  const dropped=await humanizeText(withLink,{platform:"facebook",maxAttempts:1},async()=>good+" Order: https://shop.example.com/other");
  assert.equal(dropped.rewritten,false,"a changed link is refused");
  const kept=await humanizeText(withLink,{platform:"facebook"},async prompt=>{assert.ok(prompt.includes("⟦1⟧")&&!prompt.includes("shop.example.com"));return good+" Order: ⟦1⟧";});
  assert.equal(kept.rewritten,true);assert.ok(kept.text.endsWith("https://shop.example.com/beans"));
  // the model being down never loses the post
  const down=await humanizeText(ai,{},async()=>{throw new Error("ollama not running");});
  assert.equal(down.rewritten,false);assert.match(down.note!,/model_error: ollama not running/);assert.ok(down.text.length>50);
  // nothing to do: no model call
  let called=false;const fine=await humanizeText(HUMAN_EN,{platform:"instagram"},async()=>{called=true;return"";});
  assert.equal(called,false);assert.equal(fine.note,"already_human");
  // a verse is never sent to the model and comes back exactly; only the words around it are rewritten
  const verseText="﴿إِنَّ مَعَ الْعُسْرِ يُسْرًا﴾";
  const verse=await humanizeText(verseText+"\nفي عالم اليوم المتسارع، لا شك أن الصبر يلعب دوراً محورياً في حياتنا. في الختام، تجدر الإشارة إلى أهمية التفاؤل.",{},async prompt=>{
    assert.ok(!prompt.includes("الْعُسْرِ"),"the verse is not in the prompt");return"⟦1⟧\nالصبر صعب، لكن الفرج يأتي. جرّبت هذا بنفسي مرة بعد مرة.";});
  assert.equal(verse.rewritten,true,JSON.stringify(verse));assert.ok(verse.text.startsWith(verseText));
  const quoted=await humanizeText("«In today's fast-paced world, we leverage seamless synergy to unlock robust solutions.» said our CEO",{},async()=>{called=true;return"";});
  assert.equal(called,false);assert.equal(quoted.note,"protected","a quotation is not reworded, and too little is left around it");
  const html=await humanizeText("<p>We leverage seamless synergy to unlock the power of robust solutions.</p>",{format:"html"},async()=>{called=true;return"";});
  assert.equal(called,false);assert.equal(html.note,"html_check_only");
  assert.equal((await humanizeText(ai,{})).note,"no_model");
}

// ---------- 6. the owner's voice ----------
{
  assert.equal(loadVoice(),null);
  const v=saveVoice({samples:["وصلتنا دفعة جديدة اليوم.\nتعالوا بدري.","الكوب بريال ونص بس 😄",42,"x".repeat(2000)],dialect:"خليجية",tone:"ودود وقصير",person:"we",avoid:["حصرياً"],prefer:["حياكم"],evil:"no"});
  assert.equal(v.samples.length,3);assert.equal(v.samples[2]!.length,1500);assert.equal(v.person,"we");assert.equal((v as any).evil,undefined);
  assert.deepEqual(loadVoice()?.avoid,["حصرياً"]);assert.ok(loadVoice()?.updatedAt);
  const r=scanText("عرض حصرياً لكم اليوم. الكوب بريال.",{voice:loadVoice()});
  assert.equal(check(r,"voice").status,"fail","a word the owner banned");
  const long="هذا المنتج الرائع يتميز بخصائص عديدة ومتنوعة تجعل منه الخيار الأمثل لكل من يبحث عن الجودة والراحة في آن واحد دون أي تنازل. "+
    "كما أن التصميم المدروس بعناية فائقة يمنح المستخدم تجربة مريحة وممتعة طوال اليوم في البيت والعمل والسفر على حد سواء دائماً.";
  const drift=scanText(long,{voice:{samples:["وصلت دفعة جديدة.\nتعالوا بدري.\nالكوب بريال."],avoid:[],prefer:[]}});
  assert.ok(drift.findings.some((f:any)=>f.kind==="sentence_length"),"much longer sentences than the owner writes");
  let prompt="";await humanizeText(AI_AR,{voice:loadVoice()},async p=>{prompt=p;return HUMAN_AR;});
  assert.match(prompt,/dialect: خليجية/);assert.match(prompt,/Write as "we"/);assert.match(prompt,/وصلتنا دفعة جديدة اليوم/);assert.match(prompt,/Never use "حصرياً"|حياكم/);
}

// ---------- 7. the switch ----------
assert.equal(humanizerMode({}),"rewrite");
assert.equal(humanizerMode({LAYANX_HUMANIZER:"clean"}),"clean");
assert.equal(humanizerMode({LAYANX_HUMANIZER:"off"}),"off");
assert.equal(humanizerMode({LAYANX_HUMANIZER:"0"}),"off");

console.log("humanizer: clean, five checks + platform limits, fact-safe rewrite, protected passages, voice profile");
