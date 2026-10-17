/**
 * LayanX assistant page (/voice).
 *
 * Free by default: speech recognition and speech synthesis come from the browser
 * (Microsoft Edge or Google Chrome), the "brain" is /v1/assistant/turn on the
 * local runtime (Ollama first). OpenAI Realtime stays available as an optional
 * mode when OPENAI_API_KEY is configured.
 *
 * Always-on: while "listen all the time" is on, the page waits for a wake word
 * (Arabic or English), then takes one command, answers out loud and goes back to
 * waiting. Recognition restarts by itself when the browser stops it.
 *
 * String.raw keeps regex backslashes intact; the page must not contain "${" or backticks.
 */
export function voiceUiHtml():string{
return String.raw`<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>LayanX المساعد</title>
<style>
:root{--bg:#0E1A24;--panel:#13232F;--line:#22394A;--ink:#E7F0F3;--soft:#94AAB6;--teal:#2BC4A4;--amber:#E9A23B;--rose:#EF6F7F;
 --sans:"Segoe UI Variable Text","Segoe UI","Noto Sans Arabic",Tahoma,sans-serif}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 var(--sans)}
a{color:var(--teal)}
.top{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1.5rem;border-bottom:1px solid var(--line);flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:.7rem;font-weight:650}
.brand small{display:block;color:var(--soft);font-weight:400}
.top nav{display:flex;gap:.6rem;flex-wrap:wrap}
.top nav a,.seg button{font-size:.92rem;color:var(--ink);text-decoration:none;border:1px solid var(--line);border-radius:.45rem;padding:.35rem .8rem;background:transparent;cursor:pointer;font-family:inherit}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:.5rem;overflow:hidden}
.seg button{border:0;border-radius:0}
.seg button[aria-pressed="true"]{background:var(--teal);color:#06231C;font-weight:650}
main{max-width:56rem;margin:0 auto;padding:2rem 1.25rem 3rem}
.stage{display:grid;justify-items:center;gap:.9rem;text-align:center}
.orb{width:11rem;height:11rem;border-radius:50%;border:0;cursor:pointer;position:relative;
 background:radial-gradient(circle at 35% 30%,#5FE3C8 0%,#1A8F7A 45%,#0B3B35 100%);
 box-shadow:0 0 0 1px #2BC4A455,0 0 40px #2BC4A433;transition:box-shadow .25s,transform .25s}
.orb:focus-visible{outline:3px solid var(--amber);outline-offset:6px}
.orb[data-state="off"]{filter:grayscale(.85) brightness(.55)}
.orb[data-state="wake"]{animation:breathe 3.2s ease-in-out infinite}
.orb[data-state="listen"]{box-shadow:0 0 0 10px #2BC4A433,0 0 70px #2BC4A499;transform:scale(1.04)}
.orb[data-state="think"]{background:radial-gradient(circle at 35% 30%,#FFD58A 0%,#C9831F 50%,#4A2F09 100%);box-shadow:0 0 50px #E9A23B66}
.orb[data-state="speak"]{animation:pulse 0.9s ease-in-out infinite}
@keyframes breathe{50%{box-shadow:0 0 0 6px #2BC4A422,0 0 55px #2BC4A455}}
@keyframes pulse{50%{transform:scale(1.06)}}
@media (prefers-reduced-motion:reduce){.orb{animation:none!important;transition:none}}
.state{font-size:1.35rem;font-weight:600;min-height:2.2rem}
.hint{color:var(--soft);max-width:36rem;margin:0}
.switches{display:flex;flex-wrap:wrap;justify-content:center;gap:.5rem 1.4rem;margin:1.4rem 0 .4rem}
.switches label{display:flex;align-items:center;gap:.5rem;cursor:pointer}
.switches input{accent-color:var(--teal);width:1.05rem;height:1.05rem}
.actions{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center}
button.act{font:inherit;font-size:.95rem;color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:.5rem;padding:.5rem 1rem;cursor:pointer}
button.act:hover{border-color:var(--soft)}
button.act.primary{background:var(--teal);border-color:var(--teal);color:#06231C;font-weight:650}
.briefing{margin:1.5rem 0 0;padding:1rem 1.2rem;border:1px solid var(--line);border-inline-start:3px solid var(--amber);border-radius:.5rem;background:var(--panel)}
.briefing p{margin:.3rem 0 .7rem}
.log{list-style:none;padding:0 0 1rem;margin:2rem 0 1rem;display:flex;flex-direction:column;gap:.7rem}
.log li{max-width:85%;padding:.65rem .95rem;border-radius:.8rem;background:var(--panel);border:1px solid var(--line);white-space:pre-wrap}
.log li.you{align-self:flex-start;background:#173A35;border-color:#1F5A50}
.log li.me{align-self:flex-end}
.log li small{display:block;color:var(--soft);font-size:.8rem;margin-top:.25rem}
.log li.err{border-color:var(--rose)}
form.say{display:flex;gap:.5rem;position:sticky;bottom:0;padding:.75rem 0;background:linear-gradient(transparent,var(--bg) 30%)}
form.say input{flex:1;font:inherit;padding:.75rem .9rem;border-radius:.55rem;border:1px solid var(--line);background:var(--panel);color:var(--ink)}
details{margin-top:2rem;border-top:1px solid var(--line);padding-top:1rem;color:var(--soft)}
details summary{cursor:pointer;color:var(--ink)}
details label{display:block;margin:.8rem 0 .25rem;font-size:.9rem}
details label.check{display:flex;align-items:center;gap:.5rem;cursor:pointer}
details input,details select{width:100%;font:inherit;padding:.5rem .7rem;border-radius:.45rem;border:1px solid var(--line);background:var(--panel);color:var(--ink)}
.warn{color:var(--amber)}
[hidden]{display:none!important}
</style>
</head>
<body>
<header class="top">
  <div class="brand"><span aria-hidden="true">◉</span><div>LayanX<small>المساعد الشخصي</small></div></div>
  <div class="seg" role="group" aria-label="اللغة">
    <button type="button" data-lang="ar" aria-pressed="true">العربية</button>
    <button type="button" data-lang="en" aria-pressed="false">English</button>
  </div>
  <nav><a href="/">لوحة التحكم</a><a href="/setup">الإعداد</a></nav>
</header>
<main>
  <section class="stage">
    <button class="orb" id="orb" data-state="off" aria-label="تحدّث الآن"></button>
    <div class="state" id="state" aria-live="polite">جاهز</div>
    <p class="hint" id="hint"></p>
    <div class="switches">
      <label><input type="checkbox" id="always"> <span id="l-always">الاستماع طوال الوقت</span></label>
      <label><input type="checkbox" id="speakOn" checked> <span id="l-speak">الرد بالصوت</span></label>
      <label><input type="checkbox" id="tasksOn" checked> <span id="l-tasks">تنفيذ المهام</span></label>
    </div>
    <div class="actions">
      <button class="act" id="reportBtn" type="button">تقرير الآن</button>
      <button class="act" id="stopBtn" type="button">إيقاف الكلام</button>
      <button class="act" id="realtimeBtn" type="button" hidden>محادثة مباشرة (OpenAI)</button>
    </div>
  </section>

  <div class="briefing" id="briefing" hidden>
    <strong id="briefTitle">تقرير اليوم</strong>
    <p id="briefText"></p>
    <button class="act primary" id="briefPlay" type="button">اسمع التقرير</button>
  </div>

  <button class="act primary" id="soundBtn" type="button" style="width:100%;margin:.6rem 0" hidden>🔊 اضغط مرة واحدة ليتحدث المساعد بصوته</button>

  <ul class="log" id="log" aria-live="polite"></ul>

  <form class="say" id="sayForm" autocomplete="off">
    <input id="sayInput" placeholder="اكتب أمرك هنا أو تحدّث…" aria-label="اكتب أمرك">
    <button class="act primary" type="submit" id="sendBtn">إرسال</button>
  </form>

  <details>
    <summary id="l-settings">إعدادات المساعد</summary>
    <label for="wakeWords" id="l-wake">كلمات الاستدعاء (افصل بفاصلة)</label>
    <input id="wakeWords" dir="auto">
    <label for="project" id="l-project">المشروع</label>
    <input id="project" value="default" dir="ltr">
    <label for="engineSel" id="l-engine">التعرف على الكلام</label>
    <select id="engineSel"><option value="auto" id="eng-auto">تلقائي</option><option value="local" id="eng-local">محلي على جهازي (Whisper)</option><option value="browser" id="eng-browser">المتصفح</option></select>
    <label for="voiceSel" id="l-voice">صوت الرد</label>
    <select id="voiceSel"></select>
    <p id="voiceNote" class="warn" hidden></p>
    <label for="pauseSel" id="l-pause">انتظار نهاية كلامك</label>
    <select id="pauseSel"><option value="800" id="p-short">قصير (0.8 ثانية)</option><option value="1200" id="p-normal">عادي (1.2 ثانية)</option><option value="2000" id="p-long">طويل (ثانيتان)</option></select>
    <label class="check"><input type="checkbox" id="bargeOn" checked> <span id="l-barge">قاطعني عندما أتكلم: يسكت ويستمع لك</span></label>
    <label class="check"><input type="checkbox" id="followOn" checked> <span id="l-follow">تابع المحادثة دون تكرار الاسم (8 ثوانٍ بعد كل رد)</span></label>
    <p id="engineNote"></p>
  </details>
</main>
<audio id="player" hidden></audio>

<script>
"use strict";
var $=function(id){return document.getElementById(id)};
var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
var L={
 ar:{idle:"جاهز",ready:"جاهز",off:"المساعد متوقف",wake:"أنتظر أن تناديني…",listen:"أستمع…",think:"أفكّر…",speak:"أتحدث…",
  hintWake:"قل «جارفيس» أو «ليان» ثم أمرك، مثل: جارفيس أعطني تقرير اليوم",hintTap:"اضغط الدائرة وتحدث، أو اكتب أمرك في الأسفل",
  noSR:"هذا المتصفح لا يدعم التعرف على الكلام. استخدم Microsoft Edge أو Google Chrome، أو اكتب أمرك.",
  denied:"لم يُسمح باستخدام الميكروفون. اسمح به من رمز القفل بجانب العنوان ثم أعد المحاولة.",
  report:"تقرير الآن",stop:"إيقاف الكلام",always:"الاستماع طوال الوقت",speakL:"الرد بالصوت",tasks:"تنفيذ المهام",
  send:"إرسال",placeholder:"اكتب أمرك هنا أو تحدّث…",settings:"إعدادات المساعد",wakeL:"كلمات الاستدعاء (افصل بفاصلة)",projectL:"المشروع",voiceL:"صوت الرد",
  noVoice:"لا يوجد صوت عربي مثبت. في Windows: الإعدادات ← الوقت واللغة ← الكلام ← إضافة أصوات، أو استخدم Microsoft Edge.",
  approvals:"افتح الموافقات",mission:"المهمة",brief:"تقرير اليوم",briefPlay:"اسمع التقرير",netErr:"تعذر الاتصال بـ LayanX: ",
  engineFree:"التعرف على الكلام من المتصفح (مجاني؛ يعالجه Microsoft أو Google). العقل: النموذج المحلي في LayanX.",
  realtime:"محادثة مباشرة (OpenAI)",realtimeStop:"إنهاء المحادثة المباشرة",auto:"تلقائي",
  engineLocal:"التعرف على الكلام محلي على جهازك عبر Whisper؛ لا يخرج صوتك من الجهاز. العقل: النموذج المحلي في LayanX.",
  engineL:"التعرف على الكلام",engAuto:"تلقائي",engLocal:"محلي على جهازي (Whisper)",engBrowser:"المتصفح",noLocal:"Whisper المحلي غير مشغّل؛ أستخدم المتصفح.",transcribing:"أحوّل كلامك إلى نص…",sayIt:"نعم؟ أستمع…",heard:"سمعت:",soundBtn:"🔊 اضغط مرة واحدة ليتحدث المساعد بصوته",
  pauseL:"انتظار نهاية كلامك",pShort:"قصير (0.8 ثانية)",pNormal:"عادي (1.2 ثانية)",pLong:"طويل (ثانيتان)",bargeL:"قاطعني عندما أتكلم: يسكت ويستمع لك",
  followL:"تابع المحادثة دون تكرار الاسم (8 ثوانٍ بعد كل رد)",heardNoName:"سمعتك: «{x}». لكي أرد، ابدأ بـ «{name}».",
  welcome:"أنا جاهز وأستمع. قل «{name}» ثم أمرك، مثل: {name}، كيف حالك؟"},
 en:{idle:"Ready",ready:"Ready",off:"Assistant is off",wake:"Waiting for my name…",listen:"Listening…",think:"Thinking…",speak:"Speaking…",
  hintWake:"Say \"Jarvis\" or \"Layan\" followed by your request, e.g. Jarvis, give me today's report",hintTap:"Tap the circle and speak, or type below",
  noSR:"This browser can't recognise speech. Use Microsoft Edge or Google Chrome, or type your request.",
  denied:"Microphone access was blocked. Allow it from the lock icon next to the address, then try again.",
  report:"Report now",stop:"Stop speaking",always:"Listen all the time",speakL:"Speak replies",tasks:"Run tasks",
  send:"Send",placeholder:"Type a request or speak…",settings:"Assistant settings",wakeL:"Wake words (comma separated)",projectL:"Project",voiceL:"Reply voice",
  noVoice:"No English voice is installed. In Windows: Settings → Time & language → Speech → Add voices.",
  approvals:"Open approvals",mission:"Task",brief:"Today's briefing",briefPlay:"Play briefing",netErr:"Could not reach LayanX: ",
  engineFree:"Speech recognition by the browser (free; processed by Microsoft or Google). Brain: the local LayanX model.",
  realtime:"Live conversation (OpenAI)",realtimeStop:"End live conversation",auto:"Automatic",
  engineLocal:"Speech recognition runs on this computer with Whisper; your voice never leaves it. Brain: the local LayanX model.",
  engineL:"Speech recognition",engAuto:"Automatic",engLocal:"On this computer (Whisper)",engBrowser:"Browser",noLocal:"Local Whisper is not running; using the browser.",transcribing:"Transcribing…",sayIt:"Yes? I'm listening…",heard:"Heard:",soundBtn:"🔊 Click once so the assistant can speak",
  pauseL:"Wait for the end of my speech",pShort:"Short (0.8 s)",pNormal:"Normal (1.2 s)",pLong:"Long (2 s)",bargeL:"Interrupt me when I talk: it stops and listens",
  followL:"Keep the conversation going without the name (8 s after each reply)",heardNoName:"Heard you: \u201c{x}\u201d. To get a reply, start with \u201c{name}\u201d.",
  welcome:"I'm ready and listening. Say \u201c{name}\u201d then your request, e.g. {name}, how are you?"}
};
var DEFAULT_WAKE="جارفيس, جارفس, ليان, ليين, ليانكس, لايان اكس, jarvis, layan, layanx, lion x";
var S={engine:localStorage.getItem("lx.engine")||"auto",lang:localStorage.getItem("lx.lang")||"ar",always:localStorage.getItem("lx.always")==="1",speak:localStorage.getItem("lx.speak")!=="0",
 tasks:localStorage.getItem("lx.tasks")!=="0",wake:localStorage.getItem("lx.wake")||DEFAULT_WAKE,project:localStorage.getItem("lx.project")||"default",
 voice:localStorage.getItem("lx.voice")||"",
 /** Silence (ms) that ends what you are saying; pauses shorter than this stay in the same request. */
 pause:[800,1200,2000].indexOf(Number(localStorage.getItem("lx.pause")))>=0?Number(localStorage.getItem("lx.pause")):1200,
 barge:localStorage.getItem("lx.barge")!=="0",
 /** After a reply to something said aloud, what is said next (within 8 s) needs no name. */
 follow:localStorage.getItem("lx.follow")!=="0"};
if(new URLSearchParams(location.search).get("listen")==="1")S.always=true;
var state="off",rec=null,recMode=null,busy=false,speaking=false,convo=[],restartTimer=null,blocked=false,realtime=null;
var legacyToken=localStorage.getItem("layanx.voice.token")||localStorage.getItem("layanx.apiToken")||"";

function t(k){return L[S.lang][k]}
function save(){localStorage.setItem("lx.engine",S.engine);localStorage.setItem("lx.lang",S.lang);localStorage.setItem("lx.always",S.always?"1":"0");localStorage.setItem("lx.speak",S.speak?"1":"0");
 localStorage.setItem("lx.tasks",S.tasks?"1":"0");localStorage.setItem("lx.wake",S.wake);localStorage.setItem("lx.project",S.project);localStorage.setItem("lx.voice",S.voice);
 localStorage.setItem("lx.pause",String(S.pause));localStorage.setItem("lx.barge",S.barge?"1":"0");localStorage.setItem("lx.follow",S.follow?"1":"0")}
function setState(next,text){state=next;$("orb").dataset.state=next;$("state").textContent=text||t(next==="off"?"off":next)}

function norm(s){return String(s||"").toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g,"").replace(/[أإآٱ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه").replace(/[^\p{L}\p{N}\s]/gu," ").replace(/\s+/g," ").trim()}
function wakeList(){return S.wake.split(/[,،]/).map(norm).filter(Boolean)}
/** The name to suggest to the owner: "Layan" when it is one of the wake words, else the first in the page's language. */
function wakeName(){var all=S.wake.split(/[,،]/).map(function(x){return x.trim()}).filter(Boolean),ar=S.lang==="ar";
 return all.find(function(x){return ar?norm(x)==="ليان":norm(x)==="layan"})||all.find(function(x){return ar?/[\u0600-\u06FF]/.test(x):/[a-z]/i.test(x)})||all[0]||"Layan"}
function tn(k,x){return t(k).replace("{x}",x||"").replace(/\{name\}/g,wakeName())}
/**
 * The command after the wake word, "" if only the name was said, null if no wake word was heard.
 * Speech-to-text spells a lone name in many ways ("اليان", "ليانا", "لايان"): when no wake word is
 * found as written, a one-letter difference is accepted for the first two words (names of 4+ letters).
 */
function afterWake(heard){var src=String(heard||""),words=[],re=/\S+/g,m;
 while((m=re.exec(src))){var n=norm(m[0]),end=m.index+m[0].length;if(n)n.split(" ").forEach(function(p){words.push({n:p,end:end})})}
 var best=null;
 function scan(fuzzy){wakeList().forEach(function(w){var parts=w.split(" ");if(fuzzy&&parts.length>1)return;
  for(var i=0;i+parts.length<=words.length&&!(fuzzy&&i>1);i++){var ok=true;for(var k=0;k<parts.length;k++)if(!(fuzzy?near(words[i+k].n,parts[k]):words[i+k].n===parts[k])){ok=false;break}
   if(!ok)continue;
   // The words after the name exactly as heard (hamza, punctuation, numbers and links intact).
   var rest=src.slice(words[i+parts.length-1].end).replace(/^[\s,،.:;!?؟\-]+/,"").trim();
   if(best===null||rest.length>best.length)best=rest;break}})}
 scan(false);if(best===null)scan(true);
 return best}
/** One letter added, missing or changed, for names of 4 or more letters. */
function near(a,b){if(a===b)return true;if(b.length<4||Math.abs(a.length-b.length)>1)return false;
 var i=0,j=0,edits=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue}if(++edits>1)return false;
  if(a.length>b.length)i++;else if(a.length<b.length)j++;else{i++;j++}}
 return edits+(a.length-i)+(b.length-j)<=1}

function api(path,opts){opts=opts||{};var headers={"content-type":"application/json"};if(legacyToken)headers.authorization="Bearer "+legacyToken;
 return fetch(path,{method:opts.method||"GET",credentials:"same-origin",headers:headers,body:opts.body?JSON.stringify(opts.body):undefined}).then(function(r){
  if(r.status===401){location.href="/setup";throw new Error("unauthorized")}
  return r.json().catch(function(){return{}}).then(function(d){if(!r.ok&&!d.reply)throw new Error(d.message||d.error||("HTTP "+r.status));return d})})}

function addLog(who,text,meta,cls){var li=document.createElement("li");li.dir="auto";li.className=(who==="you"?"you":"me")+(cls?" "+cls:"");li.textContent=text;
 if(meta){var sm=document.createElement("small");if(meta.href){var a=document.createElement("a");a.href=meta.href;a.textContent=meta.text;sm.appendChild(a)}else sm.textContent=meta.text;li.appendChild(sm)}
 $("log").appendChild(li);li.scrollIntoView({block:"end",behavior:"smooth"})}

// ---------------------------------------------------------------- speech out
var voices=[];
function loadVoices(){voices=("speechSynthesis" in window)?speechSynthesis.getVoices():[];var sel=$("voiceSel");sel.textContent="";
 var auto=document.createElement("option");auto.value="";auto.textContent=t("auto");sel.appendChild(auto);
 voices.filter(function(v){return /^(ar|en)/i.test(v.lang)}).forEach(function(v){var o=document.createElement("option");o.value=v.name;o.textContent=v.name+" ("+v.lang+")";sel.appendChild(o)});
 sel.value=S.voice;var has=voices.some(function(v){return v.lang.toLowerCase().indexOf(S.lang)===0});$("voiceNote").hidden=has||!voices.length;$("voiceNote").textContent=t("noVoice")}
function pickVoice(lang){if(S.voice){var chosen=voices.find(function(v){return v.name===S.voice});if(chosen&&chosen.lang.toLowerCase().indexOf(lang)===0)return chosen}
 var list=voices.filter(function(v){return v.lang.toLowerCase().indexOf(lang)===0});
 return list.find(function(v){return /natural|online/i.test(v.name)})||list.find(function(v){return /microsoft/i.test(v.name)})||list[0]||null}
var localTts=false,player=null,sayDone=null,interrupted=false;
/** Piper on this computer when it runs (natural Arabic voice); otherwise the browser's own voices. */
function say(text,lang){
 if(!S.speak||!text)return Promise.resolve();
 return soundReady().then(function(){return sayNow(text,lang)})}
function sayNow(text,lang){
 if(!localTts)return sayBrowser(text,lang);
 return new Promise(function(done){
  speaking=true;setState("speak");startBargeIn();
  var finished=false;var finish=function(){if(finished)return;finished=true;speaking=false;stopBargeIn();if(player){try{player.pause()}catch(e){}player=null}sayDone=null;done()};
  sayDone=finish;
  fetch("/v1/voice/speak",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({text:text,format:"wav",lang:lang||S.lang})})
   .then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.blob()})
   .then(function(blob){if(finished)return;var url=URL.createObjectURL(blob);player=new Audio(url);
    player.onended=function(){URL.revokeObjectURL(url);finish()};player.onerror=function(){URL.revokeObjectURL(url);finish()};
    return player.play()})
   .catch(function(e){if(finished)return;finished=true;speaking=false;stopBargeIn();sayDone=null;
    // The browser blocked sound (no click yet on this page): ask for one click and say it then.
    if(e&&e.name==="NotAllowedError"){needSound(text,lang);done();return}
    localTts=false;sayBrowser(text,lang).then(done)});
 })}
/**
 * Interrupting (barge-in): while LayanX speaks, the microphone keeps listening for the owner. Its own
 * voice reaches the microphone too (echo), so the first 0.4 s of a reply learn how loud that echo is;
 * a voice clearly louder than it for 0.3 s is the owner: LayanX stops talking and listens. With local
 * speech-to-text the command keeps its first syllable (the last 0.8 s of audio are kept); with the
 * browser's recognizer (while listening all the time) the recognizer starts at once.
 */
var barge={on:false,ms:0,echo:0,voiced:0,frames:[]},tap=null;
function startBargeIn(){
 if(!S.barge||blocked||realtime)return;
 barge={on:true,ms:0,echo:0,voiced:0,frames:[]};
 if(useLocal()){if(mic.ctx){mic.mode="barge";mic.buf=[];mic.voiced=0;mic.silence=0;mic.active=true}}
 else tapHold()}
function stopBargeIn(){barge.on=false;if(mic.mode==="barge"){mic.mode=null;mic.active=false}}
/** One microphone frame while speaking; true when the owner is talking over the reply. */
function bargeFrame(data,rate){
 if(!barge.on)return false;
 var sum=0;for(var i=0;i<data.length;i++)sum+=data[i]*data[i];
 var rms=Math.sqrt(sum/data.length),ms=data.length/rate*1000;
 barge.ms+=ms;barge.frames.push(new Float32Array(data));while(barge.frames.length>1&&barge.frames.length*ms>800)barge.frames.shift();
 if(barge.ms<400){barge.echo=Math.max(barge.echo,rms);return false}
 var level=Math.max(0.03,barge.echo*2.2,mic.noise*6);
 if(rms>level)barge.voiced+=ms;else{barge.voiced=Math.max(0,barge.voiced-ms/2);barge.echo=Math.max(barge.echo*0.995,rms)}
 return barge.voiced>=300}
/** Stop the reply because the owner is talking. */
function interruptReply(){interrupted=true;barge.on=false;if("speechSynthesis" in window)speechSynthesis.cancel();if(sayDone)sayDone()}
/** Browser recognizer: listen to the held microphone (the one that keeps sound allowed) during replies. */
function tapHold(){
 if(tap||!holdStream)return;
 try{var Ctx=window.AudioContext||window.webkitAudioContext,c=new Ctx(),src=c.createMediaStreamSource(holdStream),node=c.createScriptProcessor(1024,1,1);
  node.onaudioprocess=function(e){if(barge.on&&speaking&&bargeFrame(e.inputBuffer.getChannelData(0),c.sampleRate)){interruptReply();startRec("command")}};
  src.connect(node);node.connect(c.destination);if(c.state==="suspended")c.resume().catch(function(){});tap={ctx:c,node:node}}catch(e){tap=null}}
function untap(){if(tap){try{tap.node.disconnect();tap.ctx.close()}catch(e){}tap=null}}
function sayBrowser(text,lang){return new Promise(function(done){
 if(!S.speak||!("speechSynthesis" in window)||!text){done();return}
 pauseListening();speechSynthesis.cancel();
 var u=new SpeechSynthesisUtterance(text);u.lang=lang==="en"?"en-US":"ar-SA";var v=pickVoice(lang==="en"?"en":"ar");if(v)u.voice=v;u.rate=1.02;
 speaking=true;setState("speak");startBargeIn();var finished=false;
 var finish=function(){if(finished)return;finished=true;speaking=false;stopBargeIn();if(sayDone===finish)sayDone=null;done()};
 sayDone=finish;
 u.onend=finish;u.onerror=function(e){if(e&&e.error==="not-allowed")needSound(text,lang);finish()};
 speechSynthesis.speak(u);
 setTimeout(function(){if(!speechSynthesis.speaking)finish()},Math.max(5000,text.length*130));
})}
/**
 * Browsers play sound only after the user clicked the page, or while the page is using the microphone.
 * Opened by LayanX (?listen=1) and spoken to without a click, the replies were silent with the
 * browser's speech recognition. So: while listening all the time, the page holds the microphone it
 * already has permission for (nothing is recorded or sent), and if sound is still blocked a single
 * "click once" button appears and plays the reply that was missed.
 */
var holdStream=null,holdPending=null,missed=null;
function holdMic(on){
 if(!on){untap();if(holdStream){holdStream.getTracks().forEach(function(x){x.stop()});holdStream=null}return}
 if(holdStream||holdPending||useLocal()||!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)return;
 holdPending=navigator.mediaDevices.getUserMedia({audio:true}).then(function(s){holdPending=null;if(!S.always){s.getTracks().forEach(function(x){x.stop()});return}holdStream=s},function(){holdPending=null})}
/** A reply that comes while the microphone is still opening (a slow PC) waits for it (at most 3 s), so its sound is allowed. */
function soundReady(){return holdPending?Promise.race([holdPending,new Promise(function(r){setTimeout(r,3000)})]):Promise.resolve()}
function needSound(text,lang){missed={text:text,lang:lang};var b=$("soundBtn");b.textContent=t("soundBtn");b.hidden=false}
function soundUnlocked(){var b=$("soundBtn");if(b.hidden)return;b.hidden=true;var m=missed;missed=null;if(m&&!busy)say(m.text,m.lang).then(function(){if(!busy)resumeListening()})}
function stopSpeaking(){if("speechSynthesis" in window)speechSynthesis.cancel();if(sayDone)sayDone();speaking=false;if(!busy)resumeListening()}
function chime(){try{var c=new (window.AudioContext||window.webkitAudioContext)();var o=c.createOscillator(),g=c.createGain();o.frequency.value=880;g.gain.value=0.06;o.connect(g);g.connect(c.destination);o.start();o.frequency.linearRampToValueAtTime(1320,c.currentTime+0.12);o.stop(c.currentTime+0.15)}catch(e){}}

// ---------------------------------------------------------------- brain
function localCommand(text){var n=norm(text);
 if(/^(توقف|اسكت|كفى|stop|be quiet|enough)$/.test(n)){stopSpeaking();return true}
 if(/(تحدث|كلمني|تكلم).*(انجليزي|الانجليزيه)|speak english|switch to english/.test(n)){setLang("en");addLog("me","OK, English from now on.");say("OK, English from now on.","en");return true}
 if(/(تحدث|كلمني|تكلم).*(عربي|العربيه)|speak arabic|switch to arabic/.test(n)){setLang("ar");addLog("me","حسناً، سأتحدث بالعربية.");say("حسناً، سأتحدث بالعربية.","ar");return true}
 return false}
function handle(text,spoken){text=String(text||"").trim();if(!text||busy)return Promise.resolve();interrupted=false;
 addLog("you",text);if(localCommand(text)){resumeListening();return Promise.resolve()}
 busy=true;pauseListening();setState("think");
 return api("/v1/assistant/turn",{method:"POST",body:{text:text,lang:"auto",projectId:S.project,history:convo,allowTasks:S.tasks}}).then(function(d){
  convo.push({role:"user",text:text});convo.push({role:"assistant",text:d.reply||""});convo=convo.slice(-6);
  var meta=null;
  if(d.task&&d.task.paused)meta={text:t("approvals"),href:"/#approvals"};
  else if(d.missionId)meta={text:t("mission")+" "+d.missionId};
  addLog("me",d.reply||"…",meta,d.ok===false?"err":"");
  busy=false;
  return say(d.reply,d.lang)}).catch(function(e){if(e.message!=="unauthorized")addLog("me",t("netErr")+e.message,null,"err")}).then(function(){busy=false;resumeListening();
   // A conversation: after answering something said aloud, the next sentence (8 s) needs no name.
   if(spoken&&S.follow&&S.always&&!interrupted&&!blocked&&canListen())awaitCommand()})}

// ---------------------------------------------------------------- speech in
function startRec(mode){
 if(useLocal())return startLocal(mode);
 if(!SR||blocked||busy||speaking||realtime)return;
 stopRec();recMode=mode;
 // Both modes are continuous: the recognizer ends a sentence at every short pause, and what follows
 // belongs to the same request until a silence as long as the "wait for the end of my speech" setting.
 var r=new SR();rec=r;r.lang=S.lang==="en"?"en-US":"ar-SA";r.interimResults=true;r.continuous=true;r.maxAlternatives=1;
 r.onstart=function(){setState(mode==="wake"?"wake":"listen")};
 r.onresult=function(e){for(var i=e.resultIndex;i<e.results.length;i++){var res=e.results[i],heard=res[0]?res[0].transcript:"";
   if(mode==="command"||gathering()){gather(heard,res.isFinal);continue}
   if(!res.isFinal){if(Date.now()<mic.pendingUntil)gather(heard,false);continue}
   var rest=afterWake(heard);
   if(rest===null){if(Date.now()<mic.pendingUntil){gather(heard,true);continue}heardHint(heard);continue}
   chime();
   if(rest){gather(rest,true);continue}
   // Only the name: this session keeps listening (stopping it here lost what was said next);
   // the next sentence, within 8 s, is the command.
   awaitCommand()}};
 r.onerror=function(e){if(e.error==="not-allowed"||e.error==="service-not-allowed"){blocked=true;dropGathered();setState("off",t("denied"));$("always").checked=false;S.always=false;save()}};
 r.onend=function(){if(rec!==r)return;rec=null;var was=recMode;recMode=null;
   if(gathering()){sendGathered();return}
   if(blocked||busy||speaking)return;
   if(was==="command"){scheduleResume(300);return}
   if(was==="wake")scheduleResume(250)};
 try{r.start()}catch(e){scheduleResume(800)}}
/** What the browser recognizer heard of the current request; it goes out after the pause. */
var said={text:"",interim:"",timer:null};
function gathering(){return said.timer!==null}
function gather(text,isFinal){
 text=String(text||"").trim();
 if(isFinal){if(text)said.text=said.text?said.text+" "+text:text;said.interim=""}else said.interim=text;
 clearTimeout(said.timer);said.timer=setTimeout(sendGathered,S.pause+(isFinal?0:800));
 if(state!=="listen")setState("listen")}
function sendGathered(){
 var x=(said.text+(said.interim?" "+said.interim:"")).trim();dropGathered();if(!x)return;
 endPending();recMode=null;if(rec){var r=rec;rec=null;try{r.abort()}catch(e){}}handle(x,true)}
function dropGathered(){clearTimeout(said.timer);said.timer=null;said.text="";said.interim=""}
function stopRec(){dropGathered();mic.active=false;mic.buf=[];mic.voiced=0;mic.silence=0;if(rec){var r=rec;rec=null;recMode=null;try{r.abort()}catch(e){}}}
function scheduleResume(ms){clearTimeout(restartTimer);restartTimer=setTimeout(resumeListening,ms)}
function pauseListening(){clearTimeout(restartTimer);stopRec()}
function resumeListening(){if(busy||speaking||realtime)return;
 // After an interruption the owner's command is being heard: do not go back to waiting for the name.
 if(interrupted&&(useLocal()?mic.mode==="command"&&mic.active:recMode==="command"&&!!rec))return;holdMic(S.always&&!blocked);if(S.always&&canListen()&&!blocked)startRec("wake");else setState(canListen()?"idle":"off",canListen()?t("ready"):t("noSR"))}

// ---------------------------------------------------------------- local speech-to-text (Whisper on this PC)
var localStt=false;
var mic={ctx:null,stream:null,active:false,mode:null,buf:[],pre:[],voiced:0,silence:0,noise:0.008,pendingUntil:0,rate:16000,epoch:0,checking:false,nextCheck:0};
/** Audio kept from just before speech starts (the first syllable), and the longest request. */
var PRE_MS=500,MAX_MS=30000;
var senseOn=false;
function useLocal(){return localStt&&S.engine!=="browser"}
function canListen(){return useLocal()||(!!SR&&S.engine!=="local")}
function startLocal(mode){
 if(blocked||busy||speaking||realtime)return;
 mic.mode=mode;mic.buf=[];mic.voiced=0;mic.silence=0;
 if(mic.ctx){if(mic.ctx.state==="suspended")mic.ctx.resume();mic.active=true;setState(mode==="wake"?"wake":"listen");return}
 navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}}).then(function(stream){
  var Ctx=window.AudioContext||window.webkitAudioContext,ctx;
  try{ctx=new Ctx({sampleRate:16000})}catch(e){ctx=new Ctx()}
  var src=ctx.createMediaStreamSource(stream),node=ctx.createScriptProcessor(1024,1,1);
  node.onaudioprocess=function(e){if(mic.active)onFrame(e.inputBuffer.getChannelData(0))};
  src.connect(node);node.connect(ctx.destination);
  mic.ctx=ctx;mic.stream=stream;mic.node=node;mic.rate=ctx.sampleRate;mic.active=true;setState(mode==="wake"?"wake":"listen");holdMic(false);
 }).catch(function(){blocked=true;setState("off",t("denied"))})}
/**
 * Energy-based voice detection in 64 ms frames. One request = speech until a silence as long as the
 * "wait for the end of my speech" setting (1.2 s by default; it was 0.7 s and cut people off mid-
 * sentence), at most 30 s. Speech starts above 3x the room noise and continues above 2x, so soft
 * syllables do not count as silence; the 0.5 s before it is kept, so the first syllable is not lost.
 * With voice sense on this PC (Smart Turn) a command may end sooner, once the sentence is complete,
 * but never before 60% of that pause.
 */
function onFrame(data){
 if(mic.mode==="barge"){
  if(bargeFrame(data,mic.rate)){var kept=barge.frames.slice();interruptReply();
   mic.mode="command";mic.buf=kept;mic.voiced=300;mic.silence=0;mic.epoch++;mic.active=true;setState("listen")}
  return}
 var sum=0;for(var i=0;i<data.length;i++)sum+=data[i]*data[i];
 var rms=Math.sqrt(sum/data.length),ms=data.length/mic.rate*1000,talking=mic.buf.length>0;
 if(rms>(talking?Math.max(0.008,mic.noise*2):Math.max(0.012,mic.noise*3))){
  if(!talking){mic.buf=mic.pre;mic.pre=[]}
  if(mic.silence>0)mic.epoch++;mic.voiced+=ms;mic.silence=0;mic.nextCheck=0;mic.buf.push(new Float32Array(data));if(mode()==="wake"||state!=="listen")setState("listen")}
 else if(talking){mic.silence+=ms;mic.buf.push(new Float32Array(data))}
 else{mic.noise=mic.noise*0.985+rms*0.015;mic.pre.push(new Float32Array(data));while(mic.pre.length>1&&mic.pre.length*ms>PRE_MS)mic.pre.shift()}
 if(!mic.buf.length)return;
 if(mic.buf.length*ms>=MAX_MS){flushSegment();return}
 if(senseOn&&mic.mode==="command"){
  if(mic.silence>=S.pause+800){flushSegment();return}
  if(mic.silence>=Math.max(600,S.pause*0.6)&&mic.voiced>=350&&!mic.checking&&mic.silence>=mic.nextCheck){
   var snap=mic.buf.slice(),epoch=mic.epoch;mic.checking=true;mic.nextCheck=mic.silence+500;
   fetch("/v1/voice/turn",{method:"POST",credentials:"same-origin",headers:{"content-type":"audio/wav"},body:encodeWav(snap,mic.rate)})
    .then(function(r){return r.ok?r.json():null}).then(function(d){mic.checking=false;
     // Same pause as the snapshot (no new speech since) and the sentence is complete: answer now.
     if(d&&d.complete&&mic.mode==="command"&&mic.active&&mic.epoch===epoch&&mic.silence>0&&mic.buf.length)flushSegment()})
    .catch(function(){mic.checking=false;senseOn=false})}
  return}
 if(mic.silence>=S.pause)flushSegment()}
/** A lone name is short (0.3-0.5 s): it was dropped as too short to send, so "Layan … hello" reached the page as "hello". */
function flushSegment(){var chunks=mic.buf,voiced=mic.voiced;mic.buf=[];mic.voiced=0;mic.silence=0;mic.nextCheck=0;
 if(voiced>=(mic.mode==="wake"?200:250))sendSegment(chunks);else if(mic.mode==="wake")setState("wake")}
function mode(){return mic.mode}
/**
 * Clips are transcribed one after another, in the order they were said. While waiting for the name
 * the microphone keeps listening during transcription (a CPU model takes seconds): the command said
 * right after "Layan" used to be lost because the microphone was off while the name was transcribed.
 */
var sttQueue=Promise.resolve(),sttWaiting=0,pendingTimer=null;
function sendSegment(chunks){
 var m=mic.mode,wav=encodeWav(chunks,mic.rate);
 if(m==="command"){mic.active=false;interrupted=false;setState("think",t("transcribing"))}
 else{if(sttWaiting>=3)return;if(Date.now()>=mic.pendingUntil)setState("wake")}
 sttWaiting++;
 sttQueue=sttQueue.then(function(){return transcribeClip(wav)}).then(function(text){sttWaiting--;onTranscript(text,m)},
  function(e){sttWaiting--;addLog("me",t("netErr")+e.message,null,"err");if(m==="command"||!mic.active)resumeListening()})}
function transcribeClip(wav){
 return fetch("/v1/voice/transcribe",{method:"POST",credentials:"same-origin",headers:{"content-type":"audio/wav","x-layanx-filename":"voice.wav","x-layanx-language":S.lang},body:wav})
  .then(function(r){return r.json().catch(function(){return{}}).then(function(d){if(!r.ok)throw new Error(d.error||("HTTP "+r.status));return String(d.text||"").trim()})})}
function onTranscript(text,m){
 if(busy)return;
 var empty=!text||/^[\[(].*[\])]$/.test(text);
 if(m==="command"){endPending();if(empty)resumeListening();else handle(text,true);return}
 if(empty)return;
 var rest=afterWake(text);
 if(rest===null){if(Date.now()<mic.pendingUntil){endPending();handle(text,true);return}heardHint(text);return}
 chime();
 if(rest){endPending();handle(rest,true);return}
 awaitCommand()}
/** Only the name was heard: what is said next (within 8 s) is the command, without saying the name again. */
function awaitCommand(){
 mic.pendingUntil=Date.now()+8000;clearTimeout(pendingTimer);
 if(useLocal()&&mic.ctx&&!busy&&!speaking&&mic.mode==="wake"){mic.mode="command";mic.active=true}
 if(!busy&&!speaking&&!(useLocal()&&mic.buf.length))setState("listen",t("sayIt"));
 pendingTimer=setTimeout(function(){if(busy||speaking||gathering())return;mic.pendingUntil=0;
  if(useLocal()){if(mic.mode==="command"&&mic.active&&!mic.buf.length){mic.mode="wake";setState("wake")}}else if(recMode==="wake")setState("wake")},8000)}
function endPending(){mic.pendingUntil=0;clearTimeout(pendingTimer)}
/** What was heard without the name, shown so the owner can see the recognizer works (and what it understood). */
function heardHint(text){if(state==="wake"||state==="listen")setState("wake",tn("heardNoName",String(text).slice(0,60)))}
function encodeWav(chunks,rate){
 var len=0;chunks.forEach(function(c){len+=c.length});var data=new Float32Array(len),o=0;chunks.forEach(function(c){data.set(c,o);o+=c.length});
 if(rate!==16000){var ratio=rate/16000,n=Math.floor(len/ratio),r=new Float32Array(n);for(var i=0;i<n;i++){var p=i*ratio,j=Math.floor(p),f=p-j;r[i]=(data[j]||0)*(1-f)+(data[j+1]||0)*f}data=r}
 var buf=new ArrayBuffer(44+data.length*2),v=new DataView(buf);
 function w(off,str){for(var k=0;k<str.length;k++)v.setUint8(off+k,str.charCodeAt(k))}
 w(0,"RIFF");v.setUint32(4,36+data.length*2,true);w(8,"WAVE");w(12,"fmt ");v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
 v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,"data");v.setUint32(40,data.length*2,true);
 for(var q=0;q<data.length;q++){var x=Math.max(-1,Math.min(1,data[q]));v.setInt16(44+q*2,x<0?x*0x8000:x*0x7fff,true)}
 return new Blob([buf],{type:"audio/wav"})}

// ---------------------------------------------------------------- optional OpenAI Realtime
function startRealtime(){var pc,dc,stream;pauseListening();setState("listen");
 return api("/v1/voice/realtime-token",{method:"POST",body:{projectId:S.project}}).then(function(tok){if(!tok.value)throw new Error(tok.error||"no token");
  pc=new RTCPeerConnection();var audio=$("player");pc.ontrack=function(e){audio.srcObject=e.streams[0];audio.play().catch(function(){})};
  dc=pc.createDataChannel("oai-events");dc.onmessage=function(ev){var d;try{d=JSON.parse(ev.data)}catch(e){return}
   if(d.type==="response.output_audio_transcript.done"&&d.transcript)addLog("me",d.transcript);
   if(d.type==="response.done"){(d.response&&d.response.output||[]).forEach(function(item){if(item.type!=="function_call"||item.name!=="layanx_execute")return;
     var args={};try{args=JSON.parse(item.arguments||"{}")}catch(e){}
     api("/v1/agent/gateway",{method:"POST",body:{goal:String(args.goal||""),projectId:args.projectId||S.project,maxSteps:10}}).catch(function(e){return{ok:false,error:String(e)}}).then(function(result){
      dc.send(JSON.stringify({type:"conversation.item.create",item:{type:"function_call_output",call_id:item.call_id,output:JSON.stringify(result)}}));dc.send(JSON.stringify({type:"response.create"}))})})}};
  return navigator.mediaDevices.getUserMedia({audio:true}).then(function(s){stream=s;s.getTracks().forEach(function(tr){pc.addTrack(tr,s)});return pc.createOffer()})
   .then(function(offer){return pc.setLocalDescription(offer).then(function(){return offer})})
   .then(function(offer){return fetch("https://api.openai.com/v1/realtime/calls",{method:"POST",headers:{Authorization:"Bearer "+tok.value,"Content-Type":"application/sdp"},body:offer.sdp})})
   .then(function(r){if(!r.ok)return r.text().then(function(x){throw new Error(x)});return r.text()}).then(function(sdp){return pc.setRemoteDescription({type:"answer",sdp:sdp})})
   .then(function(){realtime={pc:pc,dc:dc,stream:stream};setState("listen");$("realtimeBtn").textContent=t("realtimeStop")})
 }).catch(function(e){addLog("me",t("netErr")+e.message,null,"err");stopRealtime()})}
function stopRealtime(){if(realtime){try{realtime.dc.close();realtime.pc.close();realtime.stream.getTracks().forEach(function(x){x.stop()})}catch(e){}}realtime=null;$("realtimeBtn").textContent=t("realtime");resumeListening()}

// ---------------------------------------------------------------- UI wiring
function setLang(lang){S.lang=lang;save();document.documentElement.lang=lang;document.documentElement.dir=lang==="ar"?"rtl":"ltr";
 document.querySelectorAll(".seg button").forEach(function(b){b.setAttribute("aria-pressed",String(b.dataset.lang===lang))});
 $("l-always").textContent=t("always");$("l-speak").textContent=t("speakL");$("l-tasks").textContent=t("tasks");$("reportBtn").textContent=t("report");$("stopBtn").textContent=t("stop");
 $("sendBtn").textContent=t("send");$("sayInput").placeholder=t("placeholder");$("l-settings").textContent=t("settings");$("l-wake").textContent=t("wakeL");$("l-project").textContent=t("projectL");$("l-voice").textContent=t("voiceL");
 $("hint").textContent=S.always?t("hintWake"):t("hintTap");$("engineNote").textContent=useLocal()?t("engineLocal"):(S.engine==="local"?t("noLocal"):(SR?t("engineFree"):t("noSR")));
 $("l-engine").textContent=t("engineL");$("eng-auto").textContent=t("engAuto");$("eng-local").textContent=t("engLocal");$("eng-browser").textContent=t("engBrowser");$("briefTitle").textContent=t("brief");$("briefPlay").textContent=t("briefPlay");
 $("l-pause").textContent=t("pauseL");$("p-short").textContent=t("pShort");$("p-normal").textContent=t("pNormal");$("p-long").textContent=t("pLong");$("l-barge").textContent=t("bargeL");$("l-follow").textContent=t("followL");
 $("realtimeBtn").textContent=realtime?t("realtimeStop"):t("realtime");loadVoices();
 if(rec){pauseListening();resumeListening()}else if(!busy&&!speaking)setState(state,(state==="off"||state==="idle")?(SR?t("ready"):t("noSR")):undefined)}

document.querySelectorAll(".seg button").forEach(function(b){b.onclick=function(){setLang(b.dataset.lang)}});
$("orb").onclick=function(){if(speaking){stopSpeaking();return}if(!canListen()){$("sayInput").focus();setState("off",t("noSR"));return}blocked=false;pauseListening();startRec("command")};
$("always").checked=S.always;$("always").onchange=function(e){S.always=e.target.checked;blocked=false;save();$("hint").textContent=S.always?t("hintWake"):t("hintTap");if(!S.always)holdMic(false);pauseListening();resumeListening();welcome()};
/** When it starts listening all the time, say in the log that it is ready and how to begin. */
function welcome(){if(S.always&&canListen())addLog("me",tn("welcome"))}
$("speakOn").checked=S.speak;$("speakOn").onchange=function(e){S.speak=e.target.checked;save();if(!S.speak)stopSpeaking()};
$("tasksOn").checked=S.tasks;$("tasksOn").onchange=function(e){S.tasks=e.target.checked;save()};
$("wakeWords").value=S.wake;$("wakeWords").onchange=function(e){S.wake=e.target.value.trim()||DEFAULT_WAKE;e.target.value=S.wake;save()};
$("project").value=S.project;$("project").onchange=function(e){S.project=e.target.value.trim()||"default";save()};
$("voiceSel").onchange=function(e){S.voice=e.target.value;save()};
$("pauseSel").value=String(S.pause);$("pauseSel").onchange=function(e){S.pause=Number(e.target.value)||1200;save()};
$("followOn").checked=S.follow;$("followOn").onchange=function(e){S.follow=e.target.checked;save()};
$("bargeOn").checked=S.barge;$("bargeOn").onchange=function(e){S.barge=e.target.checked;save();if(!S.barge)stopBargeIn()};
$("engineSel").value=S.engine;$("engineSel").onchange=function(e){S.engine=e.target.value;save();pauseListening();setLang(S.lang);resumeListening()};
$("reportBtn").onclick=function(){handle(S.lang==="en"?"give me a status report":"أعطني تقرير اليوم")};
$("stopBtn").onclick=stopSpeaking;
$("soundBtn").onclick=soundUnlocked;
document.addEventListener("pointerdown",function(e){if(e.target&&e.target.id!=="soundBtn")setTimeout(soundUnlocked,0)},true);
document.addEventListener("keydown",function(){setTimeout(soundUnlocked,0)},true);
$("realtimeBtn").onclick=function(){if(realtime)stopRealtime();else startRealtime()};
$("sayForm").onsubmit=function(e){e.preventDefault();var v=$("sayInput").value;$("sayInput").value="";handle(v)};
$("briefPlay").onclick=function(){say($("briefText").textContent,S.lang)};
if("speechSynthesis" in window)speechSynthesis.onvoiceschanged=loadVoices;
document.addEventListener("visibilitychange",function(){if(!document.hidden&&S.always&&!rec)resumeListening()});

api("/v1/voice/status").then(function(d){var v=d.voice||{};if(v.enabled)$("realtimeBtn").hidden=false;
 if(v.tts==="local")localTts=true;
 if(v.sense)senseOn=true;
 if(v.localStt){localStt=true;setLang(S.lang);if(S.always){pauseListening();resumeListening()}}}).catch(function(){});
api("/v1/assistant/briefing").then(function(d){var b=d.briefing;if(!b||!b.report)return;if(b.date!==new Date().toISOString().slice(0,10))return;
 $("briefText").textContent=b.report.text[S.lang]||b.report.text.ar;$("briefing").hidden=false}).catch(function(){});
setLang(S.lang);
resumeListening();
welcome();
window.__layanx={afterWake:afterWake,norm:norm,handle:handle,encodeWav:encodeWav,useLocal:function(){return useLocal()},holdingMic:function(){return!!holdStream},pause:function(){return S.pause}};
</script>
</body></html>`;
}
