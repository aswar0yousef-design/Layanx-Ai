# أفكار تطوير LayanX من مستودعات GitHub

تاريخ الفحص: 7 أكتوبر 2026. أعداد النجوم والرخص منقولة من صفحات المستودعات في هذا التاريخ.

## 1. قاعدة الرخص قبل أي نقل

مشروع LayanX لا يحمل ملف رخصة، فهو حالياً كود خاص بك. القاعدة إذن:

| نوع الرخصة | ماذا يُسمح |
|---|---|
| MIT / Apache-2.0 / BSD | يمكن نسخ الكود داخل LayanX مع إبقاء سطر حقوق المؤلف (وملف NOTICE في Apache). |
| GPL / LGPL / AGPL | لا يُنسخ كودها داخل LayanX. تُشغَّل كبرنامج منفصل يستدعيه LayanX (سطر أوامر أو خادم محلي). |
| CC BY-NC (غير تجاري) | لا تُستخدم في أي شيء ستبيعه أو تكسب منه، وهذا يهمّك لأن هدفك مصدر دخل. |
| CC-BY-4.0 | يُسمح بالاستخدام مع ذكر المصدر. |

## 2. أفضل عشر أفكار لتطوير الإيجنت (مرتبة حسب الفائدة مقابل الجهد على جهازك)

### الفكرة 1: إجبار النموذج المحلي على خطة صحيحة الشكل (مكسب سريع جداً)
- **الوضع الحالي في LayanX:**
  - `src/providers/ollama-provider.ts` يرسل `format:"json"` فقط.
  - `adaptive-ollama.ts` يستخدم بروتوكول أدوات نصياً يُحلَّل بعد الرد.
- **ما يتيحه Ollama:** حقل `format` يقبل **مخطط JSON Schema كاملاً**، والنموذج يُجبَر على الالتزام به. ويوجد أيضاً استدعاء أدوات أصلي عبر `tools`.
- **الفائدة:**
  - نموذج `qwen3.5:4b` و`9b` لن يُخرج خطة مكسورة.
  - يقلّ التصعيد إلى السحابة، فتوفّر المال.
- **الجهد:** تعديل صغير في مزوّد Ollama وفي `ai-planner.ts`.

### الفكرة 2: "عيون" للنماذج الصغيرة بدل الصور
- **سطح المكتب:** شجرة الوصولية في Windows (UI Automation) تعطي النموذج قائمة مرقّمة بالأزرار والحقول وأسمائها ومواقعها، بدل أن يخمّن من لقطة شاشة.
  - هكذا يعمل **Windows-MCP** (MIT، 7 آلاف نجمة) و**UFO** من مايكروسوفت (MIT، 9.5 ألف).
  - التنفيذ داخل مساعد C# الموجود `LxDesk` باستخدام `System.Windows.Automation`، دون أي حزمة جديدة.
- **المتصفح:** **Playwright MCP** (Apache-2.0، 36.8 ألف) يعتمد على لقطة الوصولية (accessibility snapshot) وليس البكسل، فلا يحتاج نموذج رؤية.
  - مكتبة `playwright-core` الموجودة في LayanX تدعم `ariaSnapshot()`.
  - تُضاف خطوة "اقرأ الصفحة كنص" إلى `browser.test`.
- **احتياط بالرؤية للتطبيقات التي لا تكشف شجرتها:**
  - **UI-TARS-1.5-7B**: نموذج تحديد مواقع، ومشروع UI-TARS-desktop رخصته Apache-2.0.
  - **OmniParser V2**: انتبه للرخص. الكود CC-BY-4.0، ونموذج icon_detect v3 رخصته MIT، لكن النسخ الأقدم منه AGPL.

### الفكرة 3: LayanX عميل MCP، وليس خادماً فقط
- **الوضع الحالي:** `src/mcp-gateway.ts` خادم JSON-RPC مكتوب يدوياً على بروتوكول `2025-06-18`. ولا يوجد عميل يستهلك خوادم MCP الخارجية.
- **ما يُضاف:**
  - **@modelcontextprotocol/sdk** للـ TypeScript (13.1 ألف نجمة). الإصدار v2 مستقر ويطبّق مواصفة 2026-07-28. رخصته Apache-2.0 للمساهمات الجديدة وMIT للكود القديم.
  - به يستخدم LayanX مباشرة Windows-MCP وPlaywright MCP وSerena وGraphiti وغيرها، دون إعادة كتابتها.
