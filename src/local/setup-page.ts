/**
 * Local control page: is LayanX running, which installed model does which
 * job, keys stored on this PC, agent roles, and phone pairing.
 * No external fonts, scripts or images: it must work offline and must not
 * leak anything to third parties.
 */
export function renderSetupPage(nonce:string):string{
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>LayanX على هذا الجهاز</title>
<style nonce="${nonce}">
:root{
  --mist:#E9EEF0;--surface:#FBFCFC;--ink:#18232D;--soft:#4D5D69;--line:#C9D3D9;
  --jade:#0E7C66;--jade-wash:#DCEFEA;--amber:#A86A12;--amber-wash:#F6EBD6;--rose:#B3364A;
  --sans:"Segoe UI Variable Text","Segoe UI","Noto Sans Arabic",Tahoma,sans-serif;
  --mono:"Cascadia Mono",Consolas,"Noto Sans Mono",monospace;
}
@media (prefers-color-scheme:dark){:root{
  --mist:#13202A;--surface:#1A2934;--ink:#E6EDF0;--soft:#9FB1BC;--line:#2E4250;
  --jade:#3FBF9F;--jade-wash:#173A35;--amber:#E3A64A;--amber-wash:#3A2E19;--rose:#F07A8C;
}}
*{box-sizing:border-box}
html{background:var(--mist);color:var(--ink);font:16px/1.65 var(--sans)}
body{margin:0}
.wrap{max-width:72rem;margin:0 auto;padding:2.5rem 1.5rem 4rem}
header{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:1rem 2rem;padding-bottom:1.75rem;border-bottom:1px solid var(--line)}
h1{font-size:2.25rem;line-height:1.2;margin:0;font-weight:650;letter-spacing:-.01em}
.state{display:flex;align-items:center;gap:.6rem;margin:.5rem 0 0;color:var(--soft)}
.dot{width:.7rem;height:.7rem;border-radius:50%;background:var(--line);flex:none}
.dot.ok{background:var(--jade);box-shadow:0 0 0 4px var(--jade-wash)}
.dot.warn{background:var(--amber);box-shadow:0 0 0 4px var(--amber-wash)}
.actions{display:flex;gap:.5rem;flex-wrap:wrap}
button,.btn{font:inherit;font-size:.95rem;border-radius:.45rem;border:1px solid var(--line);background:var(--surface);color:var(--ink);padding:.5rem 1rem;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:.4rem}
button:hover,.btn:hover{border-color:var(--soft)}
button.primary{background:var(--jade);border-color:var(--jade);color:#fff}
@media (prefers-color-scheme:dark){button.primary{color:#0D1A16}}
button.danger{color:var(--rose)}
button:disabled{opacity:.55;cursor:default}
:focus-visible{outline:3px solid var(--jade);outline-offset:2px}
.banner{margin:1.5rem 0 0;padding:.85rem 1.1rem;border-radius:.5rem;background:var(--amber-wash);display:flex;flex-wrap:wrap;gap:.75rem 1.5rem;align-items:center;justify-content:space-between}
.grid{display:grid;grid-template-columns:minmax(0,1fr) 22rem;gap:3rem;margin-top:2.25rem}
@media (max-width:60rem){.grid{grid-template-columns:1fr;gap:2.5rem}}
section+section{margin-top:2.75rem}
h2{font-size:1.3rem;margin:0 0 .35rem;font-weight:650}
.lead{margin:0 0 1.1rem;color:var(--soft);max-width:44rem}
table{width:100%;border-collapse:collapse}
th,td{text-align:start;padding:.7rem .5rem;border-bottom:1px solid var(--line);vertical-align:middle}
th{font-weight:600;width:34%}
th small{display:block;font-weight:400;color:var(--soft);font-size:.85rem}
td code,.mono{font-family:var(--mono);font-size:.92rem;direction:ltr;unicode-bidi:isolate}
select,input{font:inherit;font-size:.95rem;width:100%;padding:.5rem .65rem;border:1px solid var(--line);border-radius:.4rem;background:var(--surface);color:var(--ink)}
.models{list-style:none;margin:1rem 0 0;padding:0}
.models li{display:flex;flex-wrap:wrap;gap:.35rem .9rem;align-items:baseline;padding:.6rem 0;border-bottom:1px dashed var(--line)}
.models .meta{color:var(--soft);font-size:.88rem}
.chip{font-size:.78rem;padding:.08rem .5rem;border-radius:1rem;background:var(--jade-wash);color:var(--jade)}
.chip.guess{background:transparent;border:1px dashed var(--line);color:var(--soft)}
.fix{margin-top:.75rem;padding:.75rem 1rem;border-inline-start:3px solid var(--amber);background:var(--surface)}
.fix code{font-family:var(--mono);direction:ltr;unicode-bidi:isolate}
.secrets{list-style:none;padding:0;margin:0 0 1rem}
.secrets li{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:.45rem 0;border-bottom:1px solid var(--line)}
.secrets .sys{color:var(--soft);font-size:.85rem}
form.row{display:grid;grid-template-columns:1fr 1fr auto;gap:.6rem;align-items:end}
@media (max-width:40rem){form.row{grid-template-columns:1fr}}
label{display:block;font-size:.88rem;color:var(--soft);margin-bottom:.25rem}
.roles{display:grid;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));gap:.4rem 1.5rem}
.roles label{display:flex;gap:.6rem;align-items:center;color:var(--ink);font-size:.95rem;margin:0;padding:.35rem 0}
.roles input{width:auto;accent-color:var(--jade)}
aside{align-self:start;position:sticky;top:1.5rem;background:var(--surface);border:1px solid var(--line);border-radius:.75rem;padding:1.5rem}
aside h2{margin-bottom:.5rem}
.switch{display:flex;gap:.6rem;align-items:flex-start;margin:.75rem 0 1rem}
.switch input{width:auto;margin-top:.35rem;accent-color:var(--jade)}
.code{font-family:var(--mono);font-size:clamp(1.9rem,4.2vw,2.5rem);font-weight:600;letter-spacing:.06em;white-space:nowrap;direction:ltr;text-align:center;margin:1.25rem 0 .25rem;line-height:1.1}
.code-meta{text-align:center;color:var(--soft);font-size:.9rem;margin:0}
.urls{list-style:none;padding:0;margin:.75rem 0 0;text-align:center}
.urls li{font-family:var(--mono);direction:ltr}
.urls li.note{font-family:var(--sans);direction:rtl}
.note{font-size:.85rem;color:var(--soft);margin:1rem 0 0}
.devices{list-style:none;padding:0;margin:.5rem 0 0}
.devices li{display:flex;justify-content:space-between;align-items:center;gap:.75rem;padding:.5rem 0;border-top:1px solid var(--line)}
.devices small{display:block;color:var(--soft)}
.links{display:flex;flex-direction:column;gap:.5rem;margin-top:.5rem}
.toast{position:fixed;inset-inline-start:1.5rem;bottom:1.5rem;background:var(--ink);color:var(--mist);padding:.7rem 1.1rem;border-radius:.5rem;max-width:26rem}
.locked{max-width:36rem;margin:12vh auto;padding:0 1.5rem}
.cloud{display:grid;gap:.9rem}
.cloud-row{display:grid;grid-template-columns:minmax(9rem,12rem) 1fr auto;gap:.6rem 1rem;align-items:center;padding:.8rem 0;border-bottom:1px solid var(--line)}
@media (max-width:40rem){.cloud-row{grid-template-columns:1fr}}
.cloud-row b{display:block}
.cloud-row small{color:var(--soft)}
.pill{display:inline-block;font-size:.78rem;padding:.05rem .55rem;border-radius:1rem;background:var(--jade-wash);color:var(--jade)}
.pill.off{background:transparent;border:1px dashed var(--line);color:var(--soft)}
.policy{display:grid;gap:.35rem;margin:.5rem 0 1rem}
.policy label{display:flex;gap:.6rem;align-items:flex-start;color:var(--ink);font-size:.95rem;margin:0}
.policy input{width:auto;margin-top:.35rem;accent-color:var(--jade)}
.remote-box{margin-top:1.25rem;padding-top:1rem;border-top:1px solid var(--line)}
.addr{font-family:var(--mono);direction:ltr;font-size:.85rem;word-break:break-all}
[hidden]{display:none!important}
@media (prefers-reduced-motion:no-preference){.dot.ok{transition:box-shadow .3s}}
</style>
</head>
<body>
<div class="locked" id="locked" hidden>
  <h1>افتح LayanX من الاختصار</h1>
  <p class="lead">لحماية أسرارك تعمل هذه الصفحة فقط عند فتحها من اختصار <b>LayanX</b> على سطح المكتب. انقر عليه نقراً مزدوجاً وسيفتح المتصفح هنا تلقائياً.</p>
</div>

<div class="wrap" id="app" hidden>
  <header>
    <div>
      <h1>LayanX على هذا الجهاز</h1>
      <p class="state"><span class="dot" id="state-dot"></span><span id="state-text">جارٍ التحقق…</span></p>
    </div>
    <div class="actions">
      <button id="restart">إعادة التشغيل</button>
      <button id="shutdown" class="danger">إيقاف LayanX</button>
    </div>
  </header>

  <div class="banner" id="restart-banner" hidden>
    <span>حفظتَ تغييرات تُطبَّق بعد إعادة التشغيل.</span>
    <button class="primary" id="restart-now">إعادة التشغيل الآن</button>
  </div>

  <div class="grid">
    <main>
      <section>
        <h2>من يقوم بأي عمل</h2>
        <p class="lead" id="ollama-line">يختار LayanX لكل مهمة أنسب نموذج مثبت في Ollama على هذا الجهاز.</p>
        <table><tbody id="roster"></tbody></table>
        <div class="fix" id="ollama-fix" hidden></div>
        <ul class="models" id="models"></ul>
        <p><button id="refresh-models">إعادة فحص النماذج</button></p>
      </section>

      <section>
        <h2>مفاتيح الخدمات</h2>
        <p class="lead">تُحفظ مشفّرة لحساب <span id="backend-label">هذا المستخدم</span> فقط، خارج مجلد المشروع، ولا تُرسل لأي جهة. لا تظهر القيم بعد الحفظ.</p>
        <ul class="secrets" id="secrets"></ul>
        <form class="row" id="secret-form" autocomplete="off">
          <div><label for="secret-name">اسم المفتاح</label><input id="secret-name" list="known-secrets" placeholder="OPENAI_API_KEY" required pattern="[A-Z][A-Z0-9_]{1,63}" dir="ltr"></div>
          <div><label for="secret-value">القيمة</label><input id="secret-value" type="password" required dir="ltr"></div>
          <button class="primary" type="submit">حفظ المفتاح</button>
          <datalist id="known-secrets"></datalist>
        </form>
      </section>

      <section>
        <h2>المساعد الشخصي</h2>
        <p class="lead">مساعد صوتي بالعربية والإنجليزية: ناده باسمه، اطلب منه مهمة أو تقريراً، ويرد عليك بالصوت. يعمل في Microsoft Edge أو Google Chrome.</p>
        <div class="roles">
          <label><input type="checkbox" id="assistant-open"> فتح المساعد تلقائياً عند تشغيل LayanX</label>
        </div>
        <form class="row" id="briefing-form" style="margin-top:.75rem">
          <div><label for="briefing-time">وقت التقرير اليومي (اتركه فارغاً لإيقافه)</label><input id="briefing-time" type="time" dir="ltr"></div>
          <div></div>
          <button type="submit">حفظ الوقت</button>
        </form>
        <p class="lead" id="stt-line" style="margin-top:1rem"></p>
        <p><a class="btn" href="/voice" id="assistant-link">افتح المساعد الصوتي</a></p>
      </section>

      <section>
        <h2>الذكاء السحابي للمهام الصعبة</h2>
        <p class="lead">يعمل LayanX بنماذجك المحلية أولاً. أضف مفتاح Claude أو OpenAI أو Gemini ليتولى المهام التي لا يقدر عليها النموذج المحلي. يمكنك أيضاً طلبه بالاسم: «استخدم كلود…». المفاتيح تُحفظ في «مفاتيح الخدمات» أعلاه.</p>
        <div class="policy" id="cloud-policy">
          <label><input type="radio" name="policy" value="off"> <span>محلي فقط، لا ترسل شيئاً للسحابة</span></label>
          <label><input type="radio" name="policy" value="fallback"> <span>محلي أولاً، والسحابة عندما يفشل النموذج المحلي</span></label>
          <label><input type="radio" name="policy" value="complex"> <span>السحابة للمهام المعقدة مباشرة، ومحلي لغيرها</span></label>
        </div>
        <div class="cloud" id="cloud-list"></div>
        <p class="note" id="cloud-note"></p>
        <h3 style="margin-top:1rem">حد الإنفاق الشهري للسحابة</h3>
        <p class="lead">عند بلوغ الحد يتوقف استخدام السحابة ويكمل LayanX بالنماذج المحلية حتى الشهر التالي. اكتب السعر لكل مليون رمز من صفحة أسعار المزود ليُحسب الإنفاق بالدولار، أو حدّد عدد الرموز فقط.</p>
        <form class="row" id="budget-form">
          <div><label for="budget-usd">دولار في الشهر</label><input id="budget-usd" type="number" min="0" step="0.5" dir="ltr" placeholder="مثلاً 10"></div>
          <div><label for="budget-tokens">أو رموز في الشهر</label><input id="budget-tokens" type="number" min="0" step="10000" dir="ltr" placeholder="مثلاً 2000000"></div>
          <button type="submit">حفظ الحد</button>
        </form>
        <p class="note" id="budget-usage"></p>
      </section>

      <section>
        <h2>مجلد مشاريعك</h2>
        <p class="lead">يعمل الوكيل على الملفات وGit والاختبارات داخل هذا المجلد فقط. كل مجلد بداخله مشروع؛ اكتب اسمه في خانة «المشروع» في لوحة التحكم.</p>
        <form class="row" id="ws-form"><div><label for="ws-root">المسار</label><input id="ws-root" dir="ltr" placeholder="C:\\Users\\you\\Projects"></div><div></div><button type="submit">حفظ</button></form>
        <p class="note" id="ws-note"></p>
      </section>

      <section>
        <h2>أدوار الوكيل</h2>
        <p class="lead">أوقف ما لا تستخدمه. كلما قلّت الأدوات المفعّلة اختار النموذج المحلي بشكل أدق.</p>
        <div class="roles" id="roles"></div>
      </section>
    </main>

    <aside>
      <h2>الهاتف و VS Code</h2>
      <p class="lead">اربط هاتفك بهذا الجهاز فقط. كل جهاز مربوط يحصل على مفتاح خاص يمكنك إلغاؤه في أي وقت.</p>
      <label class="switch"><input type="checkbox" id="mobile-toggle"><span>السماح للهاتف بالاتصال عبر شبكة Wi-Fi نفسها</span></label>
      <button class="primary" id="pair-start">إنشاء رمز ربط</button>
      <div id="pair-box" hidden>
        <p class="code" id="pair-code"></p>
        <p class="code-meta" id="pair-expiry"></p>
        <p class="note">في تطبيق LayanX على الهاتف أدخل أحد العناوين ثم الرمز:</p>
        <ul class="urls" id="pair-urls"></ul>
      </div>
      <p class="note" id="mobile-note"></p>
      <ul class="devices" id="devices"></ul>
      <div class="remote-box">
        <h2 style="font-size:1.1rem">التحكم من أي مكان</h2>
        <p class="note">من خارج المنزل عبر Tailscale: شبكة خاصة مشفّرة بين جهازك وهاتفك، بدون فتح أي منفذ على الإنترنت.</p>
        <label class="switch"><input type="checkbox" id="remote-toggle"><span>السماح بالتحكم من أي مكان</span></label>
        <div id="remote-detail"></div>
        <ul class="urls" id="remote-urls"></ul>
      </div>

      <h2 style="margin-top:2rem">الواجهات</h2>
      <div class="links" id="links"></div>
    </aside>
  </div>
</div>
<div class="toast" id="toast" role="status" hidden></div>

<script nonce="${nonce}">
"use strict";
const TASKS={general:["عام","المحادثة والكتابة"],planning:["التخطيط","تقسيم المهام واختيار الأدوات"],coding:["البرمجة","قراءة الكود وتعديله"],vision:["الرؤية","فهم الصور ولقطات الشاشة"],embedding:["الذاكرة","البحث في ما تعلّمه الوكيل"],fast:["الردود السريعة","المهام القصيرة"]};
const CAPS={tools:"أدوات",vision:"رؤية",thinking:"تفكير",embedding:"تضمين"};
const $=id=>document.getElementById(id);
const el=(tag,props={},...kids)=>{const n=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==="class")n.className=v;else if(k==="text")n.textContent=v;else n.setAttribute(k,v);}for(const kid of kids)if(kid)n.append(kid);return n;};
let state=null,pairTimer=null;

