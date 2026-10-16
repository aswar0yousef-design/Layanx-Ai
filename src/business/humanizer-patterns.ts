/**
 * Word lists for the humanizer (src/business/humanizer.ts): the habits that make a
 * post, a page or an app screen read as machine-written. Written for LayanX in
 * English and Arabic, after the ideas in two MIT projects (blader/humanizer, from
 * Wikipedia's "Signs of AI writing", and Aboudjem/humanizer-skill); no list is
 * copied from them.
 *
 * Every pattern is matched on folded text (see `fold`): lower case, no Arabic
 * diacritics or tatweel, one form of alef/yaa/taa marbuta, Western digits. So a
 * pattern is written once and still matches "دورا\u064B محوريا\u064B" and "دور\u064Bا محوري\u064Bا".
 * Edit the lists to change behaviour; nothing here runs code.
 */
export type PatternKind="slop"|"vague"|"hedge"|"voice"|"residue_start"|"residue_end";
export interface TextPattern{id:string;kind:PatternKind;lang:"en"|"ar";weight:number;re:RegExp;label:string;fix?:string}

const AR_DIACRITICS=/[\u064B-\u065F\u0670\u0640\u06D6-\u06ED]/g;
export function fold(text:string):string{
  return text.toLowerCase()
    .replace(AR_DIACRITICS,"")
    .replace(/[أإآٱ]/g,"ا").replace(/ى/g,"ي").replace(/ؤ/g,"و").replace(/ئ/g,"ي").replace(/ة/g,"ه")
    .replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-0x0660)).replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-0x06F0))
    .replace(/[‘’ʼ]/g,"'");
}

/** fold() plus, for every folded character, the index of the original character it came from. */
export function foldWithMap(text:string):{folded:string;map:number[]}{
  let folded="";const map:number[]=[];
  for(let i=0;i<text.length;){
    const cp=text.codePointAt(i)!;const ch=String.fromCodePoint(cp);
    const f=fold(ch);
    for(let k=0;k<f.length;k++)map.push(i);
    folded+=f;i+=ch.length;
  }
  map.push(text.length);
  return{folded,map};
}

const esc=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const L="[\\p{L}\\p{N}]";
/** A phrase as a regex on folded text. "…" stands for a short gap inside one sentence. */
function phraseRe(phrase:string,lang:"en"|"ar"):RegExp{
  const tokens=fold(phrase).trim().split(/\s+/);
  const body=fold(phrase).split("…").map(part=>part.trim().split(/\s+/).map(esc).join("\\s+")).join("[^.!?؟\\n]{1,80}?");
  if(lang==="en")return new RegExp(`(?<!${L})(?:${body})(?!${L})`,"gu");
  // Arabic glues و ف ب ل ك and ال to the front of a word and endings (ة ات ين ون…) to its back:
  // "وتجدر الإشارة" is still "تجدر الإشارة", "مختلفة" is still "مختلف".
  // A phrase that ends in a one-letter word (ب, ل) runs into the next word: "ارتق\u0650 بتجربتك".
  const end=(tokens.at(-1)??"").length===1?"":`(?:ه|ات|ين|ون|ان|ا|ي|ها|هم)?(?!${L})`;
  return new RegExp(`(?<!${L})(?:[وفبلك]{0,2}|ال)?(?:${body})${end}`,"gu");
}
let n=0;
function make(kind:PatternKind,lang:"en"|"ar",weight:number,items:Array<string|[string,string]>):TextPattern[]{
  return items.map(item=>{
    const [label,fix]=typeof item==="string"?[item,undefined]:item;
    const alternatives=label.split("|");
    const re=alternatives.length===1?phraseRe(label,lang):new RegExp(alternatives.map(a=>phraseRe(a,lang).source).join("|"),"gu");
    return{id:`${lang}.${kind}.${++n}`,kind,lang,weight,re,label:alternatives[0]!,...(fix?{fix}:{})};
  });
}