- **البحث عن مهارات وقت الحاجة (المرحلة 4):** سجل MCP الرسمي `registry.modelcontextprotocol.io`.
  - هو الآن معاينة، وواجهته مجمّدة على v0.1.
  - يبحث فيه LayanX عن خادم يناسب المهمة، ثم يطلب موافقتك قبل التثبيت.
- **قواعد الأمان:**
  - كل أداة خارجية تُسجَّل `dangerous` وتمر عبر محرك المخاطر.
  - تُثبَّت بإصدار محدد وبصمة SHA-256.
  - تعمل في مستوى العزل المختار.

### الفكرة 4: ذاكرة حقيقية تفهم العربية
- **الوضع الحالي:** البحث في `persistent-memory.ts` و`memory.ts` هو `includes()` نصي، فكلمة "المشروع" لا تجد "مشروع".
- **المقترح:**
  - SQLite مع FTS5 للبحث النصي.
  - **sqlite-vec** (MIT/Apache، 8.2 ألف، يعمل على Windows) للبحث الدلالي بتضمينات نموذج embedding الموجود في خطة النماذج.
  - طبقة تطبيع عربي: حذف التشكيل، وتوحيد الألف والياء والتاء المربوطة.
  - هذا يغلق أيضاً المهمة المعلّقة "تخزين SQLite حقيقي".
  - تنبيه: sqlite-vec ما زال قبل الإصدار 1، فتوقّع تغييرات.
- **أفكار التصميم المأخوذة:**
  - **Mem0** (Apache-2.0، 66.7 ألف): منذ أبريل 2026 يستخدم استخلاص "إضافة فقط"، فالذكريات تتراكم ولا يُكتب فوقها. هذا أبسط وأأمن من التعديل والحذف التلقائي.
  - **Graphiti** (Apache-2.0، 29 ألف، v0.29.2 يونيو 2026): كل حقيقة لها زمن صلاحية ("كان صحيحاً حتى…") ومصدر. هذا مفيد لقرارات المشاريع.
  - **Hermes Agent** (MIT، 250 ألف): بحث FTS5 في الجلسات السابقة مع تلخيص بالنموذج للتذكّر بين الجلسات.

### الفكرة 5: خريطة المستودع قبل أي تعديل ("لا يصلح شيئاً ويخرب آخر")
- **Aider** (Apache-2.0، 49.3 ألف):
  - يبني "خريطة" للمستودع من التعريفات والتواقيع.
  - يرتّب الملفات برسم بياني للاعتماديات.
  - ميزانية افتراضية بنحو ألف رمز.
  - التنفيذ في LayanX: `web-tree-sitter` (نسخة WASM، لا تحتاج أدوات بناء على Windows).
- **ast-grep** (MIT، 15.7 ألف): بحث واستبدال بنيوي، وقواعد فحص مخصصة. حزمة `@ast-grep/napi` لها ثنائيات Windows.
- **Serena** (MIT، 27.9 ألف):
  - يعمل عبر خوادم اللغة (LSP) في أكثر من 40 لغة، منها TypeScript وPython وC# وDart.
  - يجد كل مراجع الدالة قبل تعديلها، ويعيد التسمية عبر الملفات.
  - يُستخدم كخادم MCP بعد الفكرة 3.
- **الفائدة:** قبل تعديل أي دالة يعرف المشرف من يستخدمها، ويضيفها إلى بوابة الاختبار.

### الفكرة 6: مهارات بصيغة قياسية مع حجر صحي إلزامي
- **اعتماد صيغة SKILL.md** (معيار agentskills.io، مستودع anthropics/skills، 177.5 ألف):
  - تصبح Playbooks في LayanX قابلة للنقل.
  - يستطيع LayanX قراءة آلاف المهارات المجتمعية.
  - معظم المهارات Apache-2.0، أما مهارات المستندات فرخصتها "متاحة المصدر" وليست مفتوحة.