function toast(text){const t=$("toast");t.textContent=text;t.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>t.hidden=true,4000);}

async function api(path,method="GET",body){
  const res=await fetch(path,{method,credentials:"same-origin",headers:body?{"content-type":"application/json"}:{},body:body?JSON.stringify(body):undefined});
  if(res.status===401||res.status===403){showLocked();throw new Error("locked");}
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.message||("HTTP "+res.status));
  return data;
}
function showLocked(){$("app").hidden=true;$("locked").hidden=false;}

async function boot(){
  const match=/launch=([\\w-]+)/.exec(location.hash+"&"+location.search);
  const next=/next=([^&]+)/.exec(location.hash);
  const allowedNext=["/","/voice","/voice?listen=1"];
  if(match){
    history.replaceState(null,"",location.pathname);
    try{
      await api("/v1/session/launch","POST",{code:match[1]});
      const target=next?decodeURIComponent(next[1]):"";
      if(allowedNext.includes(target)){location.replace(target);return;}
    }catch(e){if(e.message!=="locked")toast(e.message);}
  }
  try{await load();$("locked").hidden=true;$("app").hidden=false;}catch(e){if(e.message!=="locked")toast(e.message);}
}

async function load(){state=await api("/v1/setup/status");render();}

function render(){
  const s=state,o=s.ollama;
  const ok=o.reachable&&o.models.length>0;
  $("state-dot").className="dot "+(ok?"ok":"warn");
  $("state-text").textContent=ok?"يعمل الآن، ويستخدم "+o.models.length+" "+(o.models.length===1?"نموذجاً محلياً":"نماذج محلية"):o.reachable?"يعمل، لكن لا توجد نماذج مثبتة في Ollama":"يعمل، لكن Ollama غير متاح";
  if(o.reachable)$("ollama-line").replaceChildren("Ollama ",el("bdi",{text:o.version||""})," على ",el("bdi",{class:"mono",text:o.baseUrl}),". ذاكرة الجهاز "+o.ramGB+" غيغابايت.");
  else $("ollama-line").textContent="يختار LayanX لكل مهمة أنسب نموذج مثبت في Ollama على هذا الجهاز.";
  $("restart-banner").hidden=!s.restartRequired;
  $("backend-label").textContent=s.secrets.backend==="dpapi"?"حساب Windows الحالي (DPAPI)":"هذا المستخدم";

  const roster=$("roster");roster.replaceChildren();
  for(const [task,[label,hint]] of Object.entries(TASKS)){
    const sel=el("select",{"aria-label":"نموذج "+label});
    sel.append(el("option",{value:"",text:"تلقائي: "+(o.plan.assignments[task]||"لا يوجد نموذج مناسب")}));
    for(const m of o.models)if(task==="embedding"?m.capabilities.includes("embedding"):m.capabilities.includes("completion")&&(task!=="vision"||m.capabilities.includes("vision")))
      sel.append(el("option",{value:m.name,text:m.name}));
    sel.value=s.pinnedModels[task]||"";
    sel.addEventListener("change",async()=>{try{await api("/v1/setup/settings","PUT",{pinnedModels:{[task]:sel.value||null}});await load();toast("حُفظ اختيار النموذج");}catch(e){toast(e.message);}});
    const th=el("th",{},label,el("small",{text:hint}));
    roster.append(el("tr",{},th,el("td",{},sel)));
  }

  const fix=$("ollama-fix");
  const fixes=[];
  if(!o.reachable)fixes.push(["شغّل Ollama ثم اضغط إعادة فحص النماذج. إن لم يكن مثبتاً: ","winget install Ollama.Ollama"]);
  else if(!o.models.length)fixes.push(["ثبّت نموذجاً يناسب ذاكرة جهازك: ","ollama pull "+o.recommendedPull]);
  for(const w of o.plan.warnings){
    if(/no models installed/i.test(w))continue;
    const m=/Model "([^"]+)" for (\w+) is not installed/.exec(w);
    fixes.push([m?("النموذج «"+m[1]+"» المحدد غير مثبت على هذا الجهاز، فاستُخدم أفضل نموذج مثبت بدلاً منه."):w,""]);
  }
  fix.hidden=!fixes.length;fix.replaceChildren(...fixes.map(([t,c])=>el("div",{},t,c?el("code",{text:c}):null)));

  const list=$("models");list.replaceChildren();
  for(const m of o.models){
    const chips=m.capabilities.filter(c=>CAPS[c]).map(c=>el("span",{class:"chip"+(m.source==="heuristic"?" guess":""),text:CAPS[c]}));
    const meta=[m.paramsB?m.paramsB+"B":null,m.sizeGB?m.sizeGB+" GB":null,m.contextLength?("سياق "+m.contextLength.toLocaleString("ar")):null].filter(Boolean).join("، ");
    list.append(el("li",{},el("code",{text:m.name}),el("span",{class:"meta",text:meta}),...chips));
  }

  const secrets=$("secrets");secrets.replaceChildren();
  if(!s.secrets.names.length)secrets.append(el("li",{},el("span",{class:"sys",text:"لا توجد مفاتيح محفوظة بعد."})));
  for(const item of s.secrets.names){
    const right=item.system?el("span",{class:"sys",text:"يديره LayanX"}):el("button",{class:"danger",text:"حذف"});
    if(!item.system)right.addEventListener("click",async()=>{if(!confirm("حذف "+item.name+"؟"))return;try{await api("/v1/setup/secrets/"+encodeURIComponent(item.name),"DELETE");await load();toast("حُذف المفتاح");}catch(e){toast(e.message);}});
    secrets.append(el("li",{},el("code",{class:"mono",text:item.name}),right));
  }
  $("known-secrets").replaceChildren(...s.secrets.known.map(n=>el("option",{value:n})));

  $("assistant-open").checked=!!s.assistant.openOnStart;
  $("briefing-time").value=s.assistant.briefingTime||"";
  $("stt-line").textContent=s.assistant.stt==="local"?"التعرف على الكلام: محلي على جهازك عبر Whisper (لا يخرج صوتك من الجهاز).":"التعرف على الكلام: من المتصفح. لتشغيله محلياً على جهازك ثبّت Whisper بتشغيل ⁦scripts\\\\windows\\\\install-whisper.ps1⁩ ثم أعد التشغيل.";
  const roles=$("roles");roles.replaceChildren();
  for(const [key,info] of Object.entries(s.capabilities)){
    const box=el("input",{type:"checkbox"});box.checked=info.enabled;
    box.addEventListener("change",async()=>{try{await api("/v1/setup/settings","PUT",{capabilities:{[key]:box.checked}});await load();}catch(e){box.checked=!box.checked;toast(e.message);}});
    roles.append(el("label",{},box,info.label));
  }

  $("mobile-toggle").checked=s.gateway.mobileAccess;
  $("pair-start").disabled=false;
  
  $("mobile-note").textContent=s.gateway.mobileAccess&&!s.gateway.mobileActive?"فُعّل الاتصال من الهاتف. أعد التشغيل ليبدأ العمل.":s.gateway.mobileAccess?"الاتصال داخل الشبكة المحلية غير مشفّر. استخدمه على شبكة منزلية موثوقة فقط.":"VS Code على هذا الجهاز يُربط مباشرة برمز. الهاتف يحتاج تفعيل الخيار أعلاه أو «التحكم من أي مكان».";
  const devices=$("devices");devices.replaceChildren();
  for(const d of s.devices){
    const b=el("button",{class:"danger",text:"إلغاء الربط"});
    b.addEventListener("click",async()=>{try{await api("/v1/pair/devices/"+encodeURIComponent(d.id),"DELETE");await load();toast("أُلغي ربط "+d.name);}catch(e){toast(e.message);}});
    devices.append(el("li",{},el("div",{},d.name,el("small",{text:d.lastSeenAt?"آخر اتصال "+new Date(d.lastSeenAt).toLocaleString("ar"):"لم يتصل بعد"})),b));
  }

  $("links").replaceChildren(...s.links.map(l=>el("a",{class:"btn",href:l.href,target:"_blank",rel:"noopener",text:l.label})));
  $("ws-root").value=s.workspace.configured||s.workspace.root;
  $("ws-note").textContent="المجلد الحالي: "+s.workspace.root+(s.workspace.projects.length?" · المشاريع: "+s.workspace.projects.join("، "):"");
  renderCloud(s.cloud);
  renderRemote(s.remote);
}