// ---------------------------------------------------------------- English
const EN_STRONG:Array<string|[string,string]>=[
  ["delve|delves|delved|delving","look at / dig into"],["tapestry","cut it"],["testament to|stands as a testament","shows"],
  ["underscore|underscores|underscoring","shows"],["leverage|leverages|leveraging","use"],["multifaceted","name the parts"],
  ["realm|in the realm of","area"],["interplay","mix"],["seamless|seamlessly","say what is easy"],["groundbreaking","new: say what is new"],
  ["game-changer|game changer","say what changed"],["unleash|unleashes|unleashing","use"],["unlock the|unlock your","get"],
  ["embark on|embark upon","start"],["elevate your|elevates your|elevate the","improve"],["meticulous|meticulously","careful"],
  ["paramount","most important"],["synergy|synergies","cut it"],["holistic","whole"],["transformative","say what it changes"],
  ["revolutionize|revolutionizes|revolutionizing","change"],["cutting-edge|state-of-the-art","new: name it"],["treasure trove","lots of: count them"],
  ["nestled","sits / is"],["bustling","busy"],["beacon of","cut it"],["symphony of","cut it"],["ever-evolving|rapidly evolving|ever-changing","changing"],
  ["navigate the complexities|navigating the complexities|navigate the landscape","handle"],["in today's fast-paced|in today's digital|in today's world|in today's","cut it"],
  ["it's worth noting|it is worth noting|it's important to note|it is important to note","cut it"],["plays a crucial role|plays a pivotal role|plays a vital role","matters for"],
  ["the future looks bright|a bright future","say what happens next"],["look no further","cut it"],["take it to the next level|to the next level","say what improves"],
  ["whether you're a|whether you are a","name the reader"],["walks of life","name who"],["push the boundaries","cut it"],
  ["let's dive in|let's dive into|dive into|deep dive","cut it / look at"],["let's explore","cut it"],["without further ado","cut it"],["buckle up","cut it"],
  ["at its core","cut it"],["harness the power|the power of","use"],["a myriad of|myriad","many: count them"],["in conclusion|in summary|to sum up","cut it"],
  ["not only … but also","say both plainly"],["it's not just … it's|it's not … it's","say what it is"]
];
const EN_MILD:Array<string|[string,string]>=[
  ["crucial","important"],["pivotal","key"],["vibrant","lively: show it"],["robust","strong"],["foster|fosters|fostering","build"],
  ["enhance|enhances|enhancing","improve"],["showcase|showcases|showcasing","show"],["notably","cut it"],["moreover|furthermore|additionally","also / cut it"],
  ["utilize|utilizes|utilizing|utilization","use"],["garner","get"],["bolster","support"],["boasts","has"],["streamline|streamlines","simplify"],
  ["empower|empowers|empowering","help"],["comprehensive","full"],["innovative","new: say what is new"],["landscape","market / field"],["journey","cut it"],
  ["at the end of the day","cut it"],["when it comes to","for"],["in order to","to"],["we're thrilled|we are thrilled|we're excited to|we are excited to","say the news"]
];
const EN_VAGUE=["many","various","numerous","several","a variety of","a wide range of","a range of","countless","a lot of","lots of","things","stuff","solutions","experts say","studies show","some people"];
const EN_HEDGE=["may","might","could potentially","arguably","generally","typically","it seems","somewhat","perhaps","to some extent","in many ways"];
const EN_VOICE=["are you ready to","have you ever wondered","ever wondered","imagine a world","picture this","in a world where","here's the thing","the best part?","the result?","spoiler:"];
const EN_RESIDUE_START=["sure","certainly","absolutely","of course","great question","here's a|here is a|here's the|here is the|here's your|here is your","below is|below are","as requested"];
// Weight 2: chatbot leftovers on their own. Weight 1: only when the same paragraph talks about the draft itself (META_RE).
const EN_RESIDUE_END_ALWAYS=["i hope this helps","hope this helps","happy to help","as an ai|as a language model|as an ai language model","i can't browse|i cannot browse","as of my last update|my knowledge cutoff"];
const EN_RESIDUE_END=["let me know if","feel free to","would you like me to","if you need any"];