- **التعلّم الذاتي:**
  - **Hermes Agent:** ينشئ مهارة تلقائياً بعد كل مهمة معقدة، وتتحسن المهارة أثناء استخدامها.
  - **Voyager** (MIT، 7.2 ألف): لا تدخل المهارة المكتبة إلا بعد التحقق منها بتنفيذ فعلي.
  - **التطبيق في LayanX:** المهارة المتعلَّمة تبقى "مسودة" حتى تجتاز بوابات المشرف مرة واحدة على الأقل.
- **تحذير حقيقي من 2026:** سوق مهارات ClawHub الخاص بـ OpenClaw.
  - كُشفت فيه مئات المهارات الخبيثة (341 في كشف ClawHavoc)، تسرق كلمات المرور.
  - أسلوبها: متطلبات مزيفة، وحمولات Base64، وروابط تنزيل من مواقع لصق.
- **الحماية في LayanX:**
  - توسيع `scanPlaybook` ليكشف كتل Base64 الطويلة، و`curl|iex`، ومواقع اللصق، والعناوين غير الموثقة.
  - تبقى المهارة في حجر صحي بلا شبكة حتى توافق عليها.

### الفكرة 7: صوت عربي أفضل ومقاطعة طبيعية
- **الوضع الحالي:**
  - النطق عبر `speechSynthesis` في المتصفح، وجودة العربية فيه متفاوتة.
  - كشف الصوت يعتمد على مستوى الطاقة (RMS).
  - الاستماع يتوقف أثناء الكلام (`pauseListening`)، فلا يمكن مقاطعة المساعد.
- **صوت عربي محلي (Piper):** الصوت `ar_JO-kareem` بجودتين low وmedium.
  - مستودع rhasspy/piper الأصلي (MIT) **أُرشف في 6 أكتوبر 2025**.
  - تكملته OHF-Voice/piper1-gpl رخصتها **GPL-3.0**، فيُشغَّل كبرنامج منفصل فقط.
- **بديل شامل: sherpa-onnx** (Apache-2.0، 13.8 ألف).
  - محرك واحد للنطق (يشمل نماذج Piper، ومنها كريم العربي)، وكشف الصوت (Silero)، واكتشاف الكلمات المفتاحية.
  - يدعم Windows x64، وله حزمة Node `sherpa-onnx-node`.
  - دعم Windows لحزمة Node غير مذكور في توثيقها، فيلزم اختباره.
- **Smart Turn v3.2** (BSD-2، 1.5 ألف):
  - نموذج 8 ميغابايت يقرّر هل أنهيت كلامك فعلاً، بدل مؤقت الصمت.
  - يدعم العربية ضمن 23 لغة، ويعمل على المعالج في نحو 10 إلى 100 ملّي ثانية.
- **Silero VAD** (MIT، 9.9 ألف): أقل من 1 ملّي ثانية لكل مقطع، بدل كشف الطاقة.
- **المقاطعة (barge-in) كما في Pipecat** (BSD-2، 15.3 ألف):
  - إلغاء صدى الميكروفون مفعّل أصلاً في LayanX.
  - مع VAD جيد، يتوقف المساعد فوراً عندما تتكلم.
- **كلمة التنبيه "يا ليان":**
  - openWakeWord: كوده Apache، **لكن نماذجه الجاهزة غير تجارية**، فيلزم تدريب نموذجك الخاص.
  - البديل: اكتشاف الكلمات المفتاحية في sherpa-onnx.
- **تفريغ عربي أدق (بعد ترقية الجهاز):**
  - **Cohere Transcribe Arabic** (يوليو 2026): 2 مليار معامل، رخصته Apache-2.0.
  - يغطي الخليجي والشامي والمصري والمغاربي والخلط مع الإنجليزية.
  - متوسط WER حسب Cohere: 25.87 مقابل 36.86 لـ Whisper large-v3.
  - لم تُذكر طريقة تشغيل بـ GGUF أو whisper.cpp، وذاكرة 6 جيجابايت مشتركة مع Ollama ضيقة.