$("assistant-open").addEventListener("change",async e=>{try{await api("/v1/setup/settings","PUT",{openAssistantOnStart:e.target.checked});await load();toast(e.target.checked?"سيُفتح المساعد عند التشغيل":"لن يُفتح المساعد تلقائياً");}catch(err){e.target.checked=!e.target.checked;toast(err.message);}});
$("briefing-form").addEventListener("submit",async e=>{e.preventDefault();try{await api("/v1/setup/settings","PUT",{briefingTime:$("briefing-time").value||""});await load();toast($("briefing-time").value?"سيُجهَّز التقرير يومياً الساعة "+$("briefing-time").value:"أُوقف التقرير اليومي");}catch(err){toast(err.message);}});
$("refresh-models").addEventListener("click",async e=>{e.target.disabled=true;try{await api("/v1/setup/ollama/refresh","POST",{});await load();toast("فُحصت النماذج");}catch(err){toast(err.message);}finally{e.target.disabled=false;}});
$("secret-form").addEventListener("submit",async e=>{e.preventDefault();const name=$("secret-name").value.trim(),value=$("secret-value").value;try{await api("/v1/setup/secrets","PUT",{name,value});$("secret-value").value="";await load();toast("حُفظ "+name);}catch(err){toast(err.message);}});
$("mobile-toggle").addEventListener("change",async e=>{try{await api("/v1/setup/settings","PUT",{mobileAccess:e.target.checked});await load();}catch(err){e.target.checked=!e.target.checked;toast(err.message);}});
$("pair-start").addEventListener("click",async()=>{
  try{
    const p=await api("/v1/pair/start","POST",{});
    $("pair-box").hidden=false;$("pair-code").textContent=p.code;
    $("pair-urls").replaceChildren(...p.urls.map(u=>el("li",{text:u})));
    clearInterval(pairTimer);
    const end=Date.parse(p.expiresAt);
    const tick=()=>{const left=Math.max(0,Math.round((end-Date.now())/1000));$("pair-expiry").textContent=left?("ينتهي خلال "+Math.floor(left/60)+":"+String(left%60).padStart(2,"0")):"انتهت صلاحية الرمز. أنشئ رمزاً جديداً.";if(!left){clearInterval(pairTimer);$("pair-code").textContent="————";}};
    tick();pairTimer=setInterval(tick,1000);
  }catch(e){toast(e.message);}
});
async function restart(){try{await api("/v1/setup/restart","POST",{});}catch{}$("state-text").textContent="جارٍ إعادة التشغيل…";$("state-dot").className="dot warn";
  for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,1000));try{const r=await fetch("/v1/gateway/health");if(r.ok&&i>1){await load();toast("أُعيد التشغيل");return;}}catch{}}
  toast("لم يكتمل التشغيل. راجع السجل في مجلد LayanX\\logs");}