// ---------------------------------------------------------------- Arabic
const AR_STRONG:Array<string|[string,string]>=[
  ["في عالم اليوم|في عالمنا اليوم|في عالم اليوم المتسارع|في عالم يتسارع","احذفها وابدأ بالفكرة"],["في ظل التطورات المتسارعة|في ظل التطور المتسارع","احذفها"],
  ["في عصرنا الحالي|في العصر الحالي|في عصر التكنولوجيا|في العصر الرقمي","احذفها"],["لا شك ان|لا شك في ان|مما لا شك فيه|بلا شك","احذفها أو قل الدليل"],
  ["تجدر الاشاره","احذفها"],["من الجدير بالذكر|الجدير بالذكر","احذفها"],["من المهم ان نلاحظ|من المهم الاشاره|من المهم ان نشير","احذفها"],
  ["يلعب دورا محوريا|يلعب دورا حاسما|يلعب دورا مهما|تلعب دورا محوريا|تلعب دورا حاسما|دورا محوريا","قل ماذا يفعل"],
  ["في الختام|وفي الختام|ختاما","احذفها"],["تجربه فريده من نوعها|فريده من نوعها|لا مثيل لها|لا مثيل له","قل ما الذي يميزها"],
  ["نقله نوعيه","قل ما الذي تغي\u0651ر"],["حجر الزاويه","الأساس"],["غني عن التعريف","احذفها"],["ارتق ب|ارتقي ب|ارتق\u0650 ب","حس\u0651ن"],
  ["اطلق العنان|اطلقي العنان|اطلاق العنان","استخدم"],["اكتشف عالم|عالم من الامكانيات|عالما من","قل ما هو"],
  ["رحلتك نحو|انطلق في رحله|رحله استثنائيه","احذفها"],["مستقبل مشرق|المستقبل المشرق","قل ما سيحدث"],["عصر جديد من","احذفها"],
  ["خطوه مهمه نحو|خطوه هامه نحو|يمثل خطوه","قل ما الذي يتغير"],["هل انت مستعد ل|هل انتي مستعده ل|هل انتم مستعدون ل","ابدأ بالمعلومة"],
  ["هل تساءلت يوما|هل سبق ان تساءلت","ابدأ بالمعلومة"],["دعونا نستكشف|دعنا نستكشف|لنستكشف معا|هيا نستكشف","احذفها"],
  ["ليس فقط … بل|ليس مجرد … بل|لا يقتصر … بل","قلها مباشرة"],["سواء كنت … او","سم\u0650\u0651 القارئ"],["بكل تاكيد","احذفها"],
  ["بشكل سلس|بسلاسه تامه","قل ما السهل فيها"],["حلول مبتكره|حلولا مبتكره","سم\u0650\u0651 الحل"],["يسعدنا ان نقدم لكم|يسعدنا ان نعلن","قل الخبر"]
];
const AR_MILD:Array<string|[string,string]>=[
  ["علاوه علي ذلك","احذفها أو: وأيضا\u064B"],["بالاضافه الي ذلك","وأيضا\u064B"],["علي حد سواء","احذفها"],["في نهايه المطاف","احذفها"],["علي صعيد اخر","احذفها"],
  ["بشكل كبير|بشكل ملحوظ","قل الرقم"],["يعد من اهم|يعتبر من اهم|من ابرز","قل لماذا"],["تحول جذري","قل ما الذي تغي\u0651ر"],["لا تفوت الفرصه","اذكر الموعد أو العرض"],
  ["متكامله وشامله|شامله ومتكامله","احذفها"],["افضل تجربه|تجربه استثنائيه","قل ماذا يجد"],["عالي الجوده|بجوده عاليه","قل ما الجودة: مادة، ضمان، رقم"]
];
const AR_VAGUE=["العديد من","الكثير من","مختلف","متنوعه","مجموعه واسعه|مجموعه كبيره","مجموعه متنوعه","عدد كبير من","اشياء","حلول","يقول الخبراء","تشير الدراسات","بعض الناس"];
const AR_HEDGE=["قد يكون","قد تكون","ربما","الي حد ما","بشكل عام","عاده ما","نوعا ما","يمكن القول"];
const AR_VOICE=["تخيل ان|تخيل عالما","والنتيجه؟","الافضل؟","السر؟","اليك السر","الحقيقه هي"];
const AR_RESIDUE_START=["بالتاكيد","بالطبع","طبعا","بكل سرور","اليك|اليكم|اليكي","هذا منشور|هذا نص|هذه مسوده|هذا اقتراح","فيما يلي"];
const AR_RESIDUE_END_ALWAYS=["اتمني ان يكون مفيد|اتمني ان يكون هذا مفيد|اتمني ان ينال","يسعدني مساعدتك|يسعدني ان اساعد","كنموذج لغوي|كنموذج ذكاء|بصفتي نموذج|بصفتي ذكاء"];
const AR_RESIDUE_END=["هل تريد ان|هل تريدين ان|هل ترغب في","اذا كنت بحاجه الي|اذا احتجت","لا تتردد في|لا تترددي في"];