### الفكرة 8: عزل على Windows دون Docker
- **Anthropic sandbox-runtime (srt)** (Apache-2.0، 4.6 ألف، v0.0.64 في 7 يوليو 2026). دعم Windows فيه **ألفا**، ويعمل هكذا:
  - حساب مستخدم مخصّص.
  - صلاحيات ACL على المسارات المسموحة.
  - فلتر WFP يمنع كل الاتصالات الخارجة إلا عبر وكيل بقائمة نطاقات مسموحة.
  - **المقترح:** مستوى عزل رابع "sandbox" بين `no-scripts` و`docker`، لأن Docker Desktop يستهلك ذاكرة كبيرة.
- **تصميم صندوق Codex على Windows** (مستودع openai/codex، Apache-2.0):
  - رموز وصول مقيّدة (restricted tokens) مع SID اصطناعي.
  - قواعد جدار حماية لمستخدمين مخصّصين.
  - يحتاج صلاحية مدير مرة واحدة عند الإعداد.
- **container-use** (Apache-2.0، 4 آلاف): حاوية وفرع git لكل وكيل، فيعمل عدة وكلاء بالتوازي.
  - **التطبيق في LayanX:** `git worktree` لكل وكيل، فلديك أصلاً فرع لكل مهمة.

### الفكرة 9: فحص أمني أقوى لما يبنيه
- **gitleaks** (MIT، 29.7 ألف): أسرار مسرّبة، ومخرجات SARIF وJSON.
  - المؤلف يعتبره مكتملاً، وتطويره انتقل إلى **Betterleaks** (MIT) من نفس الفريق.
- **OSV-Scanner** (Google، Apache-2.0، 11 ألف):
  - ثغرات الاعتماديات لـ npm وPyPI وDart وNuGet، فيغطي مشاريع Flutter و.NET.
  - يعمل دون إنترنت بعد تنزيل قاعدة البيانات.
- **Opengrep** (LGPL-2.1، 3 آلاف):
  - نسخة مفتوحة من Semgrep، وقواعد Semgrep تعمل عليه دون تغيير.
  - يُشغَّل كبرنامج منفصل، وله سكربت تثبيت PowerShell.
- **ZAP** (Apache-2.0، 15.6 ألف): فحص ديناميكي (baseline) على رابط خادم التطوير الذي يشغّله المشرف أصلاً.

### الفكرة 10: التعلّم من تاريخك لاختيار النموذج، وسقف ميزانية للسحابة
- **RouteLLM** (Apache-2.0، 5.3 ألف): موجّه مُدرَّب يقرّر بين نموذج قوي وضعيف.
  - يدّعي توفيراً حتى 85% مع الحفاظ على 95% من جودة GPT-4 على MT-Bench.
  - تُؤخذ **الفكرة فقط**: استبدال `isComplexGoal` المبني على كلمات بقرار مبني على سجل LayanX، أي المهام التي فشل فيها المحلي ونجحت فيها السحابة.
- **LiteLLM** (53.8 ألف): تُؤخذ أفكار سلسلة البدائل، وميزانية لكل مشروع، وتتبّع التكلفة.
  - لا تثبّته، فقد اختُرقت نسختاه 1.82.7 و1.82.8 على PyPI في 24 مارس 2026.
  - أضف إلى LayanX **سقفاً شهرياً لإنفاق السحابة**، وهذا مهم مع هدف الدخل.

## 3. أفكار إضافية أصغر

- **قواعد المشروع من ملفاته:**
  - المصدر: Cline (Apache-2.0، 67.6 ألف) يقرأ `.clinerules`، وCodex يقرأ `AGENTS.md`.
  - التطبيق: يقرأ LayanX ملفات `AGENTS.md` و`CLAUDE.md` و`.clinerules` إن وُجدت ويضيفها إلى `knowledgeSummary`.
  - الجهد: تعديل صغير.
- **ضغط السياق في المهام الطويلة:**
  - المصدر: فكرة condenser في OpenHands (MIT، 90.1 ألف).
  - الطريقة: تلخيص الأحداث القديمة عند امتلاء السياق.
  - الأهمية: ضرورية لأن `num_ctx` محدود بذاكرة 6 جيجابايت.