$("restart").addEventListener("click",restart);$("restart-now").addEventListener("click",restart);
$("shutdown").addEventListener("click",async()=>{if(!confirm("إيقاف LayanX؟ يمكنك تشغيله لاحقاً من الاختصار."))return;try{await api("/v1/setup/shutdown","POST",{});}catch{}document.body.replaceChildren(el("div",{class:"locked"},el("h1",{text:"توقف LayanX"}),el("p",{class:"lead",text:"شغّله مجدداً من اختصار LayanX على سطح المكتب."})));});
function renderCloud(c){
document.querySelectorAll("#cloud-policy input").forEach(i=>{i.checked=i.value===c.policy;});
  $("budget-usd").value=c.monthlyBudgetUsd??"";$("budget-tokens").value=c.monthlyTokens??"";
  fetch("/v1/cloud/usage",{credentials:"same-origin"}).then(r=>r.ok?r.json():null).then(d=>{const u=d&&d.usage;if(!u)return;
    $("budget-usage").textContent="هذا الشهر ("+u.month+"): "+u.totalTokens.toLocaleString("en")+" رمز"+(u.totalCostUsd?" ≈ $"+u.totalCostUsd.toFixed(2):"")+(u.exhausted?" — بلغ الحد، السحابة متوقفة":"")+(u.blocked?" · طلبات مُنعت: "+u.blocked:"");}).catch(()=>{});
  const list=$("cloud-list");list.replaceChildren();
  for(const p of c.providers){
    const row=el("div",{class:"cloud-row"});
    const title=el("div",{},el("b",{text:p.label}),el("small",{text:p.hasKey?(p.active?"متصل ويعمل":"المفتاح محفوظ، يعمل بعد إعادة التشغيل"):("أضف "+p.keyName+" في مفاتيح الخدمات")}));
    const sel=el("select",{"aria-label":"نموذج "+p.label});sel.append(el("option",{value:p.model,text:p.model}));
    sel.addEventListener("change",async()=>{try{await api("/v1/setup/settings","PUT",{cloud:{models:{[p.id]:sel.value}}});await load();toast("سيُستخدم "+sel.value);}catch(e){toast(e.message);}});
    const actions=el("div",{});
    const test=el("button",{text:"اختبار وعرض النماذج"});test.disabled=!p.hasKey;
    test.addEventListener("click",async()=>{test.disabled=true;try{const r=await api("/v1/setup/cloud/test","POST",{provider:p.id});if(!r.ok){toast(r.message||"فشل الاتصال");return;}
      sel.replaceChildren(...r.models.map(m=>el("option",{value:m,text:m})));if(!r.models.includes(p.model))sel.prepend(el("option",{value:p.model,text:p.model}));sel.value=p.model;toast("الاتصال يعمل: "+r.models.length+" نموذج متاح");}
      catch(e){toast(e.message);}finally{test.disabled=false;}});
    const toggle=el("label",{class:"switch",style:"margin:.4rem 0 0"});const box=el("input",{type:"checkbox"});box.checked=p.enabled;
    box.addEventListener("change",async()=>{try{await api("/v1/setup/settings","PUT",{cloud:{disabled:{[p.id]:!box.checked}}});await load();}catch(e){box.checked=!box.checked;toast(e.message);}});
    toggle.append(box,el("span",{text:"مفعّل"}));
    actions.append(test,toggle);
    // Price per 1M tokens (from the provider's pricing page) lets the monthly dollar cap work.
    const price=(c.prices||{})[p.id]||{};
    const pin=el("input",{type:"number",min:"0",step:"0.01",dir:"ltr",placeholder:"$ / 1M in","aria-label":"سعر الإدخال لكل مليون رمز "+p.label,style:"width:7rem"});pin.value=price.input??"";
    const pout=el("input",{type:"number",min:"0",step:"0.01",dir:"ltr",placeholder:"$ / 1M out","aria-label":"سعر الإخراج لكل مليون رمز "+p.label,style:"width:7rem"});pout.value=price.output??"";
    const savePrice=async()=>{if(pin.value===""||pout.value==="")return;try{await api("/v1/setup/settings","PUT",{cloud:{prices:{[p.id]:{input:Number(pin.value),output:Number(pout.value)}}}});toast("حُفظ السعر");}catch(e){toast(e.message);}};
    pin.addEventListener("change",savePrice);pout.addEventListener("change",savePrice);
    actions.append(el("div",{style:"display:flex;gap:.3rem;margin-top:.4rem"},pin,pout));
    row.append(title,sel,actions);list.append(row);
  }
  const anyKey=c.providers.some(p=>p.hasKey);
  $("cloud-note").textContent=anyKey?"الترتيب عند الحاجة: "+c.order.join(" ← ")+". تُحسب تكلفة الاستخدام على حسابك لدى كل مزود.":"لا يوجد مفتاح سحابي بعد: كل شيء يعمل محلياً.";
}
function renderRemote(r){
  $("remote-toggle").checked=r.enabled;
  const d=$("remote-detail");d.replaceChildren();
  const ts=r.tailscale||{};
  if(!ts.installed){d.append(el("p",{class:"note",text:"1) ثبّت Tailscale على الكمبيوتر والهاتف وسجّل الدخول بنفس الحساب: winget install Tailscale.Tailscale"}));}
  else if(!ts.running){d.append(el("p",{class:"note",text:"Tailscale مثبت لكنه غير متصل. افتحه وسجّل الدخول."}));}
  else{
    d.append(el("p",{class:"note",text:"Tailscale متصل"+(ts.dnsName?": "+ts.dnsName:"")}));
    if(r.enabled&&ts.dnsName){const b=el("button",{text:"تفعيل العنوان الآمن (HTTPS)"});b.addEventListener("click",async()=>{b.disabled=true;try{const x=await api("/v1/setup/remote/tailscale-serve","POST",{});toast(x.ok?"فُعّل https://"+ts.dnsName:"تعذر: "+(x.output||"").slice(0,160));await load();}catch(e){toast(e.message);}finally{b.disabled=false;}});d.append(b);}
  }
  if(r.enabled&&!r.active)d.append(el("p",{class:"note",text:"أعد التشغيل ليبدأ العمل."}));
  $("remote-urls").replaceChildren(...(r.active?r.addresses:[]).map(u=>el("li",{class:"addr",text:u})));
}
$("ws-form").addEventListener("submit",async e=>{e.preventDefault();try{await api("/v1/setup/settings","PUT",{workspaceRoot:$("ws-root").value.trim()});await load();toast("حُفظ. يعمل بعد إعادة التشغيل.");}catch(err){toast(err.message);}});
$("budget-form").addEventListener("submit",async e=>{e.preventDefault();const n=v=>v.trim()===""?null:Number(v);
  try{await api("/v1/setup/settings","PUT",{cloud:{monthlyBudgetUsd:n($("budget-usd").value),monthlyTokens:n($("budget-tokens").value)}});await load();toast("حُفظ الحد. يعمل بعد إعادة التشغيل.");}catch(err){toast(err.message);}});
document.querySelectorAll("#cloud-policy input").forEach(i=>i.addEventListener("change",async()=>{try{await api("/v1/setup/settings","PUT",{cloud:{policy:i.value}});await load();toast("حُفظت سياسة السحابة");}catch(e){toast(e.message);}}));
$("remote-toggle").addEventListener("change",async e=>{try{await api("/v1/setup/settings","PUT",{remoteAccess:e.target.checked});await load();}catch(err){e.target.checked=!e.target.checked;toast(err.message);}});
boot();
</script>
</body>
</html>`;
}