export const PATTERNS:TextPattern[]=[
  ...make("slop","en",1,EN_STRONG),...make("slop","en",0.6,EN_MILD),...make("vague","en",1,EN_VAGUE),...make("hedge","en",1,EN_HEDGE),
  ...make("voice","en",1,EN_VOICE),...make("residue_start","en",1,EN_RESIDUE_START),...make("residue_end","en",2,EN_RESIDUE_END_ALWAYS),...make("residue_end","en",1,EN_RESIDUE_END),
  ...make("slop","ar",1,AR_STRONG),...make("slop","ar",0.6,AR_MILD),...make("vague","ar",1,AR_VAGUE),...make("hedge","ar",1,AR_HEDGE),
  ...make("voice","ar",1,AR_VOICE),...make("residue_start","ar",1,AR_RESIDUE_START),...make("residue_end","ar",2,AR_RESIDUE_END_ALWAYS),...make("residue_end","ar",1,AR_RESIDUE_END)
];

/** A paragraph that talks about the draft itself ("here is your caption", "want another version?"). */
export const META_RE=/\b(?:post|caption|draft|version|rewrite|text|copy|tweet|thread|changes?|adjust|tweak|edits?)\b|منشور|نص|مسود|نسخ|صيغ|تعديل|تغيير|اعدل|أعدل|كابشن|تغريد/iu;

/**
 * Labels the platform or the law asks for. The cleaner never touches them, the
 * rewrite keeps them word for word, and a rewrite that loses one is refused.
 */
export const DISCLOSURE_RE=/(?<![\p{L}\p{N}])#(?:ad|ads|sponsored|paid|partner|paidpartnership|إعلان|اعلان|ممول|مدفوع|برعاية)(?![\p{L}\p{N}])|paid partnership|sponsored(?: by| content| post)?|ai[- ]generated|generated (?:with|by) ai|made with ai|created with ai|بمساعدة الذكاء الاصطناعي|(?:م\u064F?نشأ|مول\u0651?د|مصنوع) (?:بواسطة |ب)الذكاء الاصطناعي|شراكة مدفوعة|إعلان مدفوع|محتوى (?:ممول|مدفوع)|برعاية/giu;

/** Look-alike letters (Cyrillic and Greek) that hide inside Latin words. */
export const HOMOGLYPHS:Record<string,string>={
  "а":"a","е":"e","о":"o","р":"p","с":"c","у":"y","х":"x","і":"i","ј":"j","ѕ":"s","ԁ":"d","ӏ":"l","һ":"h","ԛ":"q","ԝ":"w","ү":"y",
  "А":"A","В":"B","Е":"E","К":"K","М":"M","Н":"H","О":"O","Р":"P","С":"C","Т":"T","Х":"X","У":"Y","Ѕ":"S","І":"I","Ј":"J",
  "ο":"o","α":"a","ν":"v","ρ":"p","ι":"i","κ":"k","υ":"u",
  "Α":"A","Β":"B","Ε":"E","Ζ":"Z","Η":"H","Ι":"I","Κ":"K","Μ":"M","Ν":"N","Ο":"O","Ρ":"P","Τ":"T","Υ":"Y","Χ":"X"
};