- **اختبار انحدار للإيجنت نفسه:**
  - الأداة: **promptfoo** (MIT، 24.2 ألف، TypeScript، يعمل محلياً مع Ollama).
  - الاستخدام: يقارن خطط qwen3.5:4b و9b وgpt-oss على نفس الأهداف بعد كل تعديل.
  - اختبارات حقن الأوامر: مثلاً صفحة ويب تطلب من الإيجنت دفع الكود، والمطلوب أن يرفض.
- **تخزين الإجراءات المحلولة في المتصفح:**
  - المصدر: فكرة act/observe في Stagehand (MIT، 25.5 ألف، TypeScript).
  - الطريقة: تخزين المحدِّد الذي وجده النموذج لكل موقع داخل `.layanx`، فلا يُستدعى النموذج في التشغيل التالي، مع إصلاح ذاتي إذا تغيّر الموقع.
- **أكثر من محاولة ثم الحكم:**
  - المصدر: فكرة "Behavior Best-of-N" في Agent S3 (Apache-2.0، 12.2 ألف).
  - النتيجة لديهم: 72.6% على OSWorld.
  - التطبيق: للمهام الحرجة، عدة محاولات ثم يحكم نموذج على أفضلها.
- **أوامر وموافقات من تيليجرام:**
  - المصدر: فكرة OpenClaw (MIT، 391 ألف): "بوابة موثوقة، تنفيذ غير موثوق، سياسة حتمية"، مع اقتران لكل مُرسل جديد.
  - الوضع: اختياري، إلى جانب تطبيق الهاتف.
- **Agent Client Protocol:**
  - المصدر: Apache-2.0، 4.4 ألف، حزمة `@agentclientprotocol/sdk`.
  - الفائدة: يعمل LayanX داخل محررات أخرى غير VS Code.
  - الأولوية: منخفضة.

## 4. دروس أمنية من 2026 يجب أن تدخل LayanX

1. **Trivy:**
   - نُشر إصدار مخترق v0.69.4 بين 19 و20 مارس 2026.
   - أُعيد توجيه 76 من 77 وسماً في trivy-action إلى كود خبيث.
   - حسب Aqua، الآمن هو v0.69.2 أو v0.69.3.
2. **LiteLLM:** النسختان 1.82.7 و1.82.8 على PyPI سرقتا بيانات الاعتماد عند كل تشغيل لـ Python. السبب حساب مشرف مسروق، غالباً من اختراق Trivy.
3. **ClawHub:** مهارات خبيثة بالمئات في سوق مهارات OpenClaw.

**النتيجة العملية:**
- أي أداة يثبّتها LayanX تُثبَّت بإصدار محدد وبصمة SHA-256، ولا يُستخدم `latest` أبداً.
- أي مهارة أو خادم MCP من الإنترنت يدخل حجراً صحياً ويُفحص، ولا يعمل إلا بموافقتك.

## 5. ترتيب التنفيذ المقترح

**الموجة 1 (لا تحتاج حزماً ثقيلة):**
- JSON Schema في Ollama، والأدوات الأصلية.
- قراءة `AGENTS.md`.
- شجرة UI Automation في `LxDesk`.
- `ariaSnapshot` في `browser.test`.
- ذاكرة SQLite مع FTS5 وتطبيع عربي.
- تثبيت الأدوات بإصدار وبصمة.
- قواعد الحجر الصحي للمهارات.
- سقف ميزانية السحابة.

**الموجة 2:**
- عميل MCP، والبحث في سجل MCP.
- خريطة المستودع بـ tree-sitter، وast-grep.
- gitleaks وOSV-Scanner وOpengrep وZAP كأدوات اختيارية.
- صوت Piper العربي، والمقاطعة، وSilero VAD.
- صيغة SKILL.md.

**الموجة 3:**
- مستوى عزل sandbox-runtime (عندما يخرج دعم Windows من ألفا).
- وكلاء متوازيون بـ worktrees.
- promptfoo.
- توجيه متعلَّم.
- Smart Turn وكلمة التنبيه.
- ACP.
- Cohere Arabic بعد ترقية كرت الشاشة.

## 6. جدول مرجعي سريع

