# دمج حزمة Windows في مستودع LayanX

هذه الحزمة لا تعيد كتابة الـ runtime الحالي. هي تضيف طبقة محلية حوله: مشغّل بنقرة واحدة، خزنة أسرار مرتبطة بحساب Windows، بوابة أمان أمام الـ API، ربط الهاتف بكل تثبيت على حدة، واكتشاف تلقائي لنماذج Ollama. الـ runtime يستمر في قراءة نفس متغيرات البيئة التي يقرؤها اليوم، والبوابة تملؤها قبل تشغيله.

## 1. نسخ الملفات

انسخ محتوى الحزمة إلى جذر المستودع بنفس المسارات. ملف `src/connectors/agent-reach.ts` يستبدل الملف الحالي بالكامل (نفس الواجهة، والاختبار الحالي `tests/agent-reach.spec.ts` يبقى صالحاً). ملفات `.github/workflows/ci.yml` و`Dockerfile` و`.gitattributes` تستبدل الحالية.

## 2. package.json وملف القفل

أضف السكربتين:

```json
"local": "tsx src/start-local.ts",
"secrets": "tsx src/secrets-cli.ts"
```

ثم شغّل `npm install` مرة واحدة وارفع `package-lock.json` إلى Git. الـ CI والـ Dockerfile والمشغّل يعتمدون عليه (`npm ci`).

بعد نسخ `.gitattributes` نفّذ مرة واحدة: `git add --renormalize . && git commit -m "chore: normalize line endings"`.

## 3. تعديلات صغيرة في ملفات قائمة

### src/core/ai-planner.ts

احذف الدالة المحلية `isDevelopmentGoal` (مطابقة نصية جزئية: "latest" كانت تطابق "test") واستورد البديلة:

```ts
import {isDevelopmentGoal,selectToolsForGoal,toolBudgetFor} from "../providers/tool-selection.js";
```

اختياري ومفيد جداً للنماذج الصغيرة: أرسل للمخطِّط الأدوات المطابقة للهدف فقط بدل الكتالوج كله. في `filterCatalogForGoal`:

```ts
function filterCatalogForGoal(goal:string,catalog:ToolCatalogEntry[]):ToolCatalogEntry[]{
  const budget=toolBudgetFor(null); // 12 افتراضياً؛ 6 لنموذج 3B إن مرّرت ملف النموذج
  if(!isDevelopmentGoal(goal))return selectToolsForGoal(goal,catalog,budget);
  const allowedPrefixes=[/* القائمة الحالية كما هي */];
  const dev=catalog.filter(tool=>allowedPrefixes.some(prefix=>tool.name===prefix||tool.name.startsWith(prefix)));
  return selectToolsForGoal(goal,dev,budget);
}
```

### src/core/git-branch-manager.ts و pr-generator.ts و security-review-agent.ts

ملف CI الجديد يعمل checkout للفرع باسمه، لذلك لم يعد كود الإنتاج يحتاج الرجوع إلى `GITHUB_HEAD_REF`. أرجِع السطر:

```ts
const branch=(await this.git(["branch","--show-current"])).stdout.trim();
```

بهذا يعود المانع `"No active Git branch."` في `pr-generator.ts` للعمل بعد أن أصبح كوداً ميتاً. وأضف التحقق من المراجع قبل تمريرها لـ git:

```ts
import {assertSafeGitRef} from "../platform/git-ref.js";
// pr-generator.ts — أول سطر في generate():
const baseBranch=assertSafeGitRef(options.baseBranch,"baseBranch");
// security-review-agent.ts — أول سطر في review():
baseRef=assertSafeGitRef(baseRef,"baseRef");
```

بدون ذلك، قيمة مثل `--output=C:\x.txt` تُقرأ كخيار لـ git وتكتب ملفاً.

### src/runtime.ts — أدوار الوكيل

صفحة الإعداد تكتب الأدوار المفعّلة في `LAYANX_CAPABILITIES`. لُفّ كل تسجيل بالشرط المناسب:

```ts
import {capabilityEnabled} from "./platform/capabilities.js";

if(capabilityEnabled("email")){registerGoogleWorkspaceTools(core);registerGoogleInvoiceTool(core,googleInvoices);registerYahooMailTools(core);}
if(capabilityEnabled("research"))registerAgentReachTools(core);
if(capabilityEnabled("quran")){registerQuranTools(core);configureQuranDailySchedules(/* ... */);}
// بنفس الطريقة: social / ads / business / trading / voice / coding
```

وفي نفس الملف، رقم المشروع للرسائل الواردة يُؤخذ حالياً من `raw.projectId` القادم من الرسالة نفسها. اجعله من الإعداد فقط:

```ts
const projectId=process.env.LAYANX_CHANNEL_PROJECT_ID??"default";
```

### كل استدعاءات spawn

ابحث: `grep -rn "process.env" src | grep "\.\.\."` و `grep -rn "spawn(" src`.

- بدل `env:{...process.env}` استخدم `env:safeChildEnv({...})` من `src/platform/safe-env.ts`. الأسرار تُحمَّل الآن في `process.env` من الخزنة، فنشر البيئة كاملة يعني تسليمها لأي برنامج خارجي.
- لا تشغّل `tsx` أو `npm` أو أي `.cmd` مع `shell:false` على Windows: Node يرمي `EINVAL` منذ إصلاح CVE-2024-27980. استخدم `nodeToolCommand("tsx",args)` من `src/platform/node-tool.ts`. هذا غالباً سبب فشل "Automatic Test Verification" ومشغّل الاختبارات على Windows.
- أدوات الملفات والتعديل الآمن: مرّر كل مسار عبر `assertSafeWorkspacePath(root,path)` من `src/platform/path-guard.ts`، فهي تغطي حالات Windows (حرف القرص، حالة الأحرف، `file.txt:stream`، `CON`، النقطة أو المسافة في آخر الاسم).

### مسارات `.layanx/` المكتوبة يدوياً

المشغّل ينقل المتاجر التي لها متغيرات بيئة (business، media، vault، creator، quran...) إلى `%LOCALAPPDATA%\LayanX\store`. أي مسار مكتوب يدوياً مثل `.layanx/oauth-connections.json` يبقى داخل مجلد المشروع (مستثنى من Git لكنه ليس محمياً بـ DPAPI). انقله إلى متغير بيئة بنفس النمط.

## 4. تطبيق الهاتف (مجلد mobile/)

كل تثبيت مستقل تماماً: لا يوجد خادم مشترك ولا مفتاح مشترك. التطبيق يجب أن:

1. لا يحتوي أي عنوان خادم أو مفتاح API أو مشروع Firebase مكتوب داخله. المستخدم يدخل عنوان جهازه.
2. يرسل `POST http://<IP-الجهاز>:3000/v1/pair/complete` بالجسم `{"code":"ABCD-EFGH","deviceName":"Pixel 8"}` ويحفظ `deviceToken` في Keystore/Keychain مرتبطاً بـ `installId`.
3. يرسل بعد ذلك `Authorization: Bearer <deviceToken>` مع كل طلب. للتحقق: `GET /v1/device/whoami`. لـ WebSocket من WebView: `?layanx_token=<deviceToken>`.
4. Android يمنع HTTP افتراضياً (cleartext)، وiOS يحتاج `NSAllowsLocalNetworking` و`NSLocalNetworkUsageDescription`.

الهاتف لا يستطيع قراءة الأسرار أو تغييرها أو ربط أجهزة أخرى: هذه للمالك على الجهاز نفسه فقط.

## 5. OAuth

لا تضع Client ID/Secret الخاصة بك في المستودع. كل شخص يحمّل LayanX يسجّل تطبيقه الخاص لدى TikTok/Meta/Google ويُدخل المفاتيح من صفحة الإعداد. إن شحنت مفاتيحك، فكل المستخدمين يمرون عبر تطبيقك وحصّتك وحسابك.

## 6. التحقق

```
npm run typecheck
npm test                      # يشمل tests/local-*.spec.ts تلقائياً
npm run secrets -- selftest   # على Windows: يتحقق من DPAPI فعلياً
```