| المستودع | النجوم | الرخصة | الطريقة | المكان في LayanX |
|---|---|---|---|---|
| CursorTouch/Windows-MCP | 7k | MIT | فكرة أو MCP | desktop-control.ts |
| microsoft/UFO | 9.5k | MIT | فكرة | desktop-control.ts |
| microsoft/OmniParser | 25.4k | CC-BY-4.0 (كود) | أداة | رؤية احتياطية |
| bytedance/UI-TARS-desktop | 37.9k | Apache-2.0 | فكرة أو نموذج | رؤية احتياطية |
| simular-ai/Agent-S | 12.2k | Apache-2.0 | فكرة | supervisor |
| microsoft/playwright-mcp | 36.8k | Apache-2.0 | فكرة أو MCP | browser-test.ts |
| browserbase/stagehand | 25.5k | MIT | فكرة أو كود | browser-test.ts |
| modelcontextprotocol/typescript-sdk | 13.1k | Apache-2.0/MIT | مكتبة | mcp-gateway.ts وعميل جديد |
| modelcontextprotocol/registry | 7.2k | مفتوح | خدمة | learning.ts |
| mem0ai/mem0 | 66.7k | Apache-2.0 | فكرة | src/memory |
| getzep/graphiti | 29k | Apache-2.0 | فكرة أو MCP | src/memory |
| asg017/sqlite-vec | 8.2k | MIT/Apache | مكتبة | src/memory |
| Aider-AI/aider | 49.3k | Apache-2.0 | فكرة | repo map جديد |
| ast-grep/ast-grep | 15.7k | MIT | مكتبة | repo map وsecurity-scan |
| oraios/serena | 27.9k | MIT | MCP | coder agent |
| gitleaks/gitleaks | 29.7k | MIT | أداة | security-scan.ts |
| google/osv-scanner | 11k | Apache-2.0 | أداة | security-scan.ts |
| opengrep/opengrep | 3k | LGPL-2.1 | أداة منفصلة | security-scan.ts |
| zaproxy/zaproxy | 15.6k | Apache-2.0 | أداة | security gate |
| anthropic-experimental/sandbox-runtime | 4.6k | Apache-2.0 | مكتبة | sandbox.ts |
| dagger/container-use | 4k | Apache-2.0 | فكرة | supervisor |
| k2-fsa/sherpa-onnx | 13.8k | Apache-2.0 | مكتبة | src/voice |
| OHF-Voice/piper1-gpl | 5.1k | GPL-3.0 | برنامج منفصل | src/voice |
| pipecat-ai/smart-turn | 1.5k | BSD-2 | نموذج | src/voice |
| snakers4/silero-vad | 9.9k | MIT | نموذج | src/voice |
| SYSTRAN/faster-whisper | 25.7k | MIT | أداة | src/voice |
| anthropics/skills | 177.5k | Apache-2.0 (معظمها) | صيغة | playbooks/ |
| NousResearch/hermes-agent | 250k | MIT | فكرة | learning.ts |
| MineDojo/Voyager | 7.2k | MIT | فكرة | learning.ts |
| promptfoo/promptfoo | 24.2k | MIT | أداة | tests |
| lm-sys/RouteLLM | 5.3k | Apache-2.0 | فكرة | providers.ts |
| cline/cline | 67.6k | Apache-2.0 | فكرة | knowledge.ts |
| OpenHands/OpenHands | 90.1k | MIT (عدا enterprise) | فكرة | orchestrator |
| openclaw/openclaw | 391k | MIT | فكرة | قنوات الهاتف |
| agentclientprotocol/agent-client-protocol | 4.4k | Apache-2.0 | مكتبة | تكامل المحررات |

## 7. ما نُفّذ في v9 (7 أكتوبر 2026)

| الفكرة | الحالة |
|---|---|
| 1. مخطط JSON في Ollama | نُفّذ، وفيه إعادة محاولة تلقائية بوضع JSON العادي |
| 2. شجرة UI Automation، وقراءة الصفحة كنص | نُفّذ، ومُختبر على Windows حقيقي (Notepad) |
| 3. عميل MCP وسجل MCP | نُفّذ للإصدارين الحديث والقديم، ومُختبر مع Playwright MCP الحقيقي |
| 4. ذاكرة عربية وSQLite وبحث بالمعنى | نُفّذ |
| 5. خريطة الكود ومن يستخدم الدالة وملفات القواعد | نُفّذ بتحليل نصي بدل tree-sitter، فلا يحتاج تثبيت شيء على Windows |
| 6. SKILL.md وحجر صحي وفحص أقوى | نُفّذ |
| 7. Piper والمقاطعة | نُفّذ، ومُختبر على Windows: Piper ينطق جملة عربية فيكتبها Whisper |
| 8. العزل دون Docker (sandbox-runtime) | لم يُنفّذ، فدعمه لـ Windows ما زال تجريبياً. نُفّذ بدلاً منه: وكلاء البرمجة لا يتجاوزون عزل Docker |
| 9. gitleaks وosv-scanner وopengrep | نُفّذ بإصدارات محددة وتحقق SHA-256، ومُختبر على Windows. ZAP لم يُنفّذ |
| 10. حد السحابة والتوجيه المتعلم | نُفّذ |
| worktrees للوكلاء المتوازين | نُفّذ بديل أبسط وأأمن: مهمة واحدة لكل مشروع، والمشاريع المختلفة تعمل بالتوازي |
| promptfoo وACP وSmart Turn وSilero VAD وكلمة التنبيه وCohere Arabic | لم تُنفّذ، وتبقى أفكاراً للمرحلة القادمة |

## المصادر

- https://github.com/CursorTouch/Windows-MCP
- https://github.com/microsoft/UFO
- https://github.com/microsoft/OmniParser
- https://github.com/bytedance/UI-TARS-desktop
- https://github.com/simular-ai/Agent-S
- https://github.com/microsoft/playwright-mcp
- https://github.com/browserbase/stagehand
- https://github.com/browser-use/browser-use
- https://github.com/modelcontextprotocol/typescript-sdk
- https://github.com/modelcontextprotocol/registry
- https://github.com/mem0ai/mem0
- https://github.com/getzep/graphiti
- https://github.com/asg017/sqlite-vec
- https://github.com/oramasearch/orama
- https://github.com/letta-ai/letta
- https://github.com/Aider-AI/aider
- https://aider.chat/docs/repomap.html
- https://github.com/ast-grep/ast-grep
- https://github.com/oraios/serena
- https://github.com/gitleaks/gitleaks
- https://github.com/betterleaks/betterleaks
- https://github.com/google/osv-scanner
- https://github.com/opengrep/opengrep
- https://github.com/aquasecurity/trivy
- https://github.com/zaproxy/zaproxy
- https://github.com/anthropic-experimental/sandbox-runtime
- https://openai.com/index/building-codex-windows-sandbox/
- https://github.com/openai/codex
- https://github.com/dagger/container-use
- https://github.com/k2-fsa/sherpa-onnx
- https://github.com/OHF-Voice/piper1-gpl
- https://github.com/rhasspy/piper/blob/master/VOICES.md
- https://github.com/SYSTRAN/faster-whisper
- https://github.com/snakers4/silero-vad
- https://github.com/dscripka/openWakeWord
- https://github.com/pipecat-ai/smart-turn
- https://github.com/pipecat-ai/pipecat
- https://huggingface.co/blog/CohereLabs/cohere-transcribe-arabic-07-2026-release
- https://github.com/anthropics/skills
- https://github.com/NousResearch/hermes-agent
- https://github.com/MineDojo/Voyager
- https://github.com/openclaw/openclaw
- https://unit42.paloaltonetworks.com/openclaw-ai-supply-chain-risk/
- https://github.com/OpenHands/OpenHands
- https://github.com/cline/cline
- https://github.com/agentclientprotocol/agent-client-protocol
- https://github.com/promptfoo/promptfoo
- https://github.com/lm-sys/RouteLLM
- https://github.com/BerriAI/litellm
- https://labs.boostsecurity.io/articles/teampcp-litellm-supply-chain-compromise/
- https://www.aquasec.com/blog/trivy-supply-chain-attack-what-you-need-to-know
- https://github.com/ollama/ollama/blob/main/docs/api.md
