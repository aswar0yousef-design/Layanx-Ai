"use strict";
/* LayanX Control Center. Same-origin only; the gateway session cookie authenticates every call. */
const $=s=>document.querySelector(s);
let LANG=localStorage.getItem("lx.cc.lang")==="en"?"en":"ar";

// ------------------------------------------------------------------ i18n
const T={
 ar:{exportL:"تصدير كمهارة",exportedL:"صُدّرت إلى",mcpL:"خوادم أدوات MCP",mcpLead:"أدوات إضافية يستخدمها الوكيل (متصفح، قواعد بيانات، Figma، Jira…). كل خادم يبقى معطلاً حتى توافق عليه، وكل استدعاء لأداته يحتاج موافقتك ما لم تجعلها آمنة.",mcpSearch:"ابحث في سجل MCP الرسمي",mcpAdd:"أضف",mcpCustom:"إضافة خادم محلي",mcpCustomLead:"اربط برنامج MCP مثبتًا على هذا الكمبيوتر مثل Jarvis. أضف الملف التنفيذي والوسائط؛ سيظل الخادم معطّلًا حتى توافق عليه.",mcpServerId:"معرّف الخادم",mcpServerName:"اسم الخادم",mcpCommand:"المسار الكامل للبرنامج التنفيذي (.exe)",mcpArgs:"وسيط واحد في كل سطر (اختياري)",mcpCreate:"إضافة معطّلًا",mcpCancel:"إلغاء",mcpCommandHelp:"استخدم مسارًا مطلقًا إلى ملف .exe؛ لا تضع كلمات مرور أو مفاتيح سرية هنا.",mcpNeedFields:"أدخل المعرّف والمسار الكامل للملف التنفيذي.",mcpApprove:"موافقة وتشغيل",mcpDisable:"إيقاف",mcpRemove:"حذف",mcpNone:"لا توجد خوادم بعد. ابحث في السجل وأضف ما تحتاجه.",mcpPending:"بانتظار موافقتك",mcpRequested:"طلبه",mcpSecrets:"أسرار مطلوبة (أضفها في الإعداد)",mcpTools:"أدوات",mcpPinned:"الإصدار مثبّت",learning:"التعلم والمهارات",learningLead:"أدلة عمل (مهارات) يقرأها الوكيل قبل كل مهمة، ودروس تعلّمها من أخطائه. كل جديد ينتظر موافقتك، وكل دليل يُقيَّم بنتائجه.",playbooksL:"أدلة العمل",lessonsL:"الدروس",sourceL:"المصدر",usesL:"استُخدم",successL:"نجاح",approveL:"اعتماد",disableL:"إيقاف",enableL:"تفعيل",rejectL:"رفض",candidatesL:"بانتظار اعتمادك",noLessons:"لا توجد دروس بعد. يتعلم الوكيل من كل خطأ يصلحه.",src_builtin:"مدمج",src_learned:"متعلَّم",src_project:"من بحث المشروع",st_active:"مفعّل",st_candidate:"ينتظر الاعتماد",st_disabled:"موقوف",st_rejected:"مرفوض",showL:"عرض",fixL:"إصلاح",pitfallL:"تجنّب",
  tl_apis:"البحث في دليل الواجهات المجانية",resumeJob:"أكمل المهمة",openSite:"افتح الموقع",openWhenDoneL:"افتح الموقع في المتصفح عند الانتهاء",openWhenDoneSet:"سيُفتح الموقع في المتصفح عند انتهاء المهمة.",addToJobQ:"هناك مهمة مستقلة تعمل الآن على هذا المشروع:\n«{goal}»\n\nموافق = أضف رسالتك تعليمات لهذه المهمة.\nإلغاء = نفّذها كطلب جديد.",noteAdded:"أُضيفت تعليماتك للمهمة الجارية، وتُتبع من الخطوة التالية.",jobResumed:"استُؤنفت المهمة من حيث توقفت.",needsDevApproval:"تشغيل خادم التطوير لعرض الموقع يحتاج موافقتك. موافق؟",openedSite:"فُتح الموقع في المتصفح:",jobDoneSummary:"اكتملت وتحققت: {a}/{b} مراحل",jobStoppedAt:"توقفت عند المرحلة {n}: {title}",ownerNotesL:"تعليماتك",willOpenL:"يُفتح الموقع عند الانتهاء",sysTitle:"حالة الجهاز",cpuL:"المعالج",ramL:"الذاكرة",gpuL:"كرت الشاشة",vramL:"ذاكرة الكرت",threadsL:"أنوية",loadedModels:"النماذج المحمّلة الآن",noModelsLoaded:"لا يوجد (يُحمَّل النموذج عند أول طلب)",ollamaOff:"Ollama لا يعمل",noGpu:"لا يوجد كرت NVIDIA أو أن تعريفه لا يعمل",onGpu:"على الكرت",relinkQ:"الاسم «{name}» مستخدم لمشروع آخر{path}. مستوى الثقة والعزل يتبعان الاسم. هل تريد استخدامه للمجلد الجديد؟",nameTaken:"الاسم مستخدم لمجلد آخر. اختر اسماً غيره.",isolationL:"العزل",i_local:"محلي",i_noscripts:"محلي بدون سكربتات التثبيت",i_restricted:"مقيّد (يكتب داخل المشروع فقط، دون Docker)",i_docker:"Docker (معزول)",dockerMissing:"Docker غير مشغّل على هذا الجهاز",branchesL:"فروع بانتظار الدمج",noBranches:"لا توجد فروع بانتظار الدمج.",mergeL:"دمج في الفرع الرئيسي",prL:"طلب دمج (PR)",confirmApprove:"هذا إجراء يحتاج موافقتك. هل توافق؟",aheadL:"commits",project:"لوحة المشروع",projectBoardLead:"صحة المشروع وذاكرته وأمانه في مكان واحد، حتى يسهل إصلاحه لاحقاً دون إعادة بنائه.",healthL:"الصحة",securityL:"الأمان",issuesL:"مشاكل معروفة",decisionsL:"القرارات",changelogL:"سجل التغييرات",architectureL:"خريطة المشروع",gitL:"Git",screensL:"لقطات الواجهة",recentJobs:"آخر المهام المستقلة",scanNow:"فحص أمني",reviewNow:"مراجعة الكود",refreshMap:"تحديث الخريطة",fixIt:"أصلحها",resolved:"تم",addIssue:"أضف مشكلة",issueTitle:"وصف المشكلة",noIssues:"لا توجد مشاكل مفتوحة.",noDecisions:"لا توجد قرارات مسجلة بعد.",noChanges:"لا توجد تغييرات مسجلة بعد.",scoreL:"الدرجة",findingsL:"الملاحظات",filesL:"ملفات",linesL:"أسطر",entryL:"نقاط البدء",duplicatesL:"أسماء ملفات مكررة (تحقق قبل إضافة غيرها)",notScanned:"لم يُفحص بعد.",reviewResult:"نتيجة المراجعة",approvedL:"مقبول",notApprovedL:"يحتاج تعديلاً",noProjectYet:"المجلد غير موجود بعد. سيُنشأ عند أول مهمة.",fixPrefix:"أصلح هذه المشكلة في المشروع دون كسر أي شيء آخر: ",autonomous:"المهام المستقلة",autoLead:"أعطه الهدف وسيكمل وحده: يخطط، ينفّذ على مراحل، يختبر الكود والواجهة، يصلح، ويحفظ نقطة رجوع بعد كل مرحلة. يوقف فقط عند ما يحتاج موافقتك.",toEnd:"حتى النهاية",toEndHint:"إنجاز كامل دون متابعة",jobStarted:"بدأت مهمة مستقلة. تابعها من «المهام المستقلة».",maxMinutes:"الحد الأقصى (دقائق)",start:"ابدأ",noJobs:"لا توجد مهام مستقلة بعد.",milestones:"المراحل",checksL:"الفحوصات",visualL:"الفحص البصري",logL:"السجل",j_planning:"يخطط",j_queued:"في الانتظار (مهمة أخرى على المشروع)",j_running:"يعمل",j_waiting_approval:"ينتظر موافقتك",j_verifying:"تحقق نهائي",j_completed:"اكتملت",j_failed:"توقفت",j_cancelled:"أُلغيت",j_budget_exhausted:"انتهت الميزانية",
  trustL:"مستوى الثقة",t_supervised:"مراقَب: يسأل عن كل إجراء",t_trusted:"موثوق: ينفّذ وحده ما يمكن التراجع عنه",t_full:"كامل: + التحكم بالشاشة ووكلاء البرمجة السحابيين",trustNote:"الرفع (push) والنشر والإرسال والإعلانات والتداول تحتاج موافقتك دائماً.",
  agentsL:"الوكلاء المتخصصون",externalL:"وكلاء البرمجة",noExternal:"لا يوجد وكيل برمجة مثبّت. Aider يعمل محلياً مع نماذجك: pip install aider-chat",cloudKind:"سحابي",localKind:"محلي",
  ag_core:"المنسّق العام",ag_coder:"المبرمج",ag_tester:"المختبِر",ag_researcher:"الباحث",ag_operator:"مشغّل سطح المكتب",ag_business:"الأعمال",cloudUsedL:"استُخدم نموذج سحابي",tagline:"وكيلك الذكي للأعمال والتطوير",ask:"اطلب من LayanX أي شيء… (مثال: أصلح الاختبارات، أنشئ منتجاً، حلّل المبيعات)",online:"الوكيل متصل",offline:"الوكيل غير متصل",owner:"المالك",
  dashboard:"لوحة القيادة",agent:"الوكيل الذكي",missions:"المهام",approvals:"الموافقات",computer:"التحكم بالكمبيوتر",terminal:"الطرفية",projects:"المشاريع والكود",git:"Git والمستودع",ecommerce:"التجارة الإلكترونية",social:"التواصل الاجتماعي",ads:"إدارة الإعلانات",analytics:"تحليلات الأعمال",integrations:"التكاملات",team:"فريق الوكلاء",schedules:"الجدولة",models:"النماذج",tools:"الأدوات والمهارات",activity:"النشاط",settings:"الإعدادات",
  activeMissions:"المهام النشطة",successRate:"نسبة النجاح",tasksCompleted:"المهام المكتملة",connectedApps:"التطبيقات المتصلة",running:"قيد التنفيذ",queued:"في الانتظار",last30:"آخر 30 يوماً",thisWeek:"هذا الأسبوع",
  agentTitle:"وكيل LayanX الذكي",agentSub:"مساعدك الذكي للتطوير والأعمال والأتمتة",askAgent:"اطلب من LayanX تنفيذ أي شيء…",received:"تم استلام المهمة، جارٍ التنفيذ…",pausedApproval:"توقفت المهمة بأمان: خطوة تحتاج موافقتك.",completedVerified:"اكتملت المهمة وتم التحقق منها",notCompleted:"لم تكتمل المهمة",
  stop:"إيقاف",viewLogs:"السجلات",openFiles:"فتح الملفات",createPR:"إنشاء PR",approve:"موافقة",reject:"رفض",approveRun:"موافقة وتشغيل",
  currentMission:"المهمة الحالية",noMission:"لا توجد مهمة الآن. اطلب شيئاً من لوحة الوكيل.",stepsDone:"{a}/{b} خطوات مكتملة",stepsSoFar:"{a} خطوات منجزة، ويختار الخطوة التالية",
  trading:"التداول",tradingLead:"MetaTrader 5 عبر أدوات LayanX. القراءة بلا موافقة، وتشغيل المضارب الآلي وإيقافه واختبار الروبوتات بموافقتك في كل مرة.",
  trOff:"التداول مطفأ («تحليل التداول»). فعّله من «فريق الوكلاء» أو صفحة الإعداد، ثم أعد تشغيل LayanX.",trConnect:"اتصل بـ MetaTrader 5",
  trConnectHint:"افتح MetaTrader 5 وسجّل الدخول وفعّل زر Algo Trading، ثم اضغط «اتصل». قد يفتح الاتصال MetaTrader 5 إن كان مغلقاً.",trFailed:"تعذر الاتصال بـ MetaTrader 5:",
  trRefresh:"تحديث",trAccountType:"نوع الحساب",trDemo:"تجريبي",trReal:"حقيقي",trContest:"مسابقة",trBalance:"الرصيد",trEquity:"حقوق الملكية",trFloating:"الربح العائم",trLeverage:"الرافعة",
  trAlgo:"Algo Trading",trOnW:"مفعّل",trOffW:"مطفأ",trServer:"الخادم",trRealBlocked:"حساب حقيقي: يرفض LayanX أي أمر عليه حتى تضع MT5_ALLOW_REAL_ACCOUNT=true.",
  trRealAllowed:"حساب حقيقي، والتداول عليه مسموح (MT5_ALLOW_REAL_ACCOUNT=true). أي صفقة بأموال حقيقية.",trAlgoOffWarn:"زر Algo Trading مطفأ في MetaTrader 5: لن تُنفّذ أي أوامر.",
  trScalper:"المضارب الآلي",trRunning:"يعمل",trStopped:"متوقف",trStart:"تشغيل",trStop:"إيقاف",trTradesToday:"صفقات اليوم",trDailyPnl:"نتيجة اليوم",trLosses:"خسائر متتالية",
  trLastAction:"آخر إجراء",trLastError:"آخر خطأ",trLiveOff:"التداول الحي مطفأ (MT5_LIVE_TRADING_ENABLED): لا يُرسل أي أمر.",trAutoOff:"تشغيل المضارب غير مسموح بعد (ضع MT5_AUTO_SCALPING_ENABLED=true).",
  trStartQ:"تشغيل المضارب الآلي على {sym} في حساب {acct}؟ يرسل أوامر على هذا الحساب ضمن حدود اليوم.",trStopQ:"إيقاف المضارب الآلي؟",trLimits:"حدود اليوم: خسارة {l}% · {t} صفقة · {c} خسائر متتالية",
  trQuote:"السعر",trBid:"Bid",trAsk:"Ask",trSpread:"الفارق",trSymbol:"الرمز",trLast24:"آخر 24 ساعة (M15)",trShow:"اعرض",
  trPositions:"الصفقات المفتوحة",trNoPositions:"لا توجد صفقات مفتوحة.",trSide:"الاتجاه",trBuy:"شراء",trSell:"بيع",trVolume:"الحجم",trOpenPrice:"سعر الفتح",trSlTp:"وقف / هدف",trProfit:"الربح",
  trBy:"فتحها",trByLayanX:"LayanX",trByYou:"أنت",trHistory:"الصفقات المغلقة",trDaysN:"آخر {n} يوم",trNet:"الصافي",trWins:"رابحة",trLossesN:"خاسرة",trNoDeals:"لا توجد صفقات مغلقة في هذه المدة.",trClosedAt:"أُغلقت",
  trTester:"اختبار الروبوتات (Strategy Tester)",trTesterHint:"يشغّل روبوتاً (.ex5) على نسخة MT5 منفصلة للاختبار (MT5_TESTER_TERMINAL) على بيانات تاريخية. لا يرسل أي أمر، وقد يستغرق حتى 30 دقيقة.",
  trExpert:"اسم الروبوت (داخل MQL5\\Experts)",trPeriod:"الإطار",trFrom:"من",trTo:"إلى",trModel:"المحاكاة",trDeposit:"الإيداع",trRun:"شغّل الاختبار",trRunQ:"تشغيل اختبار الروبوت «{e}» على {s}؟ لا يرسل أي أمر.",
  trNoRuns:"لم تشغّل اختبارات من هذه الصفحة بعد.",trTesting:"يعمل…",trTestDone:"اكتمل",trTestFailed:"فشل",trNetProfit:"صافي الربح",trDD:"أقصى تراجع",trTradesN:"الصفقات",trPosMonths:"أشهر رابحة",
  trAllYears:"كل السنوات رابحة",trYes:"نعم",trNo:"لا",trStarted:"بدأ الاختبار. تابعه هنا.",trNeedExpert:"اكتب اسم الروبوت والرمز.",
  cap_trade:"التداول",cap_trade_d:"MetaTrader 5: الحساب والصفقات والمضارب الآلي.",cap_trade_1:"الحساب والصفقات المفتوحة",cap_trade_2:"المضارب الآلي بموافقتك",cap_trade_3:"اختبار الروبوتات",deleteL:"حذف",deletedT:"حُذفت المهمة.",
  deleteJobQ:"حذف هذه المهمة المستقلة نهائياً من القائمة؟ إن كانت تعمل فستتوقف. ملفات المشروع لا تُحذف.",deleteMissionQ:"حذف هذه المهمة نهائياً من القائمة؟ إن كانت تعمل فستتوقف، وتُلغى موافقاتها المعلّقة.",recentActivities:"آخر الأنشطة",viewAll:"عرض الكل",noActivity:"لا يوجد نشاط بعد.",
  st_done:"مكتملة",st_run:"قيد التنفيذ",st_pend:"معلّقة",st_wait:"بانتظار موافقة",st_fail:"فشلت",
  computerControl:"التحكم بالكمبيوتر",live:"مباشر",screenOff:"البث متوقف. اضغط «لقطة» أو ابدأ البث.",screenWaiting:"جارٍ التقاط أول إطار من سطح المكتب…",screenError:"تعذّر التقاط الشاشة: {error}",screenStale:"توقّف تحديث صورة سطح المكتب منذ أكثر من 5 ثوانٍ.",screenshot:"لقطة",mouse:"الفأرة",keyboard:"لوحة المفاتيح",apps:"التطبيقات",startLive:"بدء البث",stopLive:"إيقاف البث",
  terminalTitle:"الطرفية",restricted:"(مقيّدة)",termEmpty:"شغّل أمراً مسموحاً. الأوامر التي تنفّذ شيئاً تطلب موافقتك.",quickActions:"إجراءات سريعة",openVSCode:"فتح في VS Code",runTests:"تشغيل الاختبارات",buildProject:"بناء المشروع",createBranch:"إنشاء فرع",branchName:"اسم الفرع الجديد (مثال: feature/login)",
  cap_dev:"التطوير والكود",cap_dev_d:"تحليل الكود وتعديله واختباره ونشره",cap_dev_1:"تكامل Git",cap_dev_2:"إصلاح تلقائي واختبارات",cap_dev_3:"VS Code",
  cap_shop:"التجارة الإلكترونية",cap_shop_d:"Shopify و WooCommerce",cap_shop_1:"إنشاء المنتجات",cap_shop_2:"إدارة الطلبات",cap_shop_3:"مزامنة المخزون",
  cap_social:"التواصل الاجتماعي",cap_social_d:"النشر على عدة منصات",cap_social_1:"إنشاء المحتوى",cap_social_2:"جدولة المنشورات",cap_social_3:"نشر تلقائي",
  cap_ads:"إدارة الإعلانات",cap_ads_d:"إنشاء الحملات وإدارتها",cap_ads_1:"إدارة الحملات",cap_ads_2:"إنشاء إعلانات بالذكاء الاصطناعي",cap_ads_3:"تحليل الأداء",
  cap_pc:"التحكم بالكمبيوتر",cap_pc_d:"التحكم بتطبيقات سطح المكتب",cap_pc_1:"لقطات ورؤية",cap_pc_2:"فأرة ولوحة مفاتيح",cap_pc_3:"تشغيل التطبيقات",
  cap_int:"التكاملات",cap_int_d:"اربط أدواتك",cap_int_1:"موصلات API",cap_int_2:"تكاملات مخصصة",cap_int_3:"أتمتة الويب",
  cap_team:"فريق الوكلاء",cap_team_d:"أدوار متخصصة تعمل معاً",cap_team_1:"تفويض المهام",cap_team_2:"صلاحيات لكل دور",cap_team_3:"تفعيل وإيقاف",
  connected:"متصل",needsSetup:"يحتاج إعداداً",activeRoles:"{n} أدوار مفعّلة",projectsN:"{n} مشاريع",
  arch:"معمارية النظام (الحالة الحالية)",a_user:"المستخدم",a_user_1:"الويب والهاتف",a_user_2:"VS Code والصوت",a_planner:"المخطِّط الذكي",a_planner_1:"فهم الهدف",a_planner_2:"تخطيط المهام",a_planner_3:"اختيار الأدوات",a_planner_4:"إعادة التخطيط",
  a_tools:"سجل الأدوات",a_tools_n:"{n} أداة",a_sec:"الصلاحيات والأمان",a_sec_1:"مستويات الصلاحية",a_sec_2:"نظام الموافقات",a_sec_3:"تحليل المخاطر",a_sec_4:"سجل التدقيق",
  a_exec:"محرك التنفيذ",a_exec_1:"تشغيل الأدوات",a_exec_2:"مراقبة التقدم",a_exec_3:"إصلاح تلقائي",a_exec_4:"التحقق من النتائج",a_mem:"الذاكرة والاسترجاع",a_mem_1:"حفظ السياق",a_mem_2:"سجل المهام",a_mem_3:"الاستئناف بعد الانقطاع",a_mem_4:"التعلم من النتائج",
  a_ext:"الخدمات الخارجية",a_res:"النتائج",a_res_1:"مهام مكتملة",a_res_2:"كود محدّث",a_res_3:"محتوى منشور",a_res_4:"نمو الأعمال",pendingN:"{n} موافقة معلّقة",modelsN:"{a} محلي · {b} سحابي",servicesN:"{n} خدمة متصلة",
  notifications:"الإشعارات",noNotifications:"لا شيء ينتظرك.",language:"English",
  approvalsLead:"لن ينفّذ الوكيل إجراءً حساساً قبل موافقتك. يمكنك الموافقة أيضاً من الهاتف أو VS Code.",noApprovals:"لا توجد موافقات معلّقة.",
  all:"الكل",completed:"مكتملة",failed:"فشلت",blocked:"متوقفة",details:"التفاصيل",cancel:"إيقاف",noMissions:"لا توجد مهام.",
  liveLead:"يرى الوكيل الشاشة أثناء المهام، ويحرك الفأرة ويكتب بعد موافقتك.",sayThese:"أوامر يمكنك قولها أو كتابتها",
  terminalLead:"الأوامر المسموحة فقط تعمل داخل مجلد المشروع، وكل أمر ينفّذ شيئاً ينتظر موافقتك.",history:"السجل",
  projectsLead:"كل مجلد داخل مجلد المشاريع مشروع، ويمكنك ربط أي مجلد آخر (مثل المفتوح في VS Code).",activeProject:"المشروع النشط",use:"اعتماد",inspect:"فحص بالوكيل",linkFolder:"ربط مجلد",folderPath:"مسار المجلد",projectName:"اسم المشروع",link:"ربط",linked:"مربوط",
  gitLead:"أوامر القراءة تعمل فوراً؛ إنشاء الفروع والـ commit والـ push يحتاج موافقتك.",gitAsk:"اطلب من الوكيل",gitCommit:"اكتب commit واضحاً للتغييرات الحالية",gitPush:"ارفع الفرع الحالي إلى GitHub",gitPR:"جهّز Pull Request بعد مراجعة الكود والأمان",
  stores:"المتاجر",products:"المنتجات",orders:"الطلبات",orderValue:"قيمة الطلبات",content:"المحتوى",published:"منشور",scheduled:"مجدول",campaigns:"الحملات",media:"الوسائط",accounts:"الحسابات",
  shopGoals:"أنشئ 5 منتجات جديدة في المتجر مع أوصاف وصور|زامن الطلبات الجديدة من المتجر|اكتب وصفاً تسويقياً لأفضل منتج",
  plL:"المنصات",plLead:"اربط LayanX بالمنصات التي يعمل عليها في المواقع. المفتاح يُحفظ مشفّراً على هذا الكمبيوتر فقط، والقراءة آمنة، وكل نشر للإنتاج أو تعديل أو حذف ينتظر موافقتك.",plConnect:"ربط",plDisconnect:"فصل",plSave:"ربط الآن",plCancel:"إلغاء",plGetToken:"أنشئ المفتاح من هنا",plTokenFor:"المفتاح",plOptional:"اختياري",plKeep:"محفوظ؛ اتركه فارغاً للإبقاء عليه",plTools:"أداة",plManaged:"يُدار من صفحة الإعداد",plConnected:"تم الربط",plDisconnected:"تم الفصل",plConfirm:"فصل {p}؟ يُحذف مفتاحه من هذا الكمبيوتر.",plReplaced:"استُبدلت نسخة سابقة: {x}",plDocs:"التوثيق",plShared:"مشترك مع أجزاء أخرى من LayanX",
  pls_connected:"متصل",pls_available:"جاهز للربط",pls_needs_token:"يحتاج مفتاحاً",pls_error:"خطأ",pls_starting:"يبدأ…",plFromMcp:"منصة",
  cd_burstiness:"تنوّع أطوال الجمل",cd_specificity:"تفاصيل ملموسة: أرقام، أسماء، مواعيد",cd_slop:"عبارات نمطية يكثر منها الذكاء الاصطناعي",cd_fingerprint:"رموز مخفية وآثار آلية",cd_voice:"صوت طبيعي يشبه كتابتك",cd_platform:"حدود المنصة: الطول والوسوم",
  fk_hidden:"رموز مخفية (zero-width وغيرها)",fk_bidi:"رموز تغيّر اتجاه النص",fk_lookalike:"كلمات فيها حروف مشابهة (كيريلية أو يونانية)",fk_chatbot:"بقايا روبوت المحادثة («بالتأكيد! إليك…»)",fk_spaces:"مسافات غير عادية",fk_markdown:"رموز markdown ستظهر كما هي على المنصة",fk_presentation:"حروف بأشكال خاصة منسوخة من PDF أو روبوت",fk_em_dash:"شرطات طويلة (—) بكثرة",fk_emoji_bullets:"كل سطر يبدأ بإيموجي (شكل قالب)",fk_exclamations:"علامات تعجب كثيرة",
  pk_too_long:"أطول من حد المنصة بـ {n}",pk_long:"أطول من الطول المناسب بـ {n}",pk_caption:"مع صورة أو فيديو يُقص التعليق بعد 1024 حرفاً",pk_hashtags:"وسوم زائدة: {n}",pk_empty:"النص فارغ",
  vk_sentence_length:"جملك هنا أطول أو أقصر بكثير من منشوراتك",vk_emoji:"إيموجي أكثر بكثير من منشوراتك",vk_exclamations:"تعجب أكثر بكثير من منشوراتك",bk_same_opening:"جمل كثيرة تبدأ بنفس الكلمة: «{w}»",
  fx_fp:"يزيله التنظيف تلقائياً",fx_vague:"سمِّه أو اذكر الرقم أو احذفه",fx_hedge:"قلها مباشرة",fx_stock_rhetoric:"ابدأ بالمعلومة",fx_avoid:"طلبت ألا تُستخدم هذه الكلمة",fx_same_opening:"نوّع بدايات الجمل",fx_too_long:"اختصره",fx_long:"اختصره",fx_hashtags:"أبقِ أفضلها",
  hz:"تحسين النص",hzLead:"يجعل النص أقرب للكتابة البشرية لأي منصة: ينظّف الرموز المخفية والعبارات النمطية، ويحافظ على الأرقام والأسعار والروابط والوسوم كما هي.",hzText:"النص",hzPlatform:"المنصة",hzKind:"النوع",hzCheck:"فحص",hzClean:"تنظيف",hzRewrite:"تحسين",hzWorking:"جارٍ العمل…",hzScore:"درجة الكتابة البشرية",hzResult:"النص بعد التحسين",hzCopy:"نسخ",hzCopied:"نُسخ",hzUse:"ضعه في المربع",hzFindings:"ما وُجد",hzNone:"لا شيء يحتاج إصلاحاً.",hzV_pass:"ناجح",hzV_review:"يحتاج مراجعة",hzV_fail:"لم ينجح",hzNoteL:"ملاحظة",
  hzN_no_model:"لا يوجد نموذج محلي يعمل الآن: نُظّف النص فقط. شغّل Ollama ثم أعد المحاولة.",hzN_model_error:"تعذّر الوصول إلى النموذج: نُظّف النص فقط.",hzN_rewrite_disabled:"إعادة الصياغة مطفأة (LAYANX_HUMANIZER): نُظّف النص فقط.",hzN_already_human:"النص يقرأ كتابة بشرية؛ لم يُغيَّر إلا ما خفي.",hzN_protected:"النص آيات أو اقتباسات محمية؛ لا يُعاد صياغته.",hzN_html_check_only:"HTML يُفحص فقط؛ حسّن كل فقرة كنص.",hzN_rewrite_lost_facts:"رُفضت الصياغة لأنها غيّرت رقماً أو رابطاً أو وسماً؛ بقي النص الأصلي منظّفاً.",hzN_rewrite_not_better:"لم تكن الصياغة الجديدة أفضل؛ بقي النص الأصلي منظّفاً.",
  voiceL:"صوتك في الكتابة",voiceLead:"ألصق منشورات حقيقية كتبتها أنت (افصل بينها بسطر فارغ)؛ يقارن LayanX بها ويكتب بأسلوبك.",voiceSamples:"أمثلة من كتابتك",voiceDialect:"اللهجة",voiceTone:"النبرة",voicePerson:"تكتب بصيغة",voiceAny:"—",voiceI:"أنا",voiceWe:"نحن",voiceAvoid:"كلمات لا تريدها (مفصولة بفاصلة)",voicePrefer:"كلمات تحبها",voiceSaved:"حُفظ صوتك",voiceSave:"حفظ",qualityL:"الجودة",
  k_post:"منشور",k_title:"عنوان",k_meta:"وصف الصفحة",k_cta:"زر",k_script:"سكربت فيديو",k_subject:"عنوان بريد",k_push:"إشعار",k_ui:"نص تطبيق",k_store_title:"اسم في المتجر",k_store_short:"وصف قصير للمتجر",k_store_description:"وصف المتجر",
  socialGoals:"اكتب منشوراً لإنستغرام عن أحدث منتج|جدول 3 منشورات لهذا الأسبوع|أعطني أداء المنشورات الأخيرة",
  adsGoals:"حلّل أداء الحملات الحالية واقترح تحسينات|أنشئ حملة إعلانية تجريبية بميزانية صغيرة|أوقف الحملات ضعيفة الأداء",
  analyticsLead:"أرقام الأعمال من متاجرك ومحتواك وتجارب النمو.",experiments:"التجارب",openActions:"إجراءات مفتوحة",
  teamLead:"كل دور مجموعة أدوات يستطيع الوكيل استخدامها. أوقف ما لا تحتاجه ليختار النموذج المحلي بدقة أكبر.",enabled:"مفعّل",disabled:"موقوف",restartNote:"التغيير يعمل بعد إعادة التشغيل من الإعدادات.",
  newSchedule:"جدولة جديدة",scheduleLead:"المهمة المجدولة تمر بنفس الصلاحيات والموافقات.",task:"المهمة",repeat:"التكرار",time:"الوقت",add:"إضافة",daily:"يومياً",interval:"كل فترة",once:"مرة واحدة",minutes:"بالدقائق",noSchedules:"لا توجد مهام مجدولة.",pause:"إيقاف",resume:"تشغيل",
  localModels:"النماذج المحلية",cloudModels:"النماذج السحابية",openSetup:"افتح صفحة الإعداد",
  toolsLead:"القراءة والتحليل تعمل مباشرة؛ التعديل والتنفيذ يمرّان بالصلاحيات والموافقات.",skills:"المهارات المتعلَّمة",noSkills:"لا توجد مهارات بعد.",needsApproval:"يتطلب موافقة",search:"ابحث…",
  activityLead:"كل أداة استخدمها الوكيل ومدتها ونتيجتها.",
  settingsLead:"اللغة والتشغيل وروابط الإعداد.",restart:"إعادة التشغيل",voice:"المساعد الصوتي",setup:"الإعداد والمفاتيح",status:"الحالة",
  loading:"جارٍ التحميل…",loadFailed:"تعذر تحميل هذا القسم",approved:"تمت الموافقة",rejected:"رُفض",resuming:"تمت الموافقة، أُكمل المهمة…",needAnother:"تحتاج موافقة أخرى",stoppedMsg:"توقف التنفيذ",
  r_noexec:"لم يجد الوكيل خطوة قابلة للتنفيذ",r_models:"لا يوجد نموذج متاح الآن (تحقق من Ollama أو مفاتيح السحابة)",r_plan:"لم يستطع النموذج تكوين خطة صالحة",r_notallowed:"الأداة أو الأمر غير مسموح",
  via:" عبر {p}",ago_now:"الآن",ago_m:"قبل {n} د",ago_h:"قبل {n} س",
  act_start:"بدأت مهمة",act_done:"اكتمل: {t}",act_wait:"ينتظر موافقة: {t}",act_fail:"فشل: {t}",act_verify:"تم التحقق من المهمة",act_cloud:"انتقلت المهمة إلى نموذج سحابي",act_run:"يعمل: {t}",
  tl_files_write:"كتابة ملف",tl_files_read:"قراءة ملف",tl_terminal:"تشغيل أمر",tl_git_commit:"إنشاء commit",tl_git_push:"رفع إلى المستودع",tl_git_status:"فحص Git",tl_shot:"لقطة شاشة",tl_click:"نقر بالفأرة",tl_type:"كتابة بلوحة المفاتيح",tl_verify:"التحقق من المشروع",tl_research:"بحث في الإنترنت",tl_mt5_read:"قراءة حساب MetaTrader 5",tl_mt5_tester:"اختبار روبوت في Strategy Tester",tl_mt5_scalper:"المضارب الآلي (MT5)"},
 en:{exportL:"Export as skill",exportedL:"Exported to",mcpL:"MCP tool servers",mcpLead:"Extra tools the agent can use (browser, databases, Figma, Jira...). Each server stays off until you approve it, and every call to its tools asks you unless you mark the tool safe.",mcpSearch:"Search the official MCP Registry",mcpAdd:"Add",mcpCustom:"Add local MCP server",mcpCustomLead:"Connect an MCP program already installed on this computer, such as Jarvis. Enter its executable and arguments; it stays disabled until you approve it.",mcpServerId:"Server ID",mcpServerName:"Server name",mcpCommand:"Full path to executable (.exe)",mcpArgs:"One argument per line (optional)",mcpCreate:"Add disabled",mcpCancel:"Cancel",mcpCommandHelp:"Use an absolute .exe path. Do not put passwords or API keys here.",mcpNeedFields:"Enter a server ID and full executable path.",mcpApprove:"Approve & start",mcpDisable:"Stop",mcpRemove:"Remove",mcpNone:"No servers yet. Search the registry and add what you need.",mcpPending:"waiting for your approval",mcpRequested:"requested by",mcpSecrets:"secrets needed (add them in Setup)",mcpTools:"tools",mcpPinned:"pinned version",learning:"Learning & Skills",learningLead:"Playbooks the agent reads before each task, and lessons it learned from its own mistakes. Anything new waits for your approval, and every playbook is rated by its results.",playbooksL:"Playbooks",lessonsL:"Lessons",sourceL:"Source",usesL:"Used",successL:"Success",approveL:"Approve",disableL:"Disable",enableL:"Enable",rejectL:"Reject",candidatesL:"Waiting for your approval",noLessons:"No lessons yet. The agent learns from every error it fixes.",src_builtin:"built-in",src_learned:"learned",src_project:"project research",st_active:"active",st_candidate:"candidate",st_disabled:"disabled",st_rejected:"rejected",showL:"Show",fixL:"fix",pitfallL:"avoid",
  tl_apis:"Search the free API catalog",resumeJob:"Resume",openSite:"Open the site",openWhenDoneL:"Open the site in the browser when done",openWhenDoneSet:"The site opens in the browser when the job is done.",addToJobQ:"An autonomous job is running on this project:\n\"{goal}\"\n\nOK = add your message as an instruction for that job.\nCancel = run it as a new request.",noteAdded:"Added to the running job; it is followed from the next step.",jobResumed:"Resumed from where it stopped.",needsDevApproval:"Starting the dev server to show the site needs your approval. OK?",openedSite:"Opened the site in the browser:",jobDoneSummary:"Finished and verified: {a}/{b} milestones",jobStoppedAt:"Stopped at milestone {n}: {title}",ownerNotesL:"Your instructions",willOpenL:"opens the site when done",sysTitle:"This PC",cpuL:"CPU",ramL:"Memory",gpuL:"Graphics card",vramL:"Graphics memory",threadsL:"threads",loadedModels:"Models loaded now",noModelsLoaded:"none (a model loads on the first request)",ollamaOff:"Ollama is not running",noGpu:"No NVIDIA card, or its driver is not working",onGpu:"on the GPU",relinkQ:"The name \"{name}\" belongs to another project{path}. Its trust level and isolation follow the name. Use it for the new folder anyway?",nameTaken:"That name is used by another folder. Choose another name.",isolationL:"Isolation",i_local:"Local",i_noscripts:"Local, no install scripts",i_restricted:"Restricted (writes only inside the project, no Docker)",i_docker:"Docker (isolated)",dockerMissing:"Docker is not running on this computer",branchesL:"Branches waiting to merge",noBranches:"No branches waiting to merge.",mergeL:"Merge into main",prL:"Pull request",confirmApprove:"This action needs your approval. Approve?",aheadL:"commits",project:"Project Board",projectBoardLead:"Health, memory and security of the project in one place, so it can be fixed later without rebuilding.",healthL:"Health",securityL:"Security",issuesL:"Known issues",decisionsL:"Decisions",changelogL:"Changelog",architectureL:"Project map",gitL:"Git",screensL:"UI screenshots",recentJobs:"Recent autonomous missions",scanNow:"Security scan",reviewNow:"Review code",refreshMap:"Refresh map",fixIt:"Fix it",resolved:"Done",addIssue:"Add issue",issueTitle:"Describe the problem",noIssues:"No open issues.",noDecisions:"No decisions recorded yet.",noChanges:"No changes recorded yet.",scoreL:"Score",findingsL:"Findings",filesL:"files",linesL:"lines",entryL:"Entry points",duplicatesL:"Duplicate file names (check before adding another)",notScanned:"Not scanned yet.",reviewResult:"Review result",approvedL:"Approved",notApprovedL:"Needs changes",noProjectYet:"The folder does not exist yet. It is created by the first mission.",fixPrefix:"Fix this problem in the project without breaking anything else: ",autonomous:"Autonomous Missions",autoLead:"Give it the goal and it finishes alone: plans, works in milestones, tests code and UI, repairs, and checkpoints after each milestone. It only stops for what needs your approval.",toEnd:"To the end",toEndHint:"Finish without supervision",jobStarted:"Autonomous mission started. Follow it in Autonomous Missions.",maxMinutes:"Time limit (minutes)",start:"Start",noJobs:"No autonomous missions yet.",milestones:"Milestones",checksL:"Checks",visualL:"Visual check",logL:"Log",j_planning:"Planning",j_queued:"Queued (another job on this project)",j_running:"Working",j_waiting_approval:"Waiting for you",j_verifying:"Final checks",j_completed:"Completed",j_failed:"Stopped",j_cancelled:"Cancelled",j_budget_exhausted:"Out of budget",
  trustL:"Trust level",t_supervised:"Supervised: asks before every action",t_trusted:"Trusted: does reversible work alone",t_full:"Full: + screen control and cloud coding agents",trustNote:"Push, publishing, sending, ads and trading always need your approval.",
  agentsL:"Specialised agents",externalL:"Coding agents",noExternal:"No coding agent installed. Aider runs locally with your models: pip install aider-chat",cloudKind:"cloud",localKind:"local",
  ag_core:"General coordinator",ag_coder:"Coder",ag_tester:"Tester",ag_researcher:"Researcher",ag_operator:"Desktop operator",ag_business:"Business",cloudUsedL:"A cloud model was used",tagline:"Your AI Agent for Business & Development",ask:"Ask LayanX anything… (e.g. build a feature, create a product, analyze sales)",online:"Agent Online",offline:"Agent Offline",owner:"Owner",
  dashboard:"Dashboard",agent:"AI Agent",missions:"Missions",approvals:"Approvals",computer:"Computer Control",terminal:"Terminal",projects:"Projects & Code",git:"Git & Repository",ecommerce:"E-commerce",social:"Social Media",ads:"Ads Management",analytics:"Business Analytics",integrations:"Integrations",team:"Team Agents",schedules:"Schedules",models:"Models",tools:"Tools & Skills",activity:"Activity",settings:"Settings",
  activeMissions:"Active Missions",successRate:"Success Rate",tasksCompleted:"Tasks Completed",connectedApps:"Connected Apps",running:"running",queued:"queued",last30:"Last 30 days",thisWeek:"this week",
  agentTitle:"LayanX AI Agent",agentSub:"Your intelligent assistant for development, business and automation",askAgent:"Ask LayanX to do anything…",received:"Mission received, working on it…",pausedApproval:"Paused safely: a step needs your approval.",completedVerified:"Mission completed and verified",notCompleted:"Mission not completed",
  stop:"Stop",viewLogs:"View Logs",openFiles:"Open Files",createPR:"Create PR",approve:"Approve",reject:"Reject",approveRun:"Approve and run",
  currentMission:"Current Mission",noMission:"No mission right now. Ask the agent for something.",stepsDone:"{a}/{b} steps completed",stepsSoFar:"{a} steps done, choosing the next one",
  trading:"Trading",tradingLead:"MetaTrader 5 through LayanX's tools. Reading needs no approval; starting or stopping the auto-scalper and testing robots need your approval every time.",
  trOff:"Trading is switched off (\"Trading analysis\"). Turn it on in Agent Team or the setup page, then restart LayanX.",trConnect:"Connect to MetaTrader 5",
  trConnectHint:"Open MetaTrader 5, log in and turn on Algo Trading, then press Connect. Connecting may open MetaTrader 5 if it is closed.",trFailed:"Could not connect to MetaTrader 5:",
  trRefresh:"Refresh",trAccountType:"Account",trDemo:"Demo",trReal:"Real",trContest:"Contest",trBalance:"Balance",trEquity:"Equity",trFloating:"Floating P/L",trLeverage:"Leverage",
  trAlgo:"Algo Trading",trOnW:"On",trOffW:"Off",trServer:"Server",trRealBlocked:"Real account: LayanX refuses any order on it until you set MT5_ALLOW_REAL_ACCOUNT=true.",
  trRealAllowed:"Real account, and trading on it is allowed (MT5_ALLOW_REAL_ACCOUNT=true). Every trade is real money.",trAlgoOffWarn:"Algo Trading is off in MetaTrader 5: no order will be executed.",
  trScalper:"Auto-scalper",trRunning:"Running",trStopped:"Stopped",trStart:"Start",trStop:"Stop",trTradesToday:"Trades today",trDailyPnl:"Today's result",trLosses:"Losing streak",
  trLastAction:"Last action",trLastError:"Last error",trLiveOff:"Live trading is off (MT5_LIVE_TRADING_ENABLED): no order is sent.",trAutoOff:"Starting the auto-scalper is not allowed yet (set MT5_AUTO_SCALPING_ENABLED=true).",
  trStartQ:"Start the auto-scalper on {sym} in the {acct} account? It sends orders on this account within today's limits.",trStopQ:"Stop the auto-scalper?",trLimits:"Daily limits: {l}% loss · {t} trades · {c} losses in a row",
  trQuote:"Price",trBid:"Bid",trAsk:"Ask",trSpread:"Spread",trSymbol:"Symbol",trLast24:"Last 24 hours (M15)",trShow:"Show",
  trPositions:"Open positions",trNoPositions:"No open positions.",trSide:"Side",trBuy:"Buy",trSell:"Sell",trVolume:"Volume",trOpenPrice:"Open price",trSlTp:"SL / TP",trProfit:"Profit",
  trBy:"Opened by",trByLayanX:"LayanX",trByYou:"You",trHistory:"Closed trades",trDaysN:"Last {n} days",trNet:"Net",trWins:"Won",trLossesN:"Lost",trNoDeals:"No closed trades in this period.",trClosedAt:"Closed",
  trTester:"Robot testing (Strategy Tester)",trTesterHint:"Runs a robot (.ex5) on a separate MT5 copy for testing (MT5_TESTER_TERMINAL) on history. It sends no order and can take up to 30 minutes.",
  trExpert:"Robot name (inside MQL5\\Experts)",trPeriod:"Timeframe",trFrom:"From",trTo:"To",trModel:"Model",trDeposit:"Deposit",trRun:"Run the test",trRunQ:"Test the robot \"{e}\" on {s}? It sends no order.",
  trNoRuns:"No tests started from this page yet.",trTesting:"Running…",trTestDone:"Done",trTestFailed:"Failed",trNetProfit:"Net profit",trDD:"Max drawdown",trTradesN:"Trades",trPosMonths:"Winning months",
  trAllYears:"All years positive",trYes:"Yes",trNo:"No",trStarted:"The test started. Follow it here.",trNeedExpert:"Enter the robot name and the symbol.",
  cap_trade:"Trading",cap_trade_d:"MetaTrader 5: account, positions and the auto-scalper.",cap_trade_1:"Account and open positions",cap_trade_2:"Auto-scalper with your approval",cap_trade_3:"Robot testing",deleteL:"Delete",deletedT:"Deleted.",
  deleteJobQ:"Delete this autonomous mission from the list for good? If it is running it stops. The project's files are kept.",deleteMissionQ:"Delete this mission from the list for good? If it is running it stops, and its pending approvals are cancelled.",recentActivities:"Recent Activities",viewAll:"View all",noActivity:"No activity yet.",
  st_done:"Completed",st_run:"Running",st_pend:"Pending",st_wait:"Awaiting approval",st_fail:"Failed",
  computerControl:"Computer Control",live:"Live",screenOff:"Live view is off. Take a screenshot or start the stream.",screenWaiting:"Capturing the first desktop frame…",screenError:"Desktop capture failed: {error}",screenStale:"The desktop frame has not refreshed for more than 5 seconds.",screenshot:"Screenshot",mouse:"Mouse",keyboard:"Keyboard",apps:"Apps",startLive:"Start live",stopLive:"Stop live",
  terminalTitle:"Terminal",restricted:"(Restricted)",termEmpty:"Run an allowed command. Anything that executes asks for your approval.",quickActions:"Quick Actions",openVSCode:"Open VS Code",runTests:"Run Tests",buildProject:"Build Project",createBranch:"Create Branch",branchName:"New branch name (e.g. feature/login)",
  cap_dev:"Development & Code",cap_dev_d:"Analyze, modify, test and deploy",cap_dev_1:"Git integration",cap_dev_2:"Auto fix & testing",cap_dev_3:"VS Code",
  cap_shop:"E-commerce",cap_shop_d:"Shopify & WooCommerce",cap_shop_1:"Create products",cap_shop_2:"Manage orders",cap_shop_3:"Sync inventory",
  cap_social:"Social Media",cap_social_d:"Multi-platform publishing",cap_social_1:"Create content",cap_social_2:"Schedule posts",cap_social_3:"Auto publish",
  cap_ads:"Ads Management",cap_ads_d:"Create and manage ad campaigns",cap_ads_1:"Campaign management",cap_ads_2:"Ad creation with AI",cap_ads_3:"Performance analytics",
  cap_pc:"Computer Control",cap_pc_d:"Control desktop applications",cap_pc_1:"Screenshot & vision",cap_pc_2:"Mouse & keyboard",cap_pc_3:"Application control",
  cap_int:"Integrations",cap_int_d:"Connect with your tools",cap_int_1:"API connectors",cap_int_2:"Custom integrations",cap_int_3:"Web automation",
  cap_team:"Team Agents",cap_team_d:"Specialised roles working together",cap_team_1:"Task delegation",cap_team_2:"Per-role permissions",cap_team_3:"Enable / disable",
  connected:"Connected",needsSetup:"Needs setup",activeRoles:"{n} roles active",projectsN:"{n} projects",
  arch:"System Architecture (Current State)",a_user:"User",a_user_1:"Web & mobile",a_user_2:"VS Code & voice",a_planner:"AI Planner",a_planner_1:"Understand goal",a_planner_2:"Plan tasks",a_planner_3:"Choose tools",a_planner_4:"Re-plan if needed",
  a_tools:"Tool Registry",a_tools_n:"{n} tools",a_sec:"Permission & Security",a_sec_1:"Permission levels",a_sec_2:"Approval system",a_sec_3:"Risk analysis",a_sec_4:"Audit logs",
  a_exec:"Execution Engine",a_exec_1:"Run tools",a_exec_2:"Monitor progress",a_exec_3:"Auto repair",a_exec_4:"Verify results",a_mem:"Memory & Recovery",a_mem_1:"Save context",a_mem_2:"Mission history",a_mem_3:"Resume after interruptions",a_mem_4:"Learn from results",
  a_ext:"External Services",a_res:"Results",a_res_1:"Completed tasks",a_res_2:"Updated code",a_res_3:"Published content",a_res_4:"Business growth",pendingN:"{n} pending approvals",modelsN:"{a} local · {b} cloud",servicesN:"{n} services connected",
  notifications:"Notifications",noNotifications:"Nothing is waiting for you.",language:"العربية",
  approvalsLead:"The agent never runs a sensitive action before you approve. You can also approve from the phone or VS Code.",noApprovals:"No pending approvals.",
  all:"All",completed:"Completed",failed:"Failed",blocked:"Blocked",details:"Details",cancel:"Stop",noMissions:"No missions.",
  liveLead:"The agent sees the screen during missions and moves the mouse or types after your approval.",sayThese:"Things you can say or type",
  terminalLead:"Only allowed commands run, inside the project folder; anything that executes waits for your approval.",history:"History",
  projectsLead:"Every folder inside the projects folder is a project; you can also link any other folder (such as the one open in VS Code).",activeProject:"Active project",use:"Use",inspect:"Inspect with agent",linkFolder:"Link a folder",folderPath:"Folder path",projectName:"Project name",link:"Link",linked:"Linked",
  gitLead:"Read commands run immediately; creating branches, commits and pushes needs your approval.",gitAsk:"Ask the agent",gitCommit:"Write a clear commit for the current changes",gitPush:"Push the current branch to GitHub",gitPR:"Prepare a pull request after code and security review",
  stores:"Stores",products:"Products",orders:"Orders",orderValue:"Order value",content:"Content",published:"Published",scheduled:"Scheduled",campaigns:"Campaigns",media:"Media",accounts:"Accounts",
  shopGoals:"Create 5 new products in the store with descriptions and images|Sync new orders from the store|Write a marketing description for the best product",
  plL:"Platforms",plLead:"Connect LayanX to the platforms it works on for websites. The token is stored encrypted on this computer only; reading is safe, and every production deploy, change or deletion waits for your approval.",plConnect:"Connect",plDisconnect:"Disconnect",plSave:"Connect now",plCancel:"Cancel",plGetToken:"Create the token here",plTokenFor:"Token",plOptional:"optional",plKeep:"saved; leave empty to keep it",plTools:"tools",plManaged:"Managed on the setup page",plConnected:"Connected",plDisconnected:"Disconnected",plConfirm:"Disconnect {p}? Its token is deleted from this computer.",plReplaced:"Replaced an earlier copy: {x}",plDocs:"Docs",plShared:"shared with other parts of LayanX",
  pls_connected:"Connected",pls_available:"Ready to connect",pls_needs_token:"Needs a token",pls_error:"Error",pls_starting:"Starting…",plFromMcp:"platform",
  cd_burstiness:"Variety in sentence length",cd_specificity:"Concrete details: numbers, names, dates",cd_slop:"Stock phrases AI overuses",cd_fingerprint:"Hidden characters and machine traces",cd_voice:"A natural voice, like yours",cd_platform:"Platform limits: length and hashtags",
  fk_hidden:"Hidden characters (zero-width and similar)",fk_bidi:"Characters that change text direction",fk_lookalike:"Words with look-alike Cyrillic or Greek letters",fk_chatbot:"Chatbot leftovers (\"Sure! Here's…\")",fk_spaces:"Unusual spaces",fk_markdown:"Markdown the platform shows as symbols",fk_presentation:"Special letter forms copied from a PDF or a chatbot",fk_em_dash:"Many em dashes (—)",fk_emoji_bullets:"Every line starts with an emoji (template look)",fk_exclamations:"Many exclamation marks",
  pk_too_long:"{n} over the platform's limit",pk_long:"{n} longer than reads well",pk_caption:"With a photo or video the caption is cut at 1024 characters",pk_hashtags:"{n} hashtags too many",pk_empty:"Empty text",
  vk_sentence_length:"Sentences much longer or shorter than your own posts",vk_emoji:"Far more emoji than your own posts",vk_exclamations:"Far more exclamation marks than your own posts",bk_same_opening:"Many sentences start with \"{w}\"",
  fx_fp:"Removed by the clean step",fx_vague:"Name it, count it, or cut it",fx_hedge:"Say it plainly",fx_stock_rhetoric:"Start with the point",fx_avoid:"You asked never to use this",fx_same_opening:"Start sentences in different ways",fx_too_long:"Shorten it",fx_long:"Shorten it",fx_hashtags:"Keep the best ones",
  hz:"Humanizer",hzLead:"Makes text read like a person wrote it, for any platform: removes hidden characters and stock phrases, keeps every number, price, link and hashtag.",hzText:"Text",hzPlatform:"Platform",hzKind:"Kind",hzCheck:"Check",hzClean:"Clean",hzRewrite:"Improve",hzWorking:"Working…",hzScore:"Human score",hzResult:"Improved text",hzCopy:"Copy",hzCopied:"Copied",hzUse:"Put it in the box",hzFindings:"Found",hzNone:"Nothing to fix.",hzV_pass:"Pass",hzV_review:"Review",hzV_fail:"Fail",hzNoteL:"Note",
  hzN_no_model:"No local model is running: the text was only cleaned. Start Ollama and try again.",hzN_model_error:"The model could not be reached: the text was only cleaned.",hzN_rewrite_disabled:"Rewriting is off (LAYANX_HUMANIZER): the text was only cleaned.",hzN_already_human:"It already reads human; only hidden traces were removed.",hzN_protected:"Verses or quotations: protected, not reworded.",hzN_html_check_only:"HTML is checked only; improve each paragraph as text.",hzN_rewrite_lost_facts:"The rewrite changed a number, link or hashtag, so it was refused; the cleaned original stays.",hzN_rewrite_not_better:"The rewrite was not better; the cleaned original stays.",
  voiceL:"Your writing voice",voiceLead:"Paste a few real posts you wrote (blank line between them); LayanX compares with them and writes like you.",voiceSamples:"Samples of your writing",voiceDialect:"Dialect",voiceTone:"Tone",voicePerson:"You write as",voiceAny:"—",voiceI:"I",voiceWe:"We",voiceAvoid:"Words you never want (comma-separated)",voicePrefer:"Words you like",voiceSaved:"Voice saved",voiceSave:"Save",qualityL:"Quality",
  k_post:"Post",k_title:"Title",k_meta:"Meta description",k_cta:"Button",k_script:"Video script",k_subject:"E-mail subject",k_push:"Notification",k_ui:"App text",k_store_title:"Store name",k_store_short:"Store short description",k_store_description:"Store description",
  socialGoals:"Write an Instagram post about the newest product|Schedule 3 posts for this week|Show the performance of recent posts",
  adsGoals:"Analyze current campaigns and suggest improvements|Create a small test ad campaign|Pause under-performing campaigns",
  analyticsLead:"Business numbers from your stores, content and growth experiments.",experiments:"Experiments",openActions:"Open actions",
  teamLead:"Each role is a set of tools the agent may use. Turn off what you don't need so the local model chooses more precisely.",enabled:"Enabled",disabled:"Off",restartNote:"Changes apply after a restart from Settings.",
  newSchedule:"New schedule",scheduleLead:"Scheduled missions go through the same permissions and approvals.",task:"Task",repeat:"Repeat",time:"Time",add:"Add",daily:"Daily",interval:"Every…",once:"Once",minutes:"minutes",noSchedules:"No scheduled missions.",pause:"Pause",resume:"Resume",
  localModels:"Local models",cloudModels:"Cloud models",openSetup:"Open setup page",
  toolsLead:"Read and analyze run directly; modify and execute go through permissions and approvals.",skills:"Learned skills",noSkills:"No skills yet.",needsApproval:"Needs approval",search:"Search…",
  activityLead:"Every tool the agent used, how long it took and the result.",
  settingsLead:"Language, runtime and setup links.",restart:"Restart",voice:"Voice assistant",setup:"Setup & keys",status:"Status",
  loading:"Loading…",loadFailed:"Could not load this section",approved:"Approved",rejected:"Rejected",resuming:"Approved, continuing the mission…",needAnother:"Another approval is needed",stoppedMsg:"Execution stopped",
  r_noexec:"The agent found no executable step",r_models:"No model is available (check Ollama or cloud keys)",r_plan:"The model could not produce a valid plan",r_notallowed:"That tool or command is not allowed",
  via:" via {p}",ago_now:"now",ago_m:"{n}m ago",ago_h:"{n}h ago",
  act_start:"Started mission",act_done:"Completed: {t}",act_wait:"Waiting for approval: {t}",act_fail:"Failed: {t}",act_verify:"Mission verified",act_cloud:"Mission moved to a cloud model",act_run:"Running: {t}",
  tl_files_write:"Write file",tl_files_read:"Read file",tl_terminal:"Run command",tl_git_commit:"Create commit",tl_git_push:"Push to repository",tl_git_status:"Check Git",tl_shot:"Screenshot",tl_click:"Mouse click",tl_type:"Type text",tl_verify:"Verify project",tl_research:"Internet research",tl_mt5_read:"Read MetaTrader 5",tl_mt5_tester:"Backtest a robot in the Strategy Tester",tl_mt5_scalper:"MT5 auto-scalper"}
};
const t=(k,v)=>{let s=(T[LANG]&&T[LANG][k])??T.en[k]??k;if(v)for(const[a,b]of Object.entries(v))s=s.split("{"+a+"}").join(String(b));return s;};

// ------------------------------------------------------------------ icons & helpers
const P={
 trading:'<path d="M3 17l5-5 4 4 8-8"/><path d="M14 8h6v6"/>',
 dashboard:'<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',agent:'<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6"/>',
 missions:'<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',approvals:'<path d="M12 3l7 3v5c0 5-3.4 8.6-7 10-3.6-1.4-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
 computer:'<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',terminal:'<path d="M4 17l6-5-6-5M12 19h8"/>',projects:'<path d="M8 6l-5 6 5 6M16 6l5 6-5 6"/>',
 git:'<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 4-6 4-12 7"/>',ecommerce:'<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.5 12h11L21 7H6"/>',
 social:'<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>',ads:'<path d="M3 11v2a1 1 0 001 1h3l5 4V6L7 10H4a1 1 0 00-1 1z"/><path d="M16 9a4 4 0 010 6M19 6a8 8 0 010 12"/>',
 analytics:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',integrations:'<circle cx="12" cy="5" r="2.2"/><circle cx="5" cy="18" r="2.2"/><circle cx="19" cy="18" r="2.2"/><path d="M12 7.2v4M12 11.2l-5.5 5M12 11.2l5.5 5"/>',
 team:'<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0112 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.5A5 5 0 0121 20"/>',schedules:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
 models:'<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',tools:'<path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
 activity:'<path d="M3 12h4l3 7 4-14 3 7h4"/>',settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
 bolt:'<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',bars:'<path d="M6 20V12M12 20V6M18 20v-9"/>',check:'<path d="M5 12l4.5 4.5L19 7"/>',nodes:'<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M10.5 7l-4 8.5M13.5 7l4 8.5M7.5 18h9"/>',
 spark:'<path d="M12 2l2.2 6.3L20.5 10.5l-6.3 2.2L12 19l-2.2-6.3L3.5 10.5l6.3-2.2z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>',search:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
 mic:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',bell:'<path d="M6 9a6 6 0 0112 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 21h4"/>',menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
 stop:'<circle cx="12" cy="12" r="8"/>',logs:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',file:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',pr:'<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><path d="M6 8v8M18 16V9a3 3 0 00-3-3h-4M13 4l-2 2 2 2"/>',
 send:'<path d="M5 12h13M13 6l6 6-6 6"/>',camera:'<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',mouse:'<rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 7v4"/>',
 keyboard:'<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',apps:'<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
 code:'<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',play:'<path d="M7 4l13 8-13 8z"/>',box:'<path d="M12 3l9 5v8l-9 5-9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/>',branch:'<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10M18 9a6 6 0 01-6 6H8"/>',
 user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',shield:'<path d="M12 3l7 3v5c0 5-3.4 8.6-7 10-3.6-1.4-7-5-7-10V6z"/>',cog:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',db:'<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/>',
 cloud:'<path d="M7 18a5 5 0 01-.6-10A6 6 0 0118 9a4.5 4.5 0 01-1 9z"/>',flag:'<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>',globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'
};
function icon(n){const s=document.createElementNS("http://www.w3.org/2000/svg","svg");s.setAttribute("viewBox","0 0 24 24");s.setAttribute("class","i");s.setAttribute("aria-hidden","true");s.innerHTML=P[n]||"";return s;}
function el(tag,props={},...kids){const n=document.createElement(tag);for(const[k,v]of Object.entries(props)){if(v===undefined||v===null||v===false)continue;if(k==="class")n.className=v;else if(k==="text")n.textContent=v;else if(k.startsWith("on")&&typeof v==="function")n.addEventListener(k.slice(2),v);else n.setAttribute(k,v===true?"":v);}for(const kid of kids.flat(Infinity))if(kid!==null&&kid!==undefined&&kid!==false)n.append(kid);return n;}
function toast(m){const x=$("#toast");x.textContent=m;x.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>x.hidden=true,4500);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const uid=()=>Math.random().toString(36).slice(2);
function project(){return localStorage.getItem("lx.cc.project")||"default";}
function setProject(p){localStorage.setItem("lx.cc.project",p||"default");}
function ago(ts){const v=typeof ts==="number"?ts:Date.parse(ts||0);if(!v)return"";const d=(Date.now()-v)/1000;if(d<45)return t("ago_now");if(d<3600)return t("ago_m",{n:Math.round(d/60)});if(d<86400)return t("ago_h",{n:Math.round(d/3600)});return new Date(v).toLocaleDateString(LANG==="ar"?"ar":"en");}
async function api(path,opts={}){
 const r=await fetch(path,{method:opts.method||"GET",credentials:"same-origin",headers:opts.body!==undefined?{"content-type":"application/json"}:{},body:opts.body!==undefined?JSON.stringify(opts.body):undefined});
 if(r.status===401){location.href="/setup";throw new Error("unauthorized");}
 let d;try{d=await r.json();}catch{d={};}
 if(!r.ok&&!(opts.allow||[]).includes(r.status))throw new Error(d.message||d.error||("HTTP "+r.status));
 return d;
}
const safe=async(p,fb)=>{try{return await p;}catch{return fb;}};
/** MCP tool servers: list, owner approval, registry search. */
// ---------- Platforms (src/platforms): GitHub, Vercel, Hostinger, Cloudflare, Netlify, Supabase, Context7, Claude ----------
async function platformsPanel(){
 const box=el("section",{class:"card",style:"margin-top:1rem"});
 const state=s=>s==="connected"?"done":s==="error"?"fail":s==="starting"?"run":s==="available"?"wait":"pend";
 const render=async()=>{
  const d=await safe(api("/v1/platforms"),{platforms:[]});
  const tiles=(d.platforms||[]).map(p=>{
   const form=el("div",{hidden:true,style:"margin-top:.6rem;display:grid;gap:.5rem"});
   const inputs={};
   for(const s of p.secrets.filter(x=>!x.shared||!x.set)){
    const input=el("input",{class:"text",type:"password",autocomplete:"off",dir:"ltr",placeholder:s.set?t("plKeep"):s.name+(s.optional?" ("+t("plOptional")+")":"")});
    inputs[s.name]=input;
    form.append(el("label",{class:"f"},s.name+(s.optional?" · "+t("plOptional"):""),input,el("small",{class:"muted",dir:"auto",text:s.scopes[LANG]||s.scopes.en}),el("a",{href:s.createUrl,target:"_blank",rel:"noopener noreferrer",class:"small",text:t("plGetToken")+" ↗"})));
   }
   for(const s of p.secrets.filter(x=>x.shared&&x.set))form.append(el("small",{class:"muted",text:s.name+" ✓ · "+t("plShared")}));
   const save=el("button",{class:"btn small primary",text:t("plSave"),onclick:async()=>{
    save.disabled=true;
    try{const body={};for(const [k,i] of Object.entries(inputs))if(i.value.trim())body[k]=i.value.trim();
     const r=await api("/v1/platforms/"+p.id+"/connect",{method:"POST",body});
     toast(r.ok?t("plConnected")+(r.replaced&&r.replaced.length?" · "+t("plReplaced",{x:r.replaced.join(", ")}):""):(r.status&&r.status.mcp&&r.status.mcp.error)||"✗");}
    catch(e){toast(e.message);}
    finally{save.disabled=false;for(const i of Object.values(inputs))i.value="";}
    render();}});
   form.append(el("div",{style:"display:flex;gap:.4rem"},save,el("button",{class:"btn small",text:t("plCancel"),onclick:()=>{form.hidden=true;}})));
   const actions=p.managedOnSetup?el("a",{class:"btn small",href:"/setup",text:t("plManaged")}):
    el("div",{style:"display:flex;gap:.4rem;flex-wrap:wrap"},
     el("button",{class:"btn small"+(p.state==="connected"?"":" primary"),text:t("plConnect"),onclick:()=>{form.hidden=!form.hidden;}}),
     p.state==="connected"||p.state==="error"||p.state==="starting"||p.secrets.some(s=>s.set&&!s.shared)?el("button",{class:"btn small",text:t("plDisconnect"),onclick:async()=>{if(!confirm(t("plConfirm",{p:p.label})))return;try{await api("/v1/platforms/"+p.id+"/disconnect",{method:"POST",body:{}});toast(t("plDisconnected"));}catch(e){toast(e.message);}render();}}):null);
   return el("div",{class:"integ",style:"flex-direction:column;align-items:stretch"},
    el("div",{style:"display:flex;gap:.6rem;align-items:center"},el("span",{class:"dot "+(p.state==="connected"?"on":p.state==="available"||p.state==="starting"?"part":"")}),el("b",{style:"flex:1",text:p.label}),pill(state(p.state),t("pls_"+p.state))),
    el("small",{class:"muted",dir:"auto",text:p.about[LANG]||p.about.en}),
    p.tools.length?el("small",{class:"mono",text:p.tools.length+" "+t("plTools")}):null,
    p.mcp&&p.mcp.error?el("small",{class:"muted",style:"color:var(--red,#e5484d)",dir:"ltr",text:p.mcp.error.slice(0,240)}):null,
    actions,form);
  });
  box.replaceChildren(el("h3",{text:t("plL")}),el("p",{class:"muted",text:t("plLead")}),el("div",{class:"grid3",style:"margin-top:.6rem"},tiles));
 };
 await render();
 return box;
}
async function mcpPanel(){
 const box=el("section",{class:"card",style:"margin-top:1rem"});
 const render=async()=>{
  const d=await safe(api("/v1/mcp/servers"),{servers:[]});const servers=d.servers||[];
  const act=(id,op)=>async()=>{try{await api("/v1/mcp/servers/"+id+"/"+op,{method:"POST",body:{}});toast("✓");}catch(e){toast(e.message);}render();};
  const list=servers.length?el("div",{class:"rows"},servers.map(s=>el("div",{class:"row"},
   el("div",{class:"t",dir:"auto",text:s.name+" · "+s.id+(/^Platform: /.test(s.note||"")?" · "+t("plFromMcp"):"")}),
   el("div",{class:"s",dir:"auto",text:[s.connected?(s.tools.length+" "+t("mcpTools")):s.approved?"":t("mcpPending"),s.requestedBy?t("mcpRequested")+" "+s.requestedBy:"",s.note||"",(s.envFromSecrets||[]).length?t("mcpSecrets")+": "+s.envFromSecrets.join(", "):"",s.error||""].filter(Boolean).join(" · ")}),
   el("div",{class:"a"},pill(s.connected?"run":s.approved?"fail":"pend",s.connected?"on":s.approved?"off":t("mcpPending")),
    s.connected?el("button",{class:"btn small",text:t("mcpDisable"),onclick:act(s.id,"disable")}):el("button",{class:"btn small primary",text:t("mcpApprove"),onclick:act(s.id,"approve")}),
    el("button",{class:"btn small",text:t("mcpRemove"),onclick:act(s.id,"remove")}))))):el("p",{class:"muted",text:t("mcpNone")});
  const q=el("input",{class:"text",type:"search",placeholder:t("mcpSearch"),dir:"auto",style:"flex:1"});
  const results=el("div",{class:"rows",style:"margin-top:.6rem"});
  const search=async()=>{results.textContent="";const r=await safe(api("/v1/mcp/registry?q="+encodeURIComponent(q.value)),{results:[]});
   for(const x of (r.results||[]).slice(0,10))results.append(el("div",{class:"row"},el("div",{class:"t",dir:"auto",text:x.name+" "+x.version}),el("div",{class:"s",dir:"auto",text:x.description||""}),
    el("div",{class:"a"},x.suggested?el("button",{class:"btn small",text:t("mcpAdd"),onclick:async()=>{try{await api("/v1/mcp/servers",{method:"POST",body:x.suggested});toast(t("mcpPending"));}catch(e){toast(e.message);}render();}}):null)));};
  const go=el("button",{class:"btn",text:"🔍",onclick:search});q.addEventListener("keydown",e=>{if(e.key==="Enter")search();});
  const idInput=el("input",{class:"text",value:"jarvis-win",dir:"ltr",placeholder:"jarvis-win",autocomplete:"off"});
  const nameInput=el("input",{class:"text",value:"Jarvis on Windows",dir:"auto",autocomplete:"off"});
  const commandInput=el("input",{class:"text",dir:"ltr",placeholder:"C:\\Program Files\\Jarvis\\JarvisAgent.exe",autocomplete:"off"});
  const argsInput=el("textarea",{class:"text",dir:"ltr",rows:"4",placeholder:"--mcp\n--config\nC:\\Users\\YOUR_USER\\AppData\\Local\\Jarvis\\config.toml"});
  const customForm=el("div",{class:"card",hidden:true,style:"margin-top:.8rem;gap:.6rem"},
   el("h4",{text:t("mcpCustom")}),el("p",{class:"muted",text:t("mcpCustomLead")}),
   el("label",{class:"f"},t("mcpServerId"),idInput),
   el("label",{class:"f"},t("mcpServerName"),nameInput),
   el("label",{class:"f"},t("mcpCommand"),commandInput),
   el("label",{class:"f"},t("mcpArgs"),argsInput),
   el("small",{class:"muted",text:t("mcpCommandHelp")}),
   el("div",{style:"display:flex;gap:.5rem;flex-wrap:wrap"},
    el("button",{class:"btn primary",text:t("mcpCreate"),onclick:async()=>{
     const id=idInput.value.trim().toLowerCase(),name=nameInput.value.trim(),command=commandInput.value.trim();
     if(!id||!command){toast(t("mcpNeedFields"));return;}
     const args=argsInput.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
     try{
      await api("/v1/mcp/servers",{method:"POST",body:{id,name:name||id,transport:"stdio",command,args,note:"Owner-added local MCP executable"}});
      toast(t("mcpPending"));customForm.hidden=true;await render();
     }catch(e){toast(e.message);}
    }}),
    el("button",{class:"btn",text:t("mcpCancel"),onclick:()=>{customForm.hidden=true;}})));
  const addLocal=el("button",{class:"btn",text:t("mcpCustom"),onclick:()=>{customForm.hidden=!customForm.hidden;}});
  box.replaceChildren(el("h3",{text:t("mcpL")}),el("p",{class:"muted",text:t("mcpLead")}),list,el("div",{style:"display:flex;gap:.5rem;margin-top:1rem;flex-wrap:wrap"},q,go,addLocal),results,customForm);
 };
 await render();
 return box;
}

const REASONS=[[/no executable result/i,"r_noexec"],[/All candidate model providers failed|No enabled model/i,"r_models"],[/Incomplete mission plan|Planner|invalid plan/i,"r_plan"],[/not allowed/i,"r_notallowed"]];
const reasonText=r=>{for(const[rx,k]of REASONS)if(rx.test(r||""))return t(k);return r||"";};
const STATUS_CLASS={done:"s-done",run:"s-run",pend:"s-pend",wait:"s-wait",fail:"s-fail"};
const missionState=s=>s==="completed"?"done":["running","verifying","planned"].includes(s)?"run":s==="awaiting_approval"?"wait":["failed","blocked","cancelled"].includes(s)?"fail":"pend";
const isQuick=m=>(m.tools||[]).length===1&&m.tools[0].reason==="owner quick action";
const agentMissions=()=>S.missions.filter(m=>!isQuick(m));
/** A mission an autonomous job ran for one of its milestones: it belongs to that job and is shown inside it, never alone. */
const JOB_TASK=/^Overall goal: /;
const jobMissionIds=()=>new Set(S.jobs.flatMap(j=>(j.milestones||[]).flatMap(m=>m.missions||[])));
const ownMissions=()=>{const ids=jobMissionIds();return agentMissions().filter(m=>!ids.has(m.id)&&!JOB_TASK.test(m.goal||""));};
const isPending=a=>a.pending??!a.approved;
const waitingFor=id=>S.approvals.some(a=>isPending(a)&&a.missionId===id);
const stateOf=m=>waitingFor(m.id)?"wait":missionState(m.status);
const goalText=m=>isQuick(m)?(m.tools[0].payload&&m.tools[0].payload.command?"> "+m.tools[0].payload.command:m.tools[0].tool):(m.goal||m.id).split("\n")[0].replace(JOB_TASK,"");
const pill=(state,text)=>el("span",{class:"status "+(STATUS_CLASS[state]||"s-pend"),text:text||t("st_"+state)});
const TOOL_LABEL={"apis.search":"tl_apis","files.write":"tl_files_write","files.read":"tl_files_read","terminal.exec":"tl_terminal","git.commit":"tl_git_commit","git.push":"tl_git_push","git.status":"tl_git_status","desktop.screenshot":"tl_shot","desktop.mouse.click":"tl_click","desktop.keyboard.type":"tl_type","project.verify":"tl_verify","research.internet":"tl_research",
  "trading.mt5.account":"tl_mt5_read","trading.mt5.positions":"tl_mt5_read","trading.mt5.quote":"tl_mt5_read","trading.mt5.candles":"tl_mt5_read","trading.mt5.history":"tl_mt5_read",
  "trading.mt5.tester.run":"tl_mt5_tester","trading.mt5.autoscalper.start":"tl_mt5_scalper","trading.mt5.autoscalper.stop":"tl_mt5_scalper","trading.mt5.autoscalper.status":"tl_mt5_scalper"};
function toolLabel(p){const k=TOOL_LABEL[p.tool];const base=k?t(k):(p.reason&&p.reason.length<70?p.reason:p.action||p.tool);const extra=p.tool==="terminal.exec"&&p.payload&&p.payload.command?" ("+p.payload.command+")":p.tool==="files.write"&&p.payload&&p.payload.path?" ("+p.payload.path+")":"";return base+extra;}

// ------------------------------------------------------------------ state & data
const S={jobs:[],setup:null,setupAt:0,missions:[],approvals:[],health:null,tools:null,channels:null,oauth:null,live:null,details:new Map(),log:(()=>{try{return JSON.parse(sessionStorage.getItem("lx.cc.log")||"[]");}catch{return[];}})(),term:JSON.parse(localStorage.getItem("lx.cc.term")||"[]"),biz:null,ads:null};
const saveTerm=()=>localStorage.setItem("lx.cc.term",JSON.stringify(S.term.slice(0,25).map(e=>({...e,approval:undefined}))));
async function loadSetup(force){if(force||!S.setup||Date.now()-S.setupAt>30000){S.setup=await safe(api("/v1/setup/status"),S.setup);S.setupAt=Date.now();}return S.setup;}
async function loadMissions(){const d=await safe(api("/v1/missions?projectId="+encodeURIComponent(project())),null);if(d)S.missions=(d.missions||[]).slice().sort((a,b)=>Date.parse(b.createdAt||0)-Date.parse(a.createdAt||0));return S.missions;}
async function loadApprovals(){const d=await safe(api("/v1/approvals?projectId="+encodeURIComponent(project())),null);if(d)S.approvals=d.approvals||[];return S.approvals;}
async function missionDetail(id){const d=await safe(api("/v1/missions/"+encodeURIComponent(id)+"?projectId="+encodeURIComponent(project())),null);if(d&&d.mission)S.details.set(id,d);return S.details.get(id)||null;}
function deriveSteps(detail){
 if(!detail||!detail.mission)return[];
 const m=detail.mission,audit=detail.audit||[],tools=m.tools||[];
 if(!tools.length)return(m.steps||[]).map(s=>({label:s.description,state:s.status==="completed"?"done":s.status==="running"?"run":s.status==="failed"?"fail":"pend"}));
 return tools.map((p,i)=>{
  const ev=audit.filter(a=>a.resource===p.tool&&(a.metadata?.planIndex===undefined||a.metadata.planIndex===i));
  let state="pend";
  if(ev.some(a=>a.result==="success"))state="done";else if(ev.some(a=>a.result==="failure"||a.result==="denied"))state="fail";else if(ev.some(a=>a.result==="pending_approval"))state="wait";else if(ev.some(a=>a.result==="allowed"))state="run";
  if(m.status==="completed"&&state==="run")state="done";
  return{label:toolLabel(p),state};
 });
}
function integrationStatus(){
 const s=S.setup;if(!s)return[];
 const names=new Set((s.secrets?.names||[]).map(n=>n.name));const has=(...k)=>k.every(x=>names.has(x));const any=(...k)=>k.some(x=>names.has(x));
 const ch=S.channels?.channels||{};const oc=S.oauth?.connections||[];
 return[
  ["Ollama",s.ollama?.reachable&&s.ollama?.models?.length?"on":"off",(s.ollama?.models?.length||0)+" models"],
  ["Whisper",s.assistant?.stt==="local"?"on":"part",s.assistant?.stt==="local"?"local":"browser"],
  // Claude and GitHub are shown once, under Platforms.
  ...(s.cloud?.providers||[]).filter(p=>p.keyName!=="ANTHROPIC_API_KEY").map(p=>[p.label,p.active?"on":p.hasKey?"part":"off",p.active?p.model:p.keyName]),
  ["Google Workspace",any("GOOGLE_REFRESH_TOKEN","GOOGLE_ACCESS_TOKEN")?"on":"off","GOOGLE_REFRESH_TOKEN"],
  ["Yahoo Mail",has("YAHOO_APP_PASSWORD")?"on":"off","YAHOO_APP_PASSWORD"],
  ["WhatsApp",ch.whatsapp?.configured||ch.whatsapp?.enabled?"on":"off","WhatsApp Cloud API"],
  ["Telegram",ch.telegram?.configured||ch.telegram?.enabled?"on":"off","Bot token"],
  ["Shopify",has("LAYANX_SHOPIFY_ACCESS_TOKEN")?"on":"off","LAYANX_SHOPIFY_ACCESS_TOKEN"],
  ["WooCommerce",has("LAYANX_WOOCOMMERCE_CONSUMER_KEY")?"on":"off","LAYANX_WOOCOMMERCE_CONSUMER_KEY"],
  ["Ads (Meta, TikTok, Google, X)",any("LAYANX_META_ADS_TOKEN","LAYANX_TIKTOK_ADS_TOKEN","LAYANX_GOOGLE_ADS_TOKEN","LAYANX_X_ADS_TOKEN")?"on":"off","LAYANX_*_ADS_TOKEN"],
  ["Social OAuth",oc.length?"on":"off",oc.length?oc.map(c=>c.provider).join(", "):"OAuth"],
  ["Quran Foundation",has("QF_CLIENT_SECRET")?"part":"off","QF_CLIENT_SECRET"],
  ["VS Code / Phone",(s.devices||[]).length?"on":"off",(s.devices||[]).length+" devices"]
 ];
}
function projectPath(name=project()){
 const w=S.setup?.workspace;if(!w)return"";
 const id=name.toLowerCase();const linked=(w.linked||[]).find(l=>l.projectId.toLowerCase()===id);
 if(linked)return linked.path;const sep=(w.root||"").includes("\\")?"\\":"/";return(w.root||"")+sep+name;
}
const vscodeUrl=(name)=>{const p=projectPath(name);return p?"vscode://file/"+encodeURI(p.replace(/\\/g,"/")):"#";};

// ------------------------------------------------------------------ approvals
async function decideApproval(a,action,onResult){
 await api("/v1/approvals/"+encodeURIComponent(a.id)+"/"+action+"?projectId="+encodeURIComponent(project()),{method:"POST",body:{}});
 if(action!=="approve"){toast(t("rejected"));return null;}
 // An autonomous job (or Claude Code / Codex through its hook) continues by itself; resuming here too would run it twice.
 if(a.jobId||a.external){toast(t("approved"));return null;}
 const d=a.missionId?await missionDetail(a.missionId):null;
 const index=typeof a.index==="number"?a.index:(d?.mission?.tools||[]).findIndex(x=>x.tool===a.tool&&x.action===a.action);
 if(!a.missionId||index<0){toast(t("approved"));return null;}
 if((d?.mission?.goal||"").startsWith("run terminal command")||(d?.mission?.tools||[]).length===1&&d?.mission?.tools?.[0]?.reason==="owner quick action"){
  const r=await api("/v1/tools/run",{method:"POST",body:{tool:d.mission.tools[0].tool,payload:d.mission.tools[0].payload||{},projectId:project(),missionId:a.missionId,approvalId:a.id},allow:[422]});
  onResult&&onResult(r);return r;
 }
 toast(t("resuming"));
 const r=await api("/v1/missions/"+encodeURIComponent(a.missionId)+"/agent-loop",{method:"POST",body:{projectId:project(),maxSteps:10,agentId:"core",approvalIds:{[index]:a.id}},allow:[422]});
 toast(r.completed?t("completedVerified"):r.paused?t("needAnother"):t("stoppedMsg")+": "+reasonText(r.reason||r.status));
 onResult&&onResult(r);return r;
}

// ------------------------------------------------------------------ autonomous jobs (supervisor)
const JOB_ACTIVE=["queued","planning","running","waiting_approval","verifying"];
const jobState=j=>j.status==="completed"?"done":j.status==="waiting_approval"?"wait":j.status==="queued"?"pend":["failed","cancelled","budget_exhausted"].includes(j.status)?"fail":"run";
async function loadJobs(){const d=await safe(api("/v1/supervisor/jobs?projectId="+encodeURIComponent(project())),null);if(d)S.jobs=d.jobs||[];return S.jobs;}
const openWhenDonePref=()=>{try{return localStorage.getItem("lx.job.open")!=="0";}catch{return true;}};
async function startJob(goal,minutes,openWhenDone=openWhenDonePref(),acceptanceProfile){
 const d=await api("/v1/supervisor/jobs",{method:"POST",body:{goal,projectId:project(),openWhenDone,...(minutes?{maxMinutes:minutes}:{}),...(acceptanceProfile?{acceptanceProfile}:{})}});
 S.jobs.unshift(d.job);toast(t("jobStarted"));return d.job;
}
const JOB_STOPPED=["failed","cancelled","budget_exhausted"];
async function resumeJob(j){try{await api("/v1/supervisor/jobs/"+encodeURIComponent(j.id)+"/resume",{method:"POST",body:{}});toast(t("jobResumed"));await loadJobs();render();}catch(e){toast(e.message);}}
async function reconcileJob(j,decision){
 const warning=LANG==="ar"
  ?"حدث انقطاع أثناء تنفيذ خطوة، وقد تكون إجراءاتها نُفذت بالفعل. راجع سجل التنفيذ ونتائج أي إرسال أو نشر أو تداول قبل المتابعة. هل تؤكد أنك تحققت وأن "+(decision==="retry"?"إعادة المحاولة آمنة؟":"المهمة ستتوقف دون إعادة المحاولة؟")
  :"The task was interrupted during an action. Check audit logs and any external messages, publications, or orders first. Confirm "+(decision==="retry"?"that retry is safe and will not duplicate effects.":"that the task should be stopped without replay.");
 if(!confirm(warning))return;
 try{
  await api("/v1/supervisor/jobs/"+encodeURIComponent(j.id)+"/reconcile",{method:"POST",
   body:{decision,acknowledgeUnknownEffects:true}});
  await loadJobs();render();
 }catch(error){toast(error.message);}
}
/** Show a job's site: the server starts the dev server if needed (approval or trust decides) and opens it on this PC. */
async function openJobSite(j,extra={}){
 try{
  const r=await api("/v1/supervisor/jobs/"+encodeURIComponent(j.id)+"/open",{method:"POST",body:extra,allow:[202,422]});
  if(r.needsApproval){
   if(!confirm(t("needsDevApproval")))return;
   await api("/v1/approvals/"+encodeURIComponent(r.approvalId)+"/approve?projectId="+encodeURIComponent(j.projectId),{method:"POST",body:{}});
   return openJobSite(j,{missionId:r.missionId,approvalId:r.approvalId});
  }
  toast(r.ok&&r.url?t("openedSite")+" "+r.url:reasonText(r.error||""));
 }catch(e){toast(e.message);}
}
/** A message while a job runs on this project goes to that job (after asking), not into a second job. */
async function noteForRunningJob(text){
 await loadJobs();
 const running=S.jobs.find(j=>JOB_ACTIVE.includes(j.status)&&j.projectId===project());
 if(!running||!confirm(t("addToJobQ").replace("{goal}",running.goal.split("\n")[0].slice(0,90))))return false;
 const d=await api("/v1/supervisor/jobs/"+encodeURIComponent(running.id)+"/notes",{method:"POST",body:{text}});
 S.log.push({id:uid(),role:"you",text,at:Date.now()},{id:uid(),role:"me",text:t("noteAdded")+(d.job?.openWhenDone?" "+t("openWhenDoneSet"):""),state:"run",at:Date.now(),job:running.id});
 drawAgent();return true;
}
function jobView(j,full){
 const done=j.milestones.filter(m=>m.status==="done").length,total=j.milestones.length;const pct=total?Math.round(done/total*100):0;
 const box=el("div",{class:"term",hidden:!full,style:"max-height:16rem"},(j.log||[]).slice(full?-60:-8).map(l=>el("div",{class:l.level==="error"?"bad":l.level==="warn"?"wait":"",text:(l.at||"").slice(11,19)+"  "+l.msg})));
 const approve=j.status==="waiting_approval"&&j.waiting?el("button",{class:"btn warn small",onclick:async e=>{e.target.disabled=true;try{await api("/v1/approvals/"+encodeURIComponent(j.waiting.approvalId)+"/approve?projectId="+encodeURIComponent(j.projectId),{method:"POST",body:{}});toast(t("approved"));}catch(err){toast(err.message);}}},t("approve")):null;
 const stopped=JOB_STOPPED.includes(j.status);const stuck=j.milestones[Math.min(j.current,Math.max(total-1,0))];
 const summary=j.status==="completed"?el("div",{class:"job-sum ok",text:"✓ "+t("jobDoneSummary",{a:done,b:total})}):stopped&&stuck?el("div",{class:"job-sum bad",dir:"auto",text:t("jobStoppedAt",{n:Math.min(j.current+1,total),title:stuck.title})}):null;
 // Where the job's files are (the site itself opens with "Open the site").
 const where=projectPath(j.projectId);
 const files=where?el("div",{class:"small muted",style:"margin-top:.3rem;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap"},el("span",{text:t("folderPath")+":"}),el("span",{class:"mono",dir:"ltr",text:where}),el("a",{class:"link",href:vscodeUrl(j.projectId),text:t("openVSCode")})):null;
 const notes=(j.notes||[]).length||j.openWhenDone?el("div",{class:"small muted",dir:"auto",style:"margin-top:.3rem"},(j.notes||[]).length?t("ownerNotesL")+": "+j.notes.slice(-3).join(" · "):"",j.openWhenDone&&JOB_ACTIVE.includes(j.status)?((j.notes||[]).length?" — ":"")+t("willOpenL"):""):null;
 const outcome=j.outcome;
 const proof=outcome?el("div",{class:"small",dir:"auto",style:"margin-top:.6rem"},
  el("span",{class:"status "+(outcome.status==="verified"?"s-done":"s-fail"),text:(LANG==="ar"?"نتيجة التحقق: ":"Verification: ")+outcome.status}),
  el("span",{class:"muted",style:"margin-inline-start:.45rem",text:(outcome.evidence||[]).filter(e=>e.passed).length+"/"+(outcome.evidence||[]).length+(LANG==="ar"?" أدلة ناجحة":" passing evidence items")}),
  ...(outcome.blockers||[]).slice(0,4).map(reason=>el("div",{class:"bad",style:"margin-top:.3rem",text:reason}))
 ):null;
 const behavior=j.acceptanceProfile==="task-app-http-v1"?el("div",{class:"small",dir:"auto",style:"margin-top:.4rem"},
  (LANG==="ar"?"اختبار التطبيق المستقل: ":"Independent task-app check: ")+(j.behavior?(j.behavior.ok?"✓":"✗"):"…"),
  ...(j.behavior?.checks||[]).map(c=>el("span",{class:"status "+(c.ok?"s-done":"s-fail"),style:"margin:.2rem",title:c.detail,text:c.name})),
  ...(j.behavior?.blockers||[]).slice(0,3).map(reason=>el("div",{class:"bad",text:reason}))
 ):null;
 const handoff=j.delivery?el("div",{class:"small muted",dir:"auto",style:"margin-top:.5rem"},
  el("span",{text:(LANG==="ar"?"ملفات التسليم: ":"Delivery files: ")+j.delivery.fileCount+" · "}),
  el("span",{class:"mono",dir:"ltr",text:j.delivery.guidePath||j.delivery.manifestPath}),
  el("span",{text:" · "+j.delivery.manifestPath})
 ):null;
 return el("section",{class:"card",style:"margin-bottom:1rem"},
  el("div",{class:"card-head"},el("h3",{dir:"auto",text:j.goal.split("\n")[0].slice(0,140)}),el("div",{style:"display:flex;gap:.4rem;align-items:center;flex-wrap:wrap"},pill(jobState(j),t("j_"+j.status)),approve,
   stopped&&!j.recoveryHold?el("button",{class:"btn primary small",onclick:()=>resumeJob(j)},icon("play"),t("resumeJob")):null,
   j.recoveryHold&&j.status==="failed"?el("button",{class:"btn warn small",onclick:()=>reconcileJob(j,"retry"),text:LANG==="ar"?"تحققت من التنفيذ: أعد المحاولة":"Reviewed effects: retry"}):null,
   j.recoveryHold&&j.status==="failed"?el("button",{class:"btn danger small",onclick:()=>reconcileJob(j,"abort"),text:LANG==="ar"?"إيقاف دون تكرار":"Stop without retry"}):null,
   j.status==="completed"||j.preview?el("button",{class:"btn small",onclick:()=>openJobSite(j)},icon("globe"),t("openSite")):null,
   JOB_ACTIVE.includes(j.status)?el("button",{class:"btn small",text:t("cancel"),onclick:async()=>{try{await api("/v1/supervisor/jobs/"+encodeURIComponent(j.id)+"/cancel",{method:"POST",body:{}});render();}catch(e){toast(e.message);}}}):null,
   el("button",{class:"btn small danger",text:t("deleteL"),title:t("deleteJobQ"),onclick:async()=>{if(!confirm(t("deleteJobQ")))return;try{await api("/v1/supervisor/jobs/"+encodeURIComponent(j.id)+"/delete",{method:"POST",body:{}});toast(t("deletedT"));await loadJobs();render();}catch(e){toast(e.message);}}}),
   el("button",{class:"btn small",text:t("logL"),onclick:()=>{box.hidden=!box.hidden;}}))),
  el("div",{class:"small muted",style:"display:flex;justify-content:space-between"},el("span",{text:t("stepsDone",{a:done,b:total||"—"})+" · "+t("trustL")+": "+t("t_"+j.trust).split(":")[0]+(j.cloudUsed?" · "+t("cloudUsedL"):"")+(j.externalUsed&&j.externalUsed.length?" · "+j.externalUsed.join(", "):"")}),el("span",{text:(LANG==="ar"?"تقدم الخطوات ":"Milestones ")+pct+"%"})),
  el("div",{class:"progress"},el("i",{style:"width:"+pct+"%"})),
  summary,files,notes,
  j.recoveryHold?el("div",{class:"job-sum bad",dir:"auto",text:(LANG==="ar"?"إيقاف احترازي: نتيجة الخطوة السابقة مجهولة. راجع العمليات الخارجية قبل إعادة المحاولة. ":"Recovery hold: previous action outcome unknown; inspect external effects before retry. ")+j.recoveryHold.description}):null,
  proof,behavior,handoff,
  el("ul",{class:"steps"},j.milestones.map((m,i)=>el("li",{class:i===j.current&&JOB_ACTIVE.includes(j.status)?"current":""},el("span",{class:"tick "+(m.status==="done"?"done":m.status==="failed"?"fail":i===j.current&&j.status==="waiting_approval"?"wait":i===j.current&&JOB_ACTIVE.includes(j.status)?"run":"pend"),text:m.status==="done"?"✓":m.status==="failed"?"!":""}),
   el("span",{class:"t",dir:"auto",text:m.title}),el("span",{class:"status s-pend",text:t("ag_"+m.agent)}),m.attempts>1?el("span",{class:"status s-wait",text:"×"+m.attempts}):null))),
  j.lastChecks&&j.lastChecks.length?el("div",{class:"chips"},j.lastChecks.map(c=>el("span",{class:"status "+(c.ok?"s-done":"s-fail"),text:c.name}))):null,
  j.visual?el("div",{class:"small muted",style:"margin-top:.5rem",dir:"auto",text:t("visualL")+": "+j.visual.url+" — "+(j.visual.problems.length?j.visual.problems.slice(0,3).join(" · "):"✓")}):null,
  j.result?el("div",{class:"small",style:"margin-top:.5rem;white-space:pre-wrap",dir:"auto",text:j.result}):null,
  box);
}

// ------------------------------------------------------------------ running goals (agent panel)
function resultLines(r){
 const lines=[];
 for(const x of r.results||[]){
  const d=x.data||{};
  if(x.tool==="terminal.exec"&&d.command){lines.push({c:"cmd",t:"> "+d.command});const out=String(d.stdout||d.stderr||"").trim().split("\n").slice(0,8).join("\n");if(out)lines.push({c:"",t:out});lines.push({c:d.exitCode===0?"ok":"bad",t:(d.exitCode===0?"✓ ":"✗ ")+"exit "+d.exitCode});S.term.unshift({cmd:d.command,out:String(d.stdout||"")+(d.stderr?"\n"+d.stderr:""),state:d.exitCode===0?"ok":"bad",exit:d.exitCode,at:Date.now()});saveTerm();continue;}
  lines.push(x.ok?{c:"ok",t:"✓ "+(TOOL_LABEL[x.tool]?t(TOOL_LABEL[x.tool]):x.tool)}:x.approvalId?{c:"wait",t:"… "+(TOOL_LABEL[x.tool]?t(TOOL_LABEL[x.tool]):x.tool)+" · "+t("st_wait")}:{c:"bad",t:"✗ "+(x.tool||"")+" · "+reasonText(x.error)});
 }
 return lines;
}
// Route pure greetings through the existing conversational assistant. Never create missions for small talk.
// Mixed requests (e.g. "مرحبا افتح المتصفح") still use the normal permission-gated agent path.
function greetingOnly(text){
 const normalized=String(text||"").toLowerCase().replace(/[\u064b-\u065f\u0670]/g,"").replace(/[؟!،,.]/g," ").replace(/\s+/g," ").trim();
 return /^(?:(?:يا\s+)?(?:layanx|ليان|جارفيس|jarvis)\s+)?(?:مرحبا(?:\s+كيف\s+(?:الحال|حالك))?|كيف\s+(?:الحال|حالك)|السلام\s+عليكم(?:\s+ورحمه\s+الله(?:\s+وبركاته)?)?|اهلا(?:\s+وسهلا)?|هلا|صباح\s+الخير|مساء\s+الخير|شكرا|hello(?:\s+how\s+are\s+you)?|hi|hey|how\s+are\s+you|good\s+morning|good\s+evening|thank\s+you|thanks)$/i.test(normalized);
}
async function runGoal(goal,model){
 if(!goal.trim())return;
 S.log.push({id:uid(),role:"you",text:goal,at:Date.now()});
 const me={id:uid(),role:"me",text:t("received"),state:"run",steps:[],lines:[],at:Date.now()};S.log.push(me);drawAgent();
 if(greetingOnly(goal)){
  const answer=await safe(api("/v1/assistant/turn",{method:"POST",body:{text:goal,projectId:project(),allowTasks:false}}),{ok:false,error:"assistant_unavailable"});
  me.state=answer.ok&&answer.intent==="answer"?"done":"fail";
  me.text=me.state==="done"?answer.reply:t("notCompleted")+": "+reasonText(answer.error||"assistant_unavailable");
  me.at=Date.now();drawAgent();return;
 }
 const before=new Set(S.missions.map(m=>m.id));let done=false;
 (async()=>{while(!done){await sleep(1200);if(done)break;if(!me.missionId){const ms=await loadMissions();const n=ms.find(m=>!before.has(m.id));if(n)me.missionId=n.id;}if(me.missionId){me.steps=deriveSteps(await missionDetail(me.missionId));drawAgent();}}})();
 const r=await safe(api("/v1/agent/gateway",{method:"POST",body:{goal,projectId:project(),maxSteps:10,model:model||"auto"},allow:[422]}),{ok:false,error:"network"});
 done=true;me.missionId=me.missionId||r.missionId;
 if(me.missionId)me.steps=deriveSteps(await missionDetail(me.missionId));
 me.lines=resultLines(r);
 const via=r.modelRouting&&r.modelRouting.cloud?t("via",{p:{anthropic:"Claude",openai:"GPT",gemini:"Gemini"}[r.modelRouting.provider]||"cloud"}):"";
 if(r.paused){me.state="wait";me.text=t("pausedApproval");const d=S.details.get(r.missionId);const p=d?.mission?.tools?.[r.nextToolIndex];me.approval={id:r.approvalId,missionId:r.missionId,index:r.nextToolIndex,tool:p?.tool,action:p?.action};}
 else if(r.completed){me.state="done";me.text=t("completedVerified")+via;}
 else{me.state="fail";me.text=t("notCompleted")+(r.reason||r.error||r.status?": "+reasonText(r.reason||r.error||r.status):"")+via;}
 me.at=Date.now();drawAgent();refreshDashboard(true);
}
function messageView(m){
 if(m.role==="you")return el("div",{class:"msg you"},el("div",{class:"who",text:initials()}),el("div",{class:"bubble",dir:"auto",text:m.text}));
 const body=el("div",{class:"bubble",dir:"auto"},m.text);
 if(m.steps&&m.steps.length)body.append(el("ul",{class:"checks"},m.steps.map(s=>el("li",{},el("span",{class:"tick "+s.state,text:s.state==="done"?"✓":s.state==="fail"?"!":s.state==="wait"?"…":""}),el("span",{dir:"auto",text:s.label})))));
 if(m.lines&&m.lines.length)body.append(el("div",{class:"term"},m.lines.map(l=>el("div",{class:l.c,text:l.t}))));
 const job=m.job?S.jobs.find(x=>x.id===m.job):null;
 if(job){const d=job.milestones.filter(x=>x.status==="done").length;
  body.append(el("div",{class:"actions"},pill(jobState(job),t("j_"+job.status)+(job.milestones.length?" · "+d+"/"+job.milestones.length:"")),
   JOB_STOPPED.includes(job.status)?el("button",{class:"btn primary small",onclick:()=>resumeJob(job)},icon("play"),t("resumeJob")):null,
   job.status==="completed"||job.preview?el("button",{class:"btn small",onclick:()=>openJobSite(job)},icon("globe"),t("openSite")):null,
   el("button",{class:"btn small",onclick:()=>go("autonomous")},t("logL"))));}
 if(m.approval){const a=m.approval;body.append(el("div",{class:"actions"},
  el("button",{class:"btn warn small",onclick:async e=>{e.target.disabled=true;try{const r=await decideApproval(a,"approve");if(r){me(m,r);}}catch(err){toast(err.message);}}},icon("check"),t("approve")),
  el("button",{class:"btn small",onclick:async()=>{try{await decideApproval(a,"revoke");m.approval=null;m.state="fail";m.text=t("rejected");drawAgent();}catch(err){toast(err.message);}}},t("reject"))));}
 body.append(el("div",{class:"when",text:ago(m.at)}));
 return el("div",{class:"msg me"},el("div",{class:"who",text:"X"}),body);
 function me(msg,r){msg.approval=null;msg.lines=resultLines(r);msg.state=r.completed?"done":r.paused?"wait":"fail";msg.text=r.completed?t("completedVerified"):r.paused?t("pausedApproval"):t("notCompleted")+": "+reasonText(r.reason||r.status);if(r.paused){const d=S.details.get(r.missionId);const p=d?.mission?.tools?.[r.nextToolIndex];msg.approval={id:r.approvalId,missionId:r.missionId,index:r.nextToolIndex,tool:p?.tool,action:p?.action};}if(msg.missionId)missionDetail(msg.missionId).then(d=>{msg.steps=deriveSteps(d);drawAgent();});drawAgent();refreshDashboard(true);}
}
function initials(){const n=(S.setup?.owner?.name||"").trim();return n?n.slice(0,1).toUpperCase():"U";}
function agentCard(big){
 const chat=el("div",{class:"chat",id:"chat",style:big?"max-height:60vh;min-height:24rem":undefined});
 const input=el("input",{id:"agentInput",placeholder:t("askAgent"),dir:"auto"});
 const model=el("select",{id:"agentModel","aria-label":"model"},[["auto","Auto"],["local",LANG==="ar"?"محلي":"Local"],["anthropic","Claude"],["openai","GPT"],["gemini","Gemini"]].map(([v,l])=>el("option",{value:v,text:l})));
 const auto=el("button",{class:"btn small",type:"button","aria-pressed":String(localStorage.getItem("lx.cc.auto")==="1"),title:t("toEndHint"),onclick:()=>{const on=auto.getAttribute("aria-pressed")!=="true";auto.setAttribute("aria-pressed",String(on));auto.classList.toggle("primary",on);localStorage.setItem("lx.cc.auto",on?"1":"0");}},icon("spark"),t("toEnd"));
 if(localStorage.getItem("lx.cc.auto")==="1")auto.classList.add("primary");
 const submit=async()=>{const g=input.value.trim();if(!g)return;input.value="";
  try{if(await noteForRunningJob(g))return;}catch(e){toast(e.message);return;}
  if(auto.getAttribute("aria-pressed")==="true"){try{const j=await startJob(g);S.log.push({id:uid(),role:"you",text:g,at:Date.now()},{id:uid(),role:"me",text:t("jobStarted"),state:"run",at:Date.now(),job:j.id});drawAgent();}catch(e){toast(e.message);}return;}
  runGoal(g,model.value);};
 input.addEventListener("keydown",e=>{if(e.key==="Enter")submit();});
 const active=()=>S.missions.find(m=>["running","planned","verifying"].includes(m.status));
 return el("section",{class:"card"},
  el("div",{class:"agent-title"},(()=>{const s=icon("spark");s.setAttribute("class","i spark");return s;})(),el("div",{},el("b",{text:t("agentTitle")}),el("span",{class:"muted",text:t("agentSub")}))),
  chat,
  el("div",{class:"actions"},
   el("button",{class:"btn stop",onclick:async()=>{const m=active();if(!m){toast(t("noMission"));return;}try{await api("/v1/control-center/missions/"+encodeURIComponent(m.id)+"/cancel",{method:"POST",body:{projectId:project()}});toast(t("stoppedMsg"));refreshDashboard(true);}catch(e){toast(e.message);}}},icon("stop"),t("stop")),
   el("button",{class:"btn",onclick:()=>go("activity")},icon("logs"),t("viewLogs")),
   el("a",{class:"btn",href:vscodeUrl()},icon("file"),t("openFiles")),
   el("button",{class:"btn",onclick:()=>runGoal(t("gitPR"),model.value)},icon("pr"),t("createPR"))),
  el("div",{class:"composer"},input,auto,model,el("button",{class:"send","aria-label":"send",onclick:submit},icon("send"))));
}
function drawAgent(){try{sessionStorage.setItem("lx.cc.log",JSON.stringify(S.log.slice(-20)));}catch{}const c=$("#chat");if(!c)return;c.replaceChildren(...S.log.slice(-12).map(messageView));c.scrollTop=c.scrollHeight;}

// ------------------------------------------------------------------ terminal & quick tools
const ALLOWED=["git status","git diff","git log","npm test","npm run typecheck","npm run build"];
async function quickTool(tool,payload,extra={}){return api("/v1/tools/run",{method:"POST",body:{tool,payload,projectId:project(),...extra},allow:[422]});}
function finishTerm(e,r){const d=r.data||{};e.approval=undefined;if(r.ok){e.out=String(d.stdout||"")+(d.stderr?"\n"+d.stderr:"");e.exit=d.exitCode;e.state=d.exitCode===0||d.exitCode===undefined?"ok":"bad";}else{e.out=reasonText(r.error||"");e.state="bad";}saveTerm();drawTerminal();}
async function terminalRun(cmd){
 const e={cmd,out:"",state:"run",at:Date.now()};S.term.unshift(e);drawTerminal();
 const r=await safe(quickTool("terminal.exec",{command:cmd}),{ok:false,error:"network"});
 if(!r.ok&&r.approvalId){e.state="wait";e.approval={id:r.approvalId,missionId:r.missionId};drawTerminal();return;}
 finishTerm(e,r);
}
async function approveTerm(e){
 try{await api("/v1/approvals/"+encodeURIComponent(e.approval.id)+"/approve?projectId="+encodeURIComponent(project()),{method:"POST",body:{}});
  e.state="run";drawTerminal();
  const r=await quickTool("terminal.exec",{command:e.cmd},{missionId:e.approval.missionId,approvalId:e.approval.id});finishTerm(e,r);loadApprovals().then(drawBell);}
 catch(err){toast(err.message);}
}
function termEntries(n){
 if(!S.term.length)return[el("div",{class:"muted",text:t("termEmpty")})];
 return S.term.slice(0,n).map(e=>el("div",{},el("div",{class:"cmd",text:"> "+e.cmd}),
  e.out?el("div",{text:String(e.out).trim().split("\n").slice(0,n>4?40:6).join("\n")}):null,
  e.state==="run"?el("div",{class:"wait",text:"…"}):e.state==="wait"?el("div",{class:"wait"},"⏸ "+t("st_wait")+"  ",el("button",{class:"btn warn small",onclick:()=>approveTerm(e)},t("approveRun"))):el("div",{class:e.state==="ok"?"ok":"bad",text:e.state==="ok"?"✓ Passed":"✗ Failed"+(e.exit!==undefined?" (exit "+e.exit+")":"")})));
}
function terminalCard(big){
 return el("section",{class:"card"},el("div",{class:"card-head"},el("h3",{},icon("terminal"),t("terminalTitle")," ",el("span",{class:"restricted",text:t("restricted")}))),
  el("div",{class:"term",id:"termBox",style:big?"max-height:55vh":undefined},termEntries(big?20:3)),
  el("div",{class:"chips"},ALLOWED.map(c=>el("button",{class:"chip",text:c,onclick:()=>terminalRun(c)}))));
}
function drawTerminal(){const b=$("#termBox");if(b)b.replaceChildren(...termEntries(current==="terminal"?20:3));}
async function createBranch(){
 const name=prompt(t("branchName"));if(!name||!name.trim())return;
 const r=await safe(quickTool("git.branch",{branch:name.trim()}),{ok:false,error:"network"});
 if(!r.ok&&r.approvalId){toast(t("st_wait"));await loadApprovals();drawBell();return;}
 toast(r.ok?"✓ "+name:reasonText(r.error));
}
function quickCard(){
 return el("section",{class:"card"},el("div",{class:"card-head"},el("h3",{},icon("bolt"),t("quickActions"))),
  el("div",{class:"qa"},
   el("a",{class:"btn",href:vscodeUrl()},icon("code"),t("openVSCode")),
   el("button",{class:"btn",onclick:()=>terminalRun("npm test")},icon("play"),t("runTests")),
   el("button",{class:"btn",onclick:()=>terminalRun("npm run build")},icon("box"),t("buildProject")),
   el("button",{class:"btn",onclick:createBranch},icon("branch"),t("createBranch"))));
}

// ------------------------------------------------------------------ computer
async function screenshotNow(target){
 const r=await safe(quickTool("desktop.screenshot",{}),{ok:false,error:"network"});
 if(r.ok&&r.data&&r.data.base64){const img=el("img",{alt:"screen",src:"data:"+(r.data.mimeType||"image/png")+";base64,"+r.data.base64});target.replaceChildren(img,el("span",{class:"live",text:"✓"}));}
 else toast(reasonText(r.error||"screenshot failed"));
}
function computerCard(big){
 const screen=el("div",{class:"screen",id:"screenBox",style:big?"aspect-ratio:16/9;max-height:70vh":undefined},el("div",{class:"ph",text:t("screenOff")}));
 const live=S.live&&S.live.running;
 return el("section",{class:"card"},el("div",{class:"card-head"},el("h3",{},icon("computer"),t("computerControl")),
   el("button",{class:"link",onclick:async()=>{try{await api("/v1/computer/live/"+(live?"stop":"start"),{method:"POST",body:{}});S.live=await safe(api("/v1/computer/live/status"),S.live);render();}catch(e){toast(e.message);}}},live?t("stopLive"):t("startLive"))),
  screen,
  el("div",{class:"tiles"},
   el("button",{class:"tile",onclick:()=>screenshotNow(screen)},icon("camera"),t("screenshot")),
   el("button",{class:"tile",onclick:()=>go("computer")},icon("mouse"),t("mouse")),
   el("button",{class:"tile",onclick:()=>go("computer")},icon("keyboard"),t("keyboard")),
   el("button",{class:"tile",onclick:()=>{go("agent");setTimeout(()=>{const i=$("#agentInput");if(i){i.value=LANG==="ar"?"افتح تطبيق ":"Open the app ";i.focus();}},60);}},icon("apps"),t("apps"))));
}
async function drawLiveFrame(){
 const box=$("#screenBox");if(!box)return;
 const status=await safe(api("/v1/computer/live/status"),S.live||{});
 if(status&&typeof status.running==="boolean")S.live=status;
 if(!(S.live&&S.live.running)){box.replaceChildren(el("div",{class:"ph",text:t("screenOff")}));return;}
 const f=await safe(api("/v1/computer/live/frame"),{});const fr=f.frame;
 const captureError=typeof status?.lastError==="string"&&status.lastError?status.lastError:null;
 if(fr&&fr.base64){
  const stale=status?.lastFrameAt&&Date.now()-Date.parse(status.lastFrameAt)>5000&&!captureError;
  const warning=captureError?t("screenError",{error:captureError.slice(0,180)}):stale?t("screenStale"):null;
  box.replaceChildren(
   el("img",{alt:"screen",src:"data:"+(fr.mimeType||"image/png")+";base64,"+fr.base64}),
   el("span",{class:"live"+(warning?" error":""),text:warning||("● "+t("live"))})
  );
  return;
 }
 if(captureError)box.replaceChildren(el("div",{class:"ph error",text:t("screenError",{error:captureError.slice(0,300)})}));
 else box.replaceChildren(el("div",{class:"ph",text:t("screenWaiting")}));
}

// ------------------------------------------------------------------ dashboard
async function loadSystem(){const d=await safe(api("/v1/system/load"),null);if(d)S.sys=d;return S.sys;}
function meter(label,pct,detail){
 const cls=pct>=85?"bad":pct>=60?"warn":"";
 return el("div",{class:"meter"},el("div",{class:"meter-head"},el("span",{text:label}),el("b",{dir:"ltr",text:detail})),el("div",{class:"progress "+cls,role:"meter","aria-label":label,"aria-valuenow":String(pct),"aria-valuemin":"0","aria-valuemax":"100"},el("i",{style:"width:"+Math.max(2,Math.min(100,pct))+"%"})));
}
/** How busy this PC is: CPU, RAM, GPU and the models Ollama holds in memory right now. */
function systemCard(){
 const s=S.sys;const gb=b=>(b/1073741824).toFixed(1);
 const headRow=el("div",{class:"card-head"},el("h3",{text:t("sysTitle")}),s?el("span",{class:"small muted",dir:"ltr",text:s.cpu.model.replace(/\((R|TM)\)|CPU|Processor|with Radeon Graphics|\d+-Core/gi,"").replace(/\s+/g," ").trim().slice(0,32)}):null);
 if(!s)return el("section",{class:"card",id:"sysLoad"},headRow,el("div",{class:"empty",text:"…"}));
 const g=s.gpu;
 const models=!s.ollama?t("ollamaOff"):s.models.length?s.models.map(m=>m.name+" ("+gb(m.vramBytes)+" GB "+t("onGpu")+(m.sizeBytes>m.vramBytes+1e8?" + "+gb(m.sizeBytes-m.vramBytes)+" GB RAM":"")+")").join(" · "):t("noModelsLoaded");
 return el("section",{class:"card",id:"sysLoad"},headRow,
  meter(t("cpuL"),s.cpu.percent,s.cpu.percent+"% · "+s.cpu.cores+" "+t("threadsL")),
  meter(t("ramL"),s.memory.percent,gb(s.memory.usedBytes)+" / "+gb(s.memory.totalBytes)+" GB"),
  g?meter(t("gpuL"),g.percent,g.percent+"%"):el("div",{class:"small muted",style:"margin-bottom:.5rem",text:t("gpuL")+": "+t("noGpu")}),
  g?meter(t("vramL"),Math.round(g.memoryUsedMB/Math.max(g.memoryTotalMB,1)*100),(g.memoryUsedMB/1024).toFixed(1)+" / "+(g.memoryTotalMB/1024).toFixed(1)+" GB"):null,
  el("div",{class:"small",dir:"auto"},el("b",{text:t("loadedModels")+": "}),models));
}
async function refreshSystem(){await loadSystem();if(current!=="dashboard")return;const o=document.getElementById("sysLoad");if(o)o.replaceWith(systemCard());}
function kpiCards(){
 // A task is a mission of its own or an autonomous job (the missions a job runs for its milestones count in the job).
 const jobStatus=j=>j.status==="completed"?"completed":j.status==="queued"?"planned":JOB_ACTIVE.includes(j.status)?"running":j.status==="cancelled"?"cancelled":"failed";
 const ms=[...ownMissions(),...S.jobs.map(j=>({status:jobStatus(j),createdAt:j.createdAt}))];const now=Date.now();
 const active=ms.filter(m=>["running","verifying","planned"].includes(m.status));const runningN=active.filter(m=>m.status!=="planned").length;
 const recent=ms.filter(m=>now-Date.parse(m.createdAt||0)<30*864e5);const done=recent.filter(m=>m.status==="completed").length;const finished=recent.filter(m=>["completed","failed","blocked"].includes(m.status)).length;
 const completed=ms.filter(m=>m.status==="completed");const week=completed.filter(m=>now-Date.parse(m.createdAt||0)<7*864e5).length;
 const on=integrationStatus().filter(x=>x[1]==="on");
 const k=(cls,ic,label,value,sub,up)=>el("div",{class:"card kpi"},el("div",{class:"ic "+cls},icon(ic)),el("div",{},el("span",{text:label}),el("b",{text:value}),el("small",{class:up?"up":"",text:sub})));
 return el("div",{class:"kpis",id:"kpis"},
  k("c-blue","bolt",t("activeMissions"),String(active.length),runningN+" "+t("running")+(LANG==="ar"?"، ":", ")+(active.length-runningN)+" "+t("queued")),
  k("c-green","bars",t("successRate"),finished?Math.round(done/finished*100)+"%":"—",t("last30")),
  k("c-green","check",t("tasksCompleted"),String(completed.length),"+"+week+" "+t("thisWeek"),week>0),
  k("c-purple","nodes",t("connectedApps"),String(on.length),on.slice(0,3).map(x=>x[0]).join(LANG==="ar"?"، ":", ")||"—"));
}
function currentMissionCard(){
 const asCard=j=>{const v=jobView(j,false);v.id="curMission";return v;};
 const job=S.jobs.find(j=>JOB_ACTIVE.includes(j.status));
 if(job)return asCard(job);
 const am=ownMissions();let m=am.find(x=>["running","verifying","planned"].includes(x.status)||waitingFor(x.id));
 if(!m){
  // Nothing running: the newest of the last job and the last mission, so a finished website shows with its "open the site" button.
  const last=S.jobs.slice().sort((a,b)=>Date.parse(b.updatedAt||b.createdAt||0)-Date.parse(a.updatedAt||a.createdAt||0))[0];
  if(last&&(!am[0]||Date.parse(last.updatedAt||last.createdAt||0)>=Date.parse(am[0].createdAt||0)))return asCard(last);
  m=am[0];
 }
 if(!m)return el("section",{class:"card",id:"curMission"},el("div",{class:"card-head"},el("h3",{text:t("currentMission")})),el("div",{class:"empty",text:t("noMission")}));
 const steps=deriveSteps(S.details.get(m.id));const done=steps.filter(s=>s.state==="done").length;
 const st=stateOf(m);
 // The agent picks its next step as it goes: while it works, the steps so far are not the whole job (never 100%).
 const open=st==="run"&&steps.length>0&&done===steps.length;
 const pct=open?Math.round(done/(done+1)*100):steps.length?Math.round(done/steps.length*100):(m.status==="completed"?100:0);
 const curIdx=steps.findIndex(s=>s.state==="run"||s.state==="wait");
 return el("section",{class:"card",id:"curMission"},el("div",{class:"card-head"},el("h3",{text:t("currentMission")}),pill(st)),
  el("div",{class:"mission-goal",dir:"auto",text:goalText(m).slice(0,140)}),
  el("div",{class:"small muted",style:"display:flex;justify-content:space-between"},el("span",{text:open?t("stepsSoFar",{a:done}):t("stepsDone",{a:done,b:steps.length||"—"})}),el("span",{text:open?"…":pct+"%"})),
  el("div",{class:"progress"},el("i",{style:"width:"+pct+"%"})),
  el("ul",{class:"steps"},steps.slice(0,8).map((s,i)=>el("li",{class:i===curIdx?"current":""},el("span",{class:"tick "+s.state,text:s.state==="done"?"✓":s.state==="fail"?"!":""}),el("span",{class:"t",dir:"auto",text:s.label}),pill(s.state)))));
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-/i;
const shownActivity=a=>a.action==="mission.create"||a.action==="mission.verify"||a.action==="model.escalate"||(a.resource&&a.resource.includes(".")&&!UUID.test(a.resource)&&!/^mission\./.test(a.action||""));
function activityText(a,goal){
 const tool=a.resource&&TOOL_LABEL[a.resource]?t(TOOL_LABEL[a.resource]):a.resource;
 if(a.action==="mission.create")return{ic:"flag",t:t("act_start")+": "+String(goal||"").slice(0,70)};
 if(a.action==="mission.verify")return{ic:"check",t:t("act_verify")};
 if(a.action==="model.escalate")return{ic:"cloud",t:t("act_cloud")};
 if(a.result==="success")return{ic:"check",t:t("act_done",{t:tool})};
 if(a.result==="pending_approval")return{ic:"shield",t:t("act_wait",{t:tool})};
 if(a.result==="failure"||a.result==="denied")return{ic:"stop",t:t("act_fail",{t:tool})};
 if(a.result==="allowed")return{ic:"play",t:t("act_run",{t:tool})};
 return{ic:"activity",t:a.action};
}
function activitiesCard(){
 const items=[];for(const m of S.missions.slice(0,6)){const d=S.details.get(m.id);for(const a of d?.audit||[])if(shownActivity(a))items.push({...a,goal:goalText(m)});}
 items.sort((x,y)=>Date.parse(y.timestamp||0)-Date.parse(x.timestamp||0));
 return el("section",{class:"card",id:"activities"},el("div",{class:"card-head"},el("h3",{text:t("recentActivities")}),el("button",{class:"link",text:t("viewAll"),onclick:()=>go("activity")})),
  items.length?el("ul",{class:"acts"},items.slice(0,7).map(a=>{const x=activityText(a,a.goal);return el("li",{},icon(x.ic),el("span",{class:"t",dir:"auto",text:x.t}),el("time",{text:ago(a.timestamp)}));})):el("div",{class:"empty",text:t("noActivity")}));
}
function capCards(){
 const s=S.setup;const names=new Set((s?.secrets?.names||[]).map(n=>n.name));const caps=s?.capabilities||{};
 const roles=Object.values(caps).filter(c=>c.enabled).length;const biz=S.biz||{};const adsN=(S.ads?.ads?.adAccounts||[]).length;const oc=(S.oauth?.connections||[]).length;
 const on=integrationStatus().filter(x=>x[1]==="on").length;
 const card=(cls,ic,key,brands,state,view)=>el("div",{class:"cap "+cls,role:"button",tabindex:"0",onclick:()=>go(view),onkeydown:e=>{if(e.key==="Enter")go(view);}},
  el("h4",{},el("span",{class:"ic"},icon(ic)),t(key)),el("p",{text:t(key+"_d")}),brands.length?el("div",{class:"brands"},brands.map(b=>el("span",{text:b}))):null,
  el("ul",{},[1,2,3].map(n=>el("li",{text:t(key+"_"+n)}))),el("div",{class:"state",text:state}));
 return el("div",{class:"caps"},
  card("cap-dev","code","cap_dev",["Git","GitHub","VS Code"],t("projectsN",{n:(s?.workspace?.projects||[]).length}),"projects"),
  card("cap-shop","ecommerce","cap_shop",["Shopify","WooCommerce"],names.has("LAYANX_SHOPIFY_ACCESS_TOKEN")||names.has("LAYANX_WOOCOMMERCE_CONSUMER_KEY")?t("connected")+" · "+((biz.products||[]).length)+" "+t("products"):t("needsSetup"),"ecommerce"),
  card("cap-social","social","cap_social",["Instagram","Facebook","TikTok","YouTube","X","LinkedIn","Pinterest"],oc?t("connected")+" · "+oc:t("needsSetup"),"social"),
  card("cap-ads","ads","cap_ads",["Google Ads","Meta","TikTok"],adsN?t("connected")+" · "+adsN:t("needsSetup"),"ads"),
  card("cap-pc","computer","cap_pc",["Windows"],caps.desktop&&caps.desktop.enabled===false?t("disabled"):t("enabled"),"computer"),
  card("cap-int","integrations","cap_int",["Gmail","Drive","Sheets","WhatsApp","Telegram"],t("servicesN",{n:on}),"integrations"),
  card("cap-team","team","cap_team",[],t("activeRoles",{n:roles}),"team"),
  card("cap-trade","trading","cap_trade",["MetaTrader 5"],!S.trading?"—":S.trading.enabled===false?t("disabled"):S.trading.scalper?.ok&&S.trading.scalper.value.running?t("trScalper")+": "+t("trRunning"):t("trScalper")+": "+t("trStopped"),"trading"));
}
function archStrip(){
 const s=S.setup;const local=s?.ollama?.models?.length||0;const cloud=(s?.cloud?.providers||[]).filter(p=>p.active).length;const pend=S.approvals.filter(isPending).length;
 const ext=integrationStatus().filter(x=>x[1]==="on").map(x=>x[0]).slice(0,5);
 const node=(cls,ic,title,items,n)=>el("div",{class:"node "+cls},el("b",{},icon(ic),title),el("ul",{},items.map(x=>el("li",{text:x}))),n?el("div",{class:"n",text:n}):null);
 const arrow=()=>el("span",{class:"arrow",text:"→"});
 return el("section",{class:"card arch"},el("div",{class:"card-head"},el("h3",{text:t("arch")})),el("div",{class:"flow"},
  node("n1","user",t("a_user"),[t("a_user_1"),t("a_user_2")]),arrow(),
  node("n2","agent",t("a_planner"),[t("a_planner_1"),t("a_planner_2"),t("a_planner_3"),t("a_planner_4")],t("modelsN",{a:local,b:cloud})),arrow(),
  node("n3","tools",t("a_tools"),["Files & Code","Git","Terminal","Computer","E-commerce","Social","Ads","Web & APIs"],t("a_tools_n",{n:S.tools?S.tools.length:"…"})),arrow(),
  node("n4","shield",t("a_sec"),[t("a_sec_1"),t("a_sec_2"),t("a_sec_3"),t("a_sec_4")],t("pendingN",{n:pend})),arrow(),
  node("n5","play",t("a_exec"),[t("a_exec_1"),t("a_exec_2"),t("a_exec_3"),t("a_exec_4")]),arrow(),
  node("n6","db",t("a_mem"),[t("a_mem_1"),t("a_mem_2"),t("a_mem_3"),t("a_mem_4")]),arrow(),
  node("n7","integrations",t("a_ext"),ext.length?ext:["Shopify / WooCommerce","Social APIs","Ads","OpenAI / Ollama","GitHub"],t("servicesN",{n:ext.length})),arrow(),
  node("n8","flag",t("a_res"),[t("a_res_1"),t("a_res_2"),t("a_res_3"),t("a_res_4")])));
}
async function refreshDashboard(light){
 await Promise.all([loadJobs(),loadMissions(),loadApprovals(),light?null:loadSetup(),light?null:safe(api("/v1/computer/live/status"),null).then(x=>{if(x)S.live=x;})]);
 await Promise.all(S.missions.slice(0,5).map(m=>["running","verifying","planned"].includes(m.status)||!S.details.has(m.id)?missionDetail(m.id):null));
 drawBell();
 if(current!=="dashboard")return;
 const swap=(id,node)=>{const o=document.getElementById(id);if(o)o.replaceWith(node);};
 swap("kpis",kpiCards());swap("curMission",currentMissionCard());swap("activities",activitiesCard());
 const sig=S.log.filter(m=>m.job).map(m=>{const j=S.jobs.find(x=>x.id===m.job);return j?j.status+(j.preview||""):"";}).join("|");
 if(sig!==refreshDashboard.sig){refreshDashboard.sig=sig;drawAgent();}
}
async function renderDashboard(v){
 await Promise.all([loadJobs(),loadSetup(),loadMissions(),loadApprovals(),safe(api("/v1/tools"),null).then(x=>{if(x)S.tools=x.tools||[];}),safe(api("/v1/channels/status"),null).then(x=>S.channels=x),safe(api("/v1/oauth/connections"),null).then(x=>S.oauth=x),safe(api("/v1/business"),null).then(x=>S.biz=x?.business||null),safe(api("/v1/ads"),null).then(x=>S.ads=x),safe(api("/v1/computer/live/status"),null).then(x=>S.live=x),safe(api("/v1/trading/overview"),null).then(x=>S.trading=x)]);
 await Promise.all(S.missions.slice(0,5).map(m=>missionDetail(m.id)));
 v.replaceChildren(kpiCards(),
  el("div",{class:"dash"},el("div",{class:"col"},agentCard(false)),el("div",{class:"col"},currentMissionCard(),activitiesCard()),el("div",{class:"col"},systemCard(),computerCard(false),terminalCard(false),quickCard())),
  capCards(),archStrip());
 drawAgent();drawLiveFrame();
 timers.push(setInterval(()=>refreshDashboard(true),4000),setInterval(drawLiveFrame,2000),setInterval(refreshSystem,3000));
 refreshSystem();
}

// ------------------------------------------------------------------ other views
function trustSelect(projectId,level){
 const sel=el("select",{class:"text",style:"width:auto;padding:.25rem .4rem;font-size:.8rem",title:t("trustNote"),"aria-label":t("trustL")},["supervised","trusted","full"].map(x=>el("option",{value:x,text:t("t_"+x).split(":")[0],selected:x===level?true:undefined})));
 sel.addEventListener("change",async()=>{try{await api("/v1/projects/trust",{method:"PUT",body:{projectId,level:sel.value}});toast(t("t_"+sel.value)+" · "+t("trustNote"));await loadSetup(true);}catch(e){toast(e.message);sel.value=level;}});
 return sel;
}
function isolationSelect(projectId,level,docker,restricted){
 const sel=el("select",{class:"text",style:"width:auto;padding:.25rem .4rem;font-size:.8rem","aria-label":t("isolationL"),title:t("isolationL")},[["local","i_local"],["no-scripts","i_noscripts"],["restricted","i_restricted"],["docker","i_docker"]].map(([v,k])=>el("option",{value:v,text:t("isolationL")+": "+t(k),selected:v===level?true:undefined,disabled:(v==="docker"&&!docker)||(v==="restricted"&&!restricted)?true:undefined})));
 sel.addEventListener("change",async()=>{try{await api("/v1/projects/isolation",{method:"PUT",body:{projectId,level:sel.value}});toast(t("isolationL")+": "+sel.options[sel.selectedIndex].text);}catch(e){toast(e.message);sel.value=level;}});
 return sel;
}
async function quickWithApproval(tool,payload){
 let r=await quickTool(tool,payload);
 if(!r.ok&&r.approvalId){
  if(!confirm(t("confirmApprove")+"\n"+tool+" "+JSON.stringify(payload)))return null;
  await api("/v1/approvals/"+encodeURIComponent(r.approvalId)+"/approve?projectId="+encodeURIComponent(project()),{method:"POST",body:{}});
  r=await quickTool(tool,payload,{missionId:r.missionId,approvalId:r.approvalId});
 }
 return r;
}
/** replaceChildren that skips null/undefined/false (replaceChildren would print them as text). */
// ---------- Humanizer (content.humanize): check / clean / improve any text, and the owner's voice ----------
const HZ_PLATFORMS=["instagram","facebook","tiktok","youtube","x","linkedin","snapchat","pinterest","threads","telegram","whatsapp","bluesky","google_business","ads","email","web","app","generic"];
const HZ_LABEL={instagram:"Instagram",facebook:"Facebook",tiktok:"TikTok",youtube:"YouTube",x:"X",linkedin:"LinkedIn",snapchat:"Snapchat",pinterest:"Pinterest",threads:"Threads",telegram:"Telegram",whatsapp:"WhatsApp",bluesky:"Bluesky",google_business:"Google Business",ads:"Ads · إعلانات",email:"E-mail",web:"Website",app:"App",generic:"—"};
const HZ_KINDS=["post","title","meta","cta","script","subject","push","ui","store_title","store_short","store_description"];
function humanizerCard(){
 const remember=k=>{try{return localStorage.getItem("lx.hz."+k)||"";}catch{return"";}},keep=(k,v)=>{try{localStorage.setItem("lx.hz."+k,v);}catch{}};
 const text=el("textarea",{class:"text",rows:"7",dir:"auto",placeholder:t("hzText")});
 const platform=el("select",{class:"text","aria-label":t("hzPlatform")},HZ_PLATFORMS.map(p=>el("option",{value:p,text:HZ_LABEL[p]})));
 const kind=el("select",{class:"text","aria-label":t("hzKind")},HZ_KINDS.map(k=>el("option",{value:k,text:t("k_"+k)})));
 platform.value=remember("platform")||"instagram";kind.value=remember("kind")||"post";
 platform.addEventListener("change",()=>keep("platform",platform.value));kind.addEventListener("change",()=>keep("kind",kind.value));
 const out=el("div",{style:"margin-top:1rem"});
 const buttons=[];
 const run=async mode=>{
  const value=text.value;if(!value.trim()){text.focus();return;}
  buttons.forEach(x=>x.disabled=true);fill(out,el("p",{class:"muted",text:t("hzWorking")}));
  try{const r=await api("/v1/content/humanize",{method:"POST",body:{text:value,platform:platform.value,kind:kind.value,mode}});showHumanized(out,r,text);}
  catch(e){fill(out,el("p",{class:"muted",text:e.message}));}
  finally{buttons.forEach(x=>x.disabled=false);}
 };
 buttons.push(el("button",{class:"btn",text:t("hzCheck"),onclick:()=>run("check")}),el("button",{class:"btn",text:t("hzClean"),onclick:()=>run("clean")}),el("button",{class:"btn primary",text:t("hzRewrite"),onclick:()=>run("rewrite")}));
 return el("section",{class:"card",style:"margin-top:1rem"},el("h3",{text:t("hz")}),el("p",{class:"muted",text:t("hzLead")}),
  el("label",{class:"f",style:"margin-top:.6rem"},t("hzText"),text),
  el("div",{class:"form",style:"margin-top:.6rem;grid-template-columns:1fr 1fr auto"},el("label",{class:"f"},t("hzPlatform"),platform),el("label",{class:"f"},t("hzKind"),kind),el("div",{style:"display:flex;gap:.4rem;flex-wrap:wrap"},buttons)),out);
}
function showHumanized(out,r,input){
 const report=r.after||r.report;if(!report){fill(out);return;}
 const state=v=>v==="pass"?"done":v==="review"||v==="warn"?"wait":"fail";
 const rows=report.checks.map(c=>el("div",{class:"row",title:c.detail},el("div",{class:"t mono",text:c.label}),el("div",{class:"s"},t("cd_"+c.id)+" · ",el("span",{class:"mono",text:c.value})),el("div",{class:"a"},pill(state(c.status),c.status.toUpperCase()))));
 const findings=(report.findings||[]).filter(f=>f.check!=="burstiness"||f.kind!=="even_rhythm").slice(0,14);
 const has=k=>T.en[k]!==undefined;
 const what=f=>f.check==="fingerprint"&&has("fk_"+f.kind)?t("fk_"+f.kind)+(f.count>1?" ×"+f.count:""):f.check==="platform"&&has("pk_"+f.kind)?t("pk_"+f.kind,{n:f.count}):f.check==="voice"&&has("vk_"+f.kind)?t("vk_"+f.kind):f.kind==="same_opening"?t("bk_same_opening",{w:f.text}):f.text+(f.count>1?" ×"+f.count:"");
 const how=f=>f.check==="fingerprint"&&f.fix?t("fx_fp"):f.check!=="slop"&&has("fx_"+f.kind)?t("fx_"+f.kind):f.fix||"";
 const result=r.text!==undefined?el("div",{style:"margin-top:1rem"},el("h3",{text:t("hzResult")}),el("textarea",{class:"text",rows:"7",dir:"auto",readonly:true},r.text),
  el("div",{style:"display:flex;gap:.4rem;margin-top:.5rem"},el("button",{class:"btn small",text:t("hzCopy"),onclick:async()=>{try{await navigator.clipboard.writeText(r.text);toast(t("hzCopied"));}catch{toast(r.text);}}}),el("button",{class:"btn small",text:t("hzUse"),onclick:()=>{input.value=r.text;input.focus();}}))):null;
 const before=r.before&&r.before.humanScore!==report.humanScore?" ("+r.before.humanScore+" → "+report.humanScore+")":"";
 fill(out,
  el("div",{style:"display:flex;gap:.6rem;align-items:center;flex-wrap:wrap"},el("b",{text:t("hzScore")+": "+report.humanScore+"/100"+before}),pill(state(report.verdict),t("hzV_"+report.verdict)),r.note?el("span",{class:"muted small",text:t("hzN_"+r.note.split(":")[0])}):null),
  el("div",{class:"rows",style:"margin-top:.6rem"},rows),
  el("h3",{style:"margin-top:1rem",text:t("hzFindings")}),
  findings.length?el("div",{class:"rows"},findings.map(f=>el("div",{class:"row"},el("div",{class:"t",dir:"auto",text:what(f)}),el("div",{class:"s",dir:"auto",text:how(f)})))):el("p",{class:"muted",text:t("hzNone")}),
  result);
}
async function voiceCard(){
 const v=(await safe(api("/v1/content/voice"),{})).voice||{samples:[],avoid:[],prefer:[]};
 const samples=el("textarea",{class:"text",rows:"5",dir:"auto"},(v.samples||[]).join("\n\n"));
 const dialect=el("input",{class:"text",dir:"auto",value:v.dialect||""}),tone=el("input",{class:"text",dir:"auto",value:v.tone||""});
 const person=el("select",{class:"text"},[["",t("voiceAny")],["i",t("voiceI")],["we",t("voiceWe")]].map(([k,l])=>el("option",{value:k,text:l})));person.value=v.person||"";
 const avoid=el("input",{class:"text",dir:"auto",value:(v.avoid||[]).join("، ")}),prefer=el("input",{class:"text",dir:"auto",value:(v.prefer||[]).join("، ")});
 const list=x=>x.value.split(/[,،\n]/).map(s=>s.trim()).filter(Boolean);
 const save=el("button",{class:"btn primary",text:t("voiceSave"),onclick:async()=>{try{await api("/v1/content/voice",{method:"PUT",body:{samples:samples.value.split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean),dialect:dialect.value,tone:tone.value,person:person.value,avoid:list(avoid),prefer:list(prefer)}});toast(t("voiceSaved"));}catch(e){toast(e.message);}}});
 return el("section",{class:"card",style:"margin-top:1rem"},el("h3",{text:t("voiceL")}),el("p",{class:"muted",text:t("voiceLead")}),
  el("label",{class:"f",style:"margin-top:.6rem"},t("voiceSamples"),samples),
  el("div",{class:"form",style:"margin-top:.6rem;grid-template-columns:1fr 1fr 1fr"},el("label",{class:"f"},t("voiceDialect"),dialect),el("label",{class:"f"},t("voiceTone"),tone),el("label",{class:"f"},t("voicePerson"),person)),
  el("div",{class:"form",style:"margin-top:.6rem;grid-template-columns:1fr 1fr auto"},el("label",{class:"f"},t("voiceAvoid"),avoid),el("label",{class:"f"},t("voicePrefer"),prefer),save));
}
function fill(node,...items){node.replaceChildren(...items.flat(Infinity).filter(x=>x!==null&&x!==undefined&&x!==false));return node;}
function head(title,lead,...right){return el("div",{class:"page-head"},el("div",{},el("h1",{text:title}),lead?el("p",{text:lead}):null),el("div",{style:"display:flex;gap:.5rem;flex-wrap:wrap"},right));}
function goalChips(list){return el("div",{class:"chips"},list.split("|").map(g=>el("button",{class:"chip",style:"font-family:inherit;direction:auto",text:g,onclick:()=>{go("agent");setTimeout(()=>{const i=$("#agentInput");if(i){i.value=g;i.focus();}},60);}})));}
function stats(pairs){return el("div",{class:"stats"},pairs.map(([l,v])=>el("div",{class:"stat"},el("span",{text:l}),el("b",{text:v===undefined||v===null?"—":String(v)}))));}
function missionRow(m){
 const box=el("div",{class:"term",hidden:true});
 return el("div",{},el("div",{class:"row"},el("div",{class:"t",dir:"auto",text:goalText(m)}),el("div",{class:"s"},ago(m.createdAt)+" · ",el("span",{class:"mono",text:m.id.slice(0,8)})),
  el("div",{class:"a"},pill(stateOf(m)),
   el("button",{class:"btn small",text:t("details"),onclick:async()=>{box.hidden=!box.hidden;if(!box.hidden){const d=await missionDetail(m.id);box.replaceChildren(...deriveSteps(d).map(s=>el("div",{class:s.state==="done"?"ok":s.state==="fail"?"bad":s.state==="wait"?"wait":"",text:(s.state==="done"?"✓ ":s.state==="fail"?"✗ ":s.state==="wait"?"… ":"· ")+s.label})),...(d?.audit||[]).slice(-10).map(a=>el("div",{class:"muted",text:(a.timestamp||"").slice(11,19)+"  "+a.action+"  "+a.result})));}}}),
   ["running","verifying","planned"].includes(m.status)?el("button",{class:"btn small",text:t("cancel"),onclick:async()=>{try{await api("/v1/control-center/missions/"+encodeURIComponent(m.id)+"/cancel",{method:"POST",body:{projectId:project()}});render();}catch(e){toast(e.message);}}}):null,
   el("button",{class:"btn small danger",text:t("deleteL"),title:t("deleteMissionQ"),onclick:async()=>{if(!confirm(t("deleteMissionQ")))return;try{await api("/v1/control-center/missions/"+encodeURIComponent(m.id)+"/delete",{method:"POST",body:{projectId:project()}});S.details.delete(m.id);toast(t("deletedT"));render();}catch(e){toast(e.message);}}}))),box);
}
function approvalRow(a,after){
 return el("div",{class:"row"},el("div",{class:"t"},(TOOL_LABEL[a.tool]?t(TOOL_LABEL[a.tool]):a.tool||a.action),a.permission==="L4_EXECUTE"?el("span",{class:"status s-fail",style:"margin-inline-start:.5rem",text:"L4"}):null),
  el("div",{class:"s",dir:"auto",text:(a.reason||a.action||"")}),
  el("div",{class:"a"},a.approved?pill("done",t("approved")):[el("button",{class:"btn warn small",onclick:async e=>{e.target.disabled=true;try{await decideApproval(a,"approve");}catch(err){toast(err.message);}after&&after();}},t("approve")),el("button",{class:"btn small",onclick:async()=>{try{await decideApproval(a,"revoke");}catch(err){toast(err.message);}after&&after();}},t("reject"))]));
}
// ------------------------------------------------------------------ trading (MetaTrader 5 through LayanX's MT5 tools; src/trading/control.ts)
const trPref=(k,d)=>{try{return localStorage.getItem("lx.trading."+k)??d;}catch{return d;}};
const trSetPref=(k,v)=>{try{localStorage.setItem("lx.trading."+k,v);}catch{}};
// Prices and amounts in Western digits on both languages, as MetaTrader shows them.
// Kept left-to-right inside Arabic text, so "-12.5" and "4 / 20" do not turn around.
const trLtr=x=>"\u2066"+x+"\u2069";
const trNum=(n,digits=2)=>typeof n==="number"&&isFinite(n)?trLtr(n.toLocaleString("en-US",{maximumFractionDigits:digits})):"—";
const trSigned=n=>typeof n==="number"&&isFinite(n)?el("span",{class:n>0?"tr-pos":n<0?"tr-neg":"",dir:"ltr",text:(n>0?"+":"")+trNum(n)}):"—";
const trMode=m=>m==="real"?t("trReal"):m==="contest"?t("trContest"):m==="demo"?t("trDemo"):"—";
async function trOverview(connect){
 const q=new URLSearchParams({connect:connect?"1":"0",days:trPref("days","7")});const sym=trPref("symbol","");if(sym)q.set("symbol",sym);
 return api("/v1/trading/overview?"+q.toString());
}
/** A trading action: the first request asks for approval, the owner confirms here, then it runs (like any trading tool). */
async function trAct(path,body,question){
 let r=await api(path,{method:"POST",body:{projectId:project(),...body},allow:[422]});
 if(!r.ok&&r.approvalId){
  if(!confirm(question))return null;
  await api("/v1/approvals/"+encodeURIComponent(r.approvalId)+"/approve?projectId="+encodeURIComponent(project()),{method:"POST",body:{}});
  r=await api(path,{method:"POST",body:{projectId:project(),...body,missionId:r.missionId,approvalId:r.approvalId},allow:[422]});
 }
 if(r&&r.ok===false)toast(reasonText(r.error||""));
 return r;
}
function trLine(closes){
 if(!closes||closes.length<2)return el("div",{class:"empty",text:"—"});
 const min=Math.min(...closes),max=Math.max(...closes),w=300,h=70,span=max-min||1;
 const d=closes.map((c,i)=>(i?"L":"M")+(i/(closes.length-1)*w).toFixed(1)+" "+(h-4-(c-min)/span*(h-8)).toFixed(1)).join(" ");
 const s=document.createElementNS("http://www.w3.org/2000/svg","svg");s.setAttribute("viewBox","0 0 "+w+" "+h);s.setAttribute("preserveAspectRatio","none");s.setAttribute("class","tr-line");s.setAttribute("role","img");
 s.setAttribute("aria-label",t("trLast24")+": "+trNum(closes[0])+" → "+trNum(closes[closes.length-1]));
 const p=document.createElementNS("http://www.w3.org/2000/svg","path");p.setAttribute("d",d);p.setAttribute("class",closes[closes.length-1]>=closes[0]?"up":"down");s.appendChild(p);return s;
}
function trTable(head,rows){return el("div",{class:"tr-wrap"},el("table",{class:"tr-tbl"},el("thead",{},el("tr",{},head.map(h=>el("th",{text:h})))),el("tbody",{},rows)));}
function trAccountSection(d){
 const a=d.account?.ok?d.account.value:null;
 if(!a)return el("div",{id:"trAccount"});
 const mode=a.tradeMode,real=mode==="real";
 const banners=[];
 if(real)banners.push(el("div",{class:"tr-banner "+(d.settings.allowReal?"bad":"warn"),text:d.settings.allowReal?t("trRealAllowed"):t("trRealBlocked")}));
 if(a.tradeAllowed===false)banners.push(el("div",{class:"tr-banner warn",text:t("trAlgoOffWarn")}));
 return el("div",{id:"trAccount"},banners,
  stats([[t("trAccountType"),trMode(mode)],[t("trBalance"),trLtr(trNum(a.balance)+(a.currency?" "+a.currency:""))],[t("trEquity"),trLtr(trNum(a.equity)+(a.currency?" "+a.currency:""))],
   [t("trFloating"),trNum((a.equity??0)-(a.balance??0))],[t("trLeverage"),a.leverage?trLtr("1:"+a.leverage):"—"],[t("trAlgo"),a.tradeAllowed===false?t("trOffW"):t("trOnW")],[t("trServer"),a.server||"—"]]));
}
function trScalperSection(d,reload){
 const s=d.scalper?.ok?d.scalper.value:null,set=d.settings;const acct=d.account?.ok?trMode(d.account.value.tradeMode):"—";
 const running=!!s?.running;
 const act=async start=>{const r=await trAct("/v1/trading/scalper/"+(start?"start":"stop"),{},start?t("trStartQ").replace("{sym}",s?.symbol||"XAUUSD").replace("{acct}",acct):t("trStopQ"));if(r&&r.ok)await reload();};
 return el("section",{class:"card",id:"trScalper"},
  el("div",{class:"card-head"},el("h3",{text:t("trScalper")+(s?.symbol?" · "+s.symbol+" "+(s.timeframe||""):"")}),pill(running?"run":"pend",running?t("trRunning"):t("trStopped"))),
  !set.liveTrading?el("div",{class:"tr-banner warn",text:t("trLiveOff")}):null,
  !set.autoScalping?el("div",{class:"tr-banner warn",text:t("trAutoOff")}):null,
  s?stats([[t("trTradesToday"),trLtr((s.tradesToday??0)+" / "+set.maxTradesPerDay)],[t("trDailyPnl"),trNum(s.dailyPnl)],[t("trLosses"),trLtr((s.consecutiveLosses??0)+" / "+set.maxConsecutiveLosses)]]):el("p",{class:"muted",dir:"auto",text:d.scalper?.error||"—"}),
  el("p",{class:"small muted",style:"margin:.6rem 0 0",text:t("trLimits").replace("{l}",trNum(set.maxDailyLossPct)).replace("{t}",set.maxTradesPerDay).replace("{c}",set.maxConsecutiveLosses)}),
  s?.lastAction?el("p",{class:"small",dir:"auto",style:"margin:.4rem 0 0"},el("b",{text:t("trLastAction")+": "}),s.lastAction):null,
  s?.lastError?el("p",{class:"small tr-neg",dir:"auto",style:"margin:.3rem 0 0"},el("b",{text:t("trLastError")+": "}),s.lastError):null,
  el("div",{style:"display:flex;gap:.5rem;margin-top:.8rem"},
   running?el("button",{class:"btn warn",onclick:()=>act(false)},icon("stop"),t("trStop")):el("button",{class:"btn primary",disabled:!set.autoScalping||undefined,onclick:()=>act(true)},icon("play"),t("trStart"))));
}
function trQuoteSection(d,reload){
 const q=d.quote?.ok?d.quote.value:null;const sym=el("input",{class:"text",dir:"ltr",value:d.symbol||trPref("symbol","XAUUSD"),style:"max-width:9rem"});
 const show=async()=>{const v=sym.value.trim().toUpperCase();if(!/^[A-Z0-9._#-]{1,24}$/.test(v))return;trSetPref("symbol",v);await reload();};
 sym.addEventListener("keydown",e=>{if(e.key==="Enter")show();});
 return el("section",{class:"card",id:"trQuote"},el("div",{class:"card-head"},el("h3",{text:t("trQuote")}),el("div",{style:"display:flex;gap:.4rem;align-items:center"},sym,el("button",{class:"btn small",onclick:show,text:t("trShow")}))),
  q?stats([[t("trBid"),trNum(q.bid,5)],[t("trAsk"),trNum(q.ask,5)],[t("trSpread"),trNum(q.spread,5)]]):el("p",{class:"muted",dir:"auto",text:d.quote?.error||"—"}),
  el("div",{class:"small muted",style:"margin:.7rem 0 .3rem",text:t("trLast24")}),d.series?.ok?trLine(d.series.value.closes):el("p",{class:"muted",dir:"auto",text:d.series?.error||"—"}));
}
function trPositionsSection(d){
 const p=d.positions?.ok?d.positions.value.positions||[]:null;const magic=d.settings.magic;
 return el("section",{class:"card",id:"trPositions",style:"margin-top:1rem"},el("h3",{text:t("trPositions")+(p?" ("+p.length+")":"")}),
  !p?el("p",{class:"muted",dir:"auto",text:d.positions?.error||"—"}):!p.length?el("div",{class:"empty",text:t("trNoPositions")}):
  trTable([t("trSymbol"),t("trSide"),t("trVolume"),t("trOpenPrice"),t("trSlTp"),t("trProfit"),t("trBy")],p.map(x=>el("tr",{},el("td",{class:"mono",text:x.symbol}),el("td",{text:x.side==="buy"?t("trBuy"):t("trSell")}),
   el("td",{class:"num",text:trNum(x.quantity)}),el("td",{class:"num",text:trNum(x.price,5)}),el("td",{class:"num",text:(x.stopLoss?trNum(x.stopLoss,5):"—")+" / "+(x.takeProfit?trNum(x.takeProfit,5):"—")}),
   el("td",{class:"num"},trSigned(x.profit)),el("td",{text:x.magic===magic?t("trByLayanX"):t("trByYou")})))));
}
function trHistorySection(d,reload){
 const h=d.history?.ok?d.history.value:null;
 const days=el("select",{class:"text",style:"max-width:9rem"},["1","7","30","90"].map(n=>el("option",{value:n,selected:n===String(d.days||trPref("days","7"))||undefined,text:t("trDaysN").replace("{n}",n)})));
 days.addEventListener("change",async()=>{trSetPref("days",days.value);await reload();});
 return el("section",{class:"card",id:"trHistory",style:"margin-top:1rem"},el("div",{class:"card-head"},el("h3",{text:t("trHistory")}),days),
  !h?el("p",{class:"muted",dir:"auto",text:d.history?.error||"—"}):el("div",{},
   stats([[t("trTradesN"),h.count],[t("trNet"),trNum(h.net)],[t("trWins"),h.wins],[t("trLossesN"),h.losses]]),
   (h.deals||[]).length?el("div",{style:"margin-top:.8rem"},trTable([t("trClosedAt"),t("trSymbol"),t("trVolume"),t("trProfit"),t("trBy")],h.deals.map(x=>el("tr",{},el("td",{class:"mono",text:String(x.closedAt||"").replace("T"," ").slice(0,16)}),
    el("td",{class:"mono",text:x.symbol}),el("td",{class:"num",text:trNum(x.quantity)}),el("td",{class:"num"},trSigned((x.profit||0)+(x.commission||0)+(x.swap||0))),el("td",{text:x.magic===d.settings.magic?t("trByLayanX"):t("trByYou")}))))):el("div",{class:"empty",text:t("trNoDeals")})));
}
function trRunsList(runs){
 return el("div",{id:"trRuns",style:"margin-top:.8rem"},runs.length?runs.map(r=>{const m=r.result?.metrics||{};
  return el("div",{class:"row"},el("div",{class:"t",dir:"ltr",text:(r.payload?.expert||"")+" · "+(r.payload?.symbol||"")+" · "+(r.payload?.period||"H1")+" · "+(r.payload?.from||"")+" → "+(r.payload?.to||"")}),
   el("div",{class:"s",dir:"auto"},r.status==="done"?[t("trNetProfit")+": "+trNum(m.netProfit)+(m.profitPct!=null?" ("+trNum(m.profitPct)+"%)":""),"PF "+trNum(m.profitFactor),t("trDD")+": "+trNum(m.drawdownMaxPct)+"%",t("trTradesN")+": "+trNum(m.totalTrades,0),
    t("trPosMonths")+": "+(m.pctPositiveMonths!=null?trNum(m.pctPositiveMonths)+"%":"—"),t("trAllYears")+": "+(m.allYearsPositive==null?"—":m.allYearsPositive?t("trYes"):t("trNo"))].join(" · "):r.status==="failed"?String(r.error||""):ago(r.startedAt)),
   el("div",{class:"a"},pill(r.status==="done"?"done":r.status==="failed"?"fail":"run",r.status==="done"?t("trTestDone"):r.status==="failed"?t("trTestFailed"):t("trTesting"))));}):el("div",{class:"empty",text:t("trNoRuns")}));
}
function trTesterSection(runs){
 const today=new Date(),ago1=new Date(today.getFullYear()-1,today.getMonth(),today.getDate());const iso=x=>x.toISOString().slice(0,10);
 const f={expert:el("input",{class:"text",dir:"ltr",placeholder:"MyRobot",value:trPref("expert","")}),symbol:el("input",{class:"text",dir:"ltr",value:trPref("symbol","XAUUSD")}),
  period:el("select",{class:"text"},["M1","M5","M15","M30","H1","H4","D1","W1"].map(p=>el("option",{value:p,selected:p==="H1"||undefined,text:p}))),
  from:el("input",{class:"text",type:"date",value:iso(ago1)}),to:el("input",{class:"text",type:"date",value:iso(today)}),
  model:el("select",{class:"text"},[["ohlc_m1","OHLC M1"],["every_tick","Every tick"],["open_prices","Open prices"],["real_ticks","Real ticks"]].map(([v,l])=>el("option",{value:v,text:l}))),
  deposit:el("input",{class:"text",type:"number",min:"100",value:"10000",dir:"ltr"})};
 const run=async()=>{const p={expert:f.expert.value.trim(),symbol:f.symbol.value.trim().toUpperCase(),period:f.period.value,from:f.from.value,to:f.to.value,model:f.model.value,deposit:Number(f.deposit.value)||10000};
  if(!p.expert||!p.symbol){toast(t("trNeedExpert"));return;}trSetPref("expert",p.expert);
  const r=await trAct("/v1/trading/tester",{payload:p},t("trRunQ").replace("{e}",p.expert).replace("{s}",p.symbol));
  if(r&&r.started){toast(t("trStarted"));const l=await safe(api("/v1/trading/tester"),null);if(l)document.getElementById("trRuns")?.replaceWith(trRunsList(l.runs||[]));}};
 return el("section",{class:"card",style:"margin-top:1rem"},el("h3",{text:t("trTester")}),el("p",{class:"small muted",text:t("trTesterHint")}),
  el("div",{class:"tr-form"},el("label",{class:"f"},t("trExpert"),f.expert),el("label",{class:"f"},t("trSymbol"),f.symbol),el("label",{class:"f"},t("trPeriod"),f.period),el("label",{class:"f"},t("trFrom"),f.from),
   el("label",{class:"f"},t("trTo"),f.to),el("label",{class:"f"},t("trModel"),f.model),el("label",{class:"f"},t("trDeposit"),f.deposit),el("button",{class:"btn primary",onclick:run},icon("play"),t("trRun"))),
  trRunsList(runs));
}

const VIEWS={
 dashboard:renderDashboard,
 async learning(v){
  const d=await api("/v1/learning?projectId="+encodeURIComponent(project()));
  const act=async(p,a)=>{try{const r=await api("/v1/learning/playbooks/"+encodeURIComponent(p.id)+"/"+a+"?projectId="+encodeURIComponent(project()),{method:"POST",body:{}});if(a==="export"&&r.dir)toast(t("exportedL")+" "+r.dir);render();}catch(e){toast(e.message);}};
  const stState={active:"done",candidate:"wait",disabled:"pend",rejected:"fail"};
  const row=p=>{const body=el("div",{class:"term",hidden:true,style:"max-height:16rem;direction:ltr;text-align:left",text:p.body});
   return el("div",{},el("div",{class:"row"},el("div",{class:"t",dir:"auto",text:p.title}),el("div",{class:"s",text:t("src_"+p.source)+" · "+t("usesL")+" "+p.uses+(p.uses?" · "+t("successL")+" "+Math.round(p.success/p.uses*100)+"%":"")+(p.note?" · "+p.note:"")}),
    el("div",{class:"a"},pill(stState[p.status]||"pend",t("st_"+p.status)),el("button",{class:"btn small",text:t("showL"),onclick:()=>{body.hidden=!body.hidden;}}),
     p.status==="candidate"?[el("button",{class:"btn primary small",text:t("approveL"),onclick:()=>act(p,"approve")}),el("button",{class:"btn small",text:t("rejectL"),onclick:()=>act(p,"reject")})]:
     p.status==="active"?[el("button",{class:"btn small",text:t("disableL"),onclick:()=>act(p,"disable")}),p.source!=="builtin"?el("button",{class:"btn small",text:t("exportL"),title:"SKILL.md",onclick:()=>act(p,"export")}):null]:p.status==="disabled"?el("button",{class:"btn small",text:t("enableL"),onclick:()=>act(p,"enable")}):null)),body);};
  const cands=d.playbooks.filter(p=>p.status==="candidate");
  let q="";const lessonsBox=el("div",{class:"rows"});
  const drawLessons=()=>{const list=d.lessons.filter(l=>!q||(l.text+" "+l.trigger).toLowerCase().includes(q));lessonsBox.replaceChildren(...(list.length?list.slice(0,80).map(l=>el("div",{class:"row"},el("div",{class:"t",dir:"auto",text:l.text}),el("div",{class:"s",text:(l.kind==="fix"?t("fixL"):t("pitfallL"))+" · "+l.projectId+" · "+l.stack+" · "+ago(l.at)+(l.uses?" · "+t("usesL")+" "+l.uses:"")}),
   el("div",{class:"a"},el("button",{class:"btn small",text:"✕",title:"delete",onclick:async()=>{await api("/v1/learning/lessons/"+encodeURIComponent(l.id),{method:"DELETE"});render();}})))):[el("div",{class:"empty",text:t("noLessons")})]));};
  fill(v,head(t("learning"),t("learningLead")),
   cands.length?el("section",{class:"card",style:"margin-bottom:1rem;border-color:var(--amber)"},el("h3",{text:t("candidatesL")+" ("+cands.length+")"}),el("div",{class:"rows",style:"margin-top:.4rem"},cands.map(row))):null,
   el("div",{class:"grid2"},el("section",{class:"card"},el("h3",{text:t("playbooksL")+" ("+d.playbooks.length+")"}),el("div",{class:"rows",style:"margin-top:.4rem"},d.playbooks.filter(p=>p.status!=="candidate").map(row))),
    el("section",{class:"card"},el("h3",{text:t("lessonsL")+" ("+d.lessons.length+")"}),el("input",{class:"text",placeholder:t("search"),style:"margin:.5rem 0",oninput:e=>{q=e.target.value.trim().toLowerCase();drawLessons();}}),lessonsBox)));
  drawLessons();
 },
 async project(v){
  const id=project();
  const d=await api("/v1/projects/"+encodeURIComponent(id)+"/overview");
  await loadSetup();
  const base="/v1/projects/"+encodeURIComponent(id);
  const sev={critical:"s-fail",high:"s-fail",medium:"s-wait",low:"s-pend",info:"s-pend"};
  const out=el("div",{});
  const healthCard=(name,label)=>{const h=d.health[name];return el("div",{class:"stat"},el("span",{text:label}),el("b",{},h?pill(h.ok?"done":"fail",name==="security"&&h.score!==undefined?h.score+"/100":h.ok?"✓":"✗"):"—"),h?el("span",{class:"small",text:ago(h.at)}):null);};
  const startFix=async(text)=>{try{await startJob(t("fixPrefix")+text);go("autonomous");}catch(e){toast(e.message);}};
  const issueIn=el("input",{class:"text",placeholder:t("issueTitle"),dir:"auto"});
  const issues=el("section",{class:"card"},el("h3",{text:t("issuesL")}),el("div",{class:"rows",style:"margin-top:.4rem"},d.knowledge.issues.open.length?d.knowledge.issues.open.map(i=>el("div",{class:"row"},el("div",{class:"t",dir:"auto",text:i.split(" — ")[0]}),el("div",{class:"s",dir:"auto",text:i.split(" — ").slice(1).join(" — ")}),
    el("div",{class:"a"},el("button",{class:"btn primary small",text:t("fixIt"),onclick:()=>startFix(i)}),el("button",{class:"btn small",text:t("resolved"),onclick:async()=>{await api(base+"/issues",{method:"POST",body:{resolve:i.replace(/ \(\d{4}-\d\d-\d\d\)$/,"").split(" — ")[0]}});render();}})))):el("div",{class:"empty",text:t("noIssues")})),
   el("div",{class:"composer",style:"margin-top:.6rem"},issueIn,el("button",{class:"btn small",text:t("addIssue"),onclick:async()=>{const v2=issueIn.value.trim();if(v2.length<3)return;await api(base+"/issues",{method:"POST",body:{title:v2}});render();}})));
  const list=(items,empty)=>items.length?el("ul",{class:"acts"},items.map(x=>el("li",{},el("span",{class:"t",dir:"auto",text:x.title}),x.body?el("time",{text:""}):null))):el("div",{class:"empty",text:empty});
  const sec=d.security;
  const security=el("section",{class:"card"},el("div",{class:"card-head"},el("h3",{text:t("securityL")}),sec?pill(sec.blocked?"fail":"done",t("scoreL")+" "+sec.score+"/100"):null),
   sec?el("div",{},stats(Object.entries(sec.counts||{}).filter(([k])=>k!=="info").map(([k,n])=>[k,n])),el("div",{class:"rows",style:"margin-top:.6rem"},(sec.findings||[]).slice(0,12).map(f=>el("div",{class:"row"},el("div",{class:"t",text:f.message}),el("div",{class:"s mono",text:(f.file?f.file+(f.line?":"+f.line:""):"")+" — "+f.fix}),el("div",{class:"a"},el("span",{class:"status "+(sev[f.severity]||"s-pend"),text:f.severity}),f.severity==="critical"||f.severity==="high"?el("button",{class:"btn small",text:t("fixIt"),onclick:()=>startFix(f.message+(f.file?" ("+f.file+":"+(f.line||"")+")":"")+". "+f.fix)}):null))))):el("div",{class:"empty",text:t("notScanned")}));
  const ix=d.knowledge.index;
  const arch=el("section",{class:"card"},el("div",{class:"card-head"},el("h3",{text:t("architectureL")}),el("button",{class:"link",text:t("refreshMap"),onclick:async()=>{await api(base+"/knowledge",{method:"POST",body:{}});render();}})),
   ix?el("div",{},el("p",{class:"small muted",text:ix.stack+" · "+ix.files.count+" "+t("filesL")+" · "+ix.files.lines+" "+t("linesL")+(ix.entryPoints.length?" · "+t("entryL")+": "+ix.entryPoints.slice(0,4).join(", "):"")}),
    el("div",{class:"rows"},ix.dirs.slice(0,8).map(x=>el("div",{class:"row"},el("div",{class:"t mono",text:x.path}),el("div",{class:"a"},el("span",{class:"small muted",text:x.files+" · "+x.lines}))))),
    ix.duplicates.length?el("p",{class:"small",style:"color:var(--amber)",text:t("duplicatesL")+": "+ix.duplicates.slice(0,5).map(x=>x.name).join(", ")}):null):el("div",{class:"empty",text:"—"}));
  const shots=[...d.screens.last.map(f=>[f,"screens"]),...d.screens.baselines.map(f=>[f,"baselines"])].slice(0,8);
  const screens=el("section",{class:"card"},el("h3",{text:t("screensL")}),shots.length?el("div",{class:"grid3",style:"margin-top:.6rem;grid-template-columns:repeat(auto-fill,minmax(10rem,1fr))"},shots.map(([f,set])=>el("a",{href:base+"/screens/"+encodeURIComponent(f)+"?set="+set,target:"_blank"},el("img",{src:base+"/screens/"+encodeURIComponent(f)+"?set="+set,alt:f,style:"width:100%;border-radius:.4rem;border:1px solid var(--line)"}),el("div",{class:"small muted mono",text:f})))):el("div",{class:"empty",text:"—"}));
  const branches=el("section",{class:"card"},el("h3",{text:t("branchesL")}),(d.branches||[]).length?el("div",{class:"rows",style:"margin-top:.4rem"},d.branches.map(b=>el("div",{class:"row"},el("div",{class:"t mono",text:b.branch}),el("div",{class:"s",dir:"auto",text:b.ahead+" "+t("aheadL")+" · "+b.last}),
    el("div",{class:"a"},el("button",{class:"btn primary small",text:t("mergeL"),onclick:async()=>{try{const r=await quickWithApproval("git.merge",{branch:b.branch});if(r){toast(r.ok&&r.data&&r.data.merged?"✓ "+r.data.into+" "+r.data.commit:(r.data&&r.data.message)||reasonText(r.error));render();}}catch(e){toast(e.message);}}}),
     el("button",{class:"btn small",text:t("prL"),onclick:async()=>{try{const r=await quickWithApproval("git.publish_pr",{branch:b.branch});if(r){const u=r.data&&(r.data.pr&&r.data.pr.url||r.data.url);if(u)window.open(u,"_blank","noopener");toast(r.ok?(r.data.message||"✓"):reasonText(r.error));}}catch(e){toast(e.message);}}}))))):el("div",{class:"empty",text:t("noBranches")}));
  const gitCard=el("section",{class:"card"},el("div",{class:"card-head"},el("h3",{text:t("gitL")}),d.git.branch?el("span",{class:"status s-pend mono",text:d.git.branch}):null),d.git.commits.length?el("div",{class:"term",style:"max-height:10rem"},d.git.commits.map(c=>el("div",{text:c}))):el("div",{class:"empty",text:"—"}));
  const jobs=el("section",{class:"card"},el("h3",{text:t("recentJobs")}),d.jobs.length?el("ul",{class:"acts"},d.jobs.map(j=>el("li",{},el("span",{class:"t",dir:"auto",text:j.goal.split("\n")[0]}),pill(jobState(j),t("j_"+j.status)),el("time",{text:ago(j.createdAt)})))):el("div",{class:"empty",text:t("noJobs")}));
  const review=async()=>{out.replaceChildren(el("div",{class:"empty",text:t("loading")}));const r=await api(base+"/review",{method:"POST",body:{}});const fs=[...((r.code&&r.code.findings)||[]),...((r.security&&r.security.findings)||[])];
   out.replaceChildren(el("section",{class:"card",style:"margin-bottom:1rem"},el("div",{class:"card-head"},el("h3",{text:t("reviewResult")+" ("+r.baseRef+")"}),r.code&&!r.code.error?pill(r.code.approved&&r.security&&r.security.approved!==false?"done":"wait",r.code.approved?t("approvedL"):t("notApprovedL")):null),
    r.code&&r.code.error?el("p",{class:"muted",text:r.code.error}):null,el("div",{class:"rows"},fs.slice(0,20).map(f=>el("div",{class:"row"},el("div",{class:"t",text:f.message}),el("div",{class:"s mono",text:f.path||""}),el("div",{class:"a"},el("span",{class:"status "+(sev[f.severity]||"s-pend"),text:f.severity})))))));};
  fill(v,head(t("project")+": "+id,d.exists?d.dir:t("noProjectYet"),
    trustSelect(id,d.trust||"supervised"),isolationSelect(id,d.isolation||"local",Boolean(S.setup?.workspace?.docker),Boolean(S.setup?.workspace?.restricted)),
    el("a",{class:"btn",href:vscodeUrl()},icon("code"),t("openVSCode")),
    el("button",{class:"btn",onclick:async e=>{e.target.disabled=true;try{await api(base+"/scan",{method:"POST",body:{}});render();}catch(err){toast(err.message);e.target.disabled=false;}}},icon("shield"),t("scanNow")),
    el("button",{class:"btn",onclick:()=>review().catch(e=>toast(e.message))},icon("pr"),t("reviewNow")),
    el("button",{class:"btn primary",onclick:()=>go("autonomous")},icon("spark"),t("autonomous"))),
   el("section",{class:"card",style:"margin-bottom:1rem"},el("h3",{text:t("healthL")}),el("div",{class:"stats",style:"margin-top:.6rem"},healthCard("test","test"),healthCard("build","build"),healthCard("typecheck","typecheck"),healthCard("lint","lint"),healthCard("security",t("securityL")),healthCard("visual",t("visualL")))),
   out,
   el("div",{class:"grid2"},el("div",{class:"col"},issues,security,el("section",{class:"card"},el("h3",{text:t("decisionsL")}),list(d.knowledge.decisions,t("noDecisions"))),el("section",{class:"card"},el("h3",{text:t("changelogL")}),list(d.knowledge.changelog,t("noChanges")))),
    el("div",{class:"col"},branches,arch,screens,gitCard,jobs)));
 },
 async autonomous(v){
  await loadJobs();
  const goal=el("textarea",{class:"text",rows:"3",dir:"auto",placeholder:LANG==="ar"?"مثال: أضف صفحة منتجات للمتجر مع البحث والفلترة، واكتب اختباراتها، وتأكد أنها تعمل على الهاتف":"e.g. Add a products page with search and filters, write its tests and make sure it works on mobile"});
  const minutes=el("input",{class:"text",type:"number",min:"5",max:"1440",value:"120",dir:"ltr"});
  const openBox=el("input",{type:"checkbox",checked:openWhenDonePref()||undefined,onchange:e=>{try{localStorage.setItem("lx.job.open",e.target.checked?"1":"0");}catch{}}});
  const verifyBox=el("input",{type:"checkbox",checked:false});
  const list=el("div",{});
  const draw=()=>list.replaceChildren(...(S.jobs.length?S.jobs.map(j=>jobView(j,false)):[el("div",{class:"empty",text:t("noJobs")})]));
  fill(v,head(t("autonomous"),t("autoLead")),
   el("section",{class:"card",style:"margin-bottom:1rem"},el("div",{class:"form",style:"grid-template-columns:3fr 1fr auto"},el("label",{class:"f"},t("task"),goal),el("label",{class:"f"},t("maxMinutes"),minutes),
    el("button",{class:"btn primary",onclick:async()=>{const g=goal.value.trim();if(!g)return;try{await startJob(g,Number(minutes.value)||120,openBox.checked,verifyBox.checked?"task-app-http-v1":undefined);goal.value="";draw();}catch(e){toast(e.message);}}},icon("spark"),t("start"))),
    el("label",{class:"small",style:"display:flex;gap:.4rem;align-items:center;margin-top:.6rem"},openBox,t("openWhenDoneL")),
    el("label",{class:"small",style:"display:flex;gap:.4rem;align-items:center;margin-top:.6rem"},verifyBox,LANG==="ar"?"اختبار قبول مستقل لتطبيق المهام (HTTP والحفظ بعد إعادة التشغيل)":"Independent task-app acceptance (HTTP and restart persistence)"),
    el("p",{class:"small muted",style:"margin:.6rem 0 0",text:t("trustL")+": "+t("t_"+(S.setup?.workspace?.trust?.[project().toLowerCase()]||"supervised"))+" — "+t("trustNote")})),
   list);draw();
  timers.push(setInterval(async()=>{if(S.jobs.some(j=>JOB_ACTIVE.includes(j.status))){await loadJobs();draw();}},3000));
 },
 async agent(v){await Promise.all([loadSetup(),loadMissions()]);fill(v,head(t("agent"),t("agentSub")),agentCard(true));drawAgent();},
 async missions(v){
  await loadMissions();let f="all";const box=el("div",{class:"rows"});
  const match=m=>f==="all"||(f==="running"?["running","planned","verifying"].includes(m.status):m.status===f);
  const draw=()=>box.replaceChildren(...(S.missions.filter(match).map(missionRow)),...(S.missions.some(match)?[]:[el("div",{class:"empty",text:t("noMissions")})]));
  const chips=el("div",{class:"chips"},[["all","all"],["running","st_run"],["completed","completed"],["failed","failed"],["blocked","blocked"]].map(([k,l])=>el("button",{class:"chip",style:"font-family:inherit",text:t(l)+" ("+S.missions.filter(m=>k==="all"||(k==="running"?["running","planned","verifying"].includes(m.status):m.status===k)).length+")",onclick:()=>{f=k;draw();}})));
  fill(v,head(t("missions")),el("section",{class:"card"},chips,el("div",{style:"margin-top:.6rem"},box)));draw();
  timers.push(setInterval(async()=>{if(S.missions.some(m=>["running","planned","verifying"].includes(m.status))){await loadMissions();draw();}},4000));
 },
 async approvals(v){
  await loadApprovals();const pend=S.approvals.filter(isPending);
  fill(v,head(t("approvals"),t("approvalsLead")),el("section",{class:"card"},el("div",{class:"rows"},pend.length?pend.map(a=>approvalRow(a,()=>render())):el("div",{class:"empty",text:t("noApprovals")}))));
 },
 async computer(v){
  S.live=await safe(api("/v1/computer/live/status"),S.live);
  fill(v,head(t("computerControl"),t("liveLead")),computerCard(true),
   el("section",{class:"card",style:"margin-top:1rem"},el("h3",{text:t("sayThese")}),goalChips(LANG==="ar"?"افتح المتصفح وابحث عن أسعار الذهب اليوم|افتح المفكرة واكتب قائمة مهام الغد|اضغط CTRL+S لحفظ الملف المفتوح|التقط صورة للشاشة وصف ما تراه":"Open the browser and search today's gold price|Open Notepad and write tomorrow's to-do list|Press CTRL+S to save the open file|Take a screenshot and describe what you see")));
  drawLiveFrame();timers.push(setInterval(drawLiveFrame,1500));
 },
 async terminal(v){fill(v,head(t("terminalTitle")+" "+t("restricted"),t("terminalLead")),terminalCard(true));},
 async projects(v){
  const s=await loadSetup(true);const w=s?.workspace||{projects:[],linked:[],root:""};
  const pathIn=el("input",{class:"text",dir:"ltr",placeholder:"C:\\Users\\you\\code\\my-shop"}),nameIn=el("input",{class:"text",dir:"ltr",placeholder:"my-shop"});
  fill(v,head(t("projects"),t("projectsLead"),el("a",{class:"btn",href:vscodeUrl()},icon("code"),t("openVSCode"))),
   el("div",{class:"grid2"},
    el("section",{class:"card"},el("div",{class:"card-head"},el("h3",{text:t("activeProject")+": "+project()}),el("span",{class:"mono muted",text:projectPath()})),
     el("div",{class:"rows"},(w.projects||[]).map(p=>{const l=(w.linked||[]).find(x=>x.projectId===p.toLowerCase());return el("div",{class:"row"},el("div",{class:"t mono",text:p}),el("div",{class:"s mono",text:l?l.path:(w.root+((w.root||"").includes("\\")?"\\":"/")+p)}),
      el("div",{class:"a"},l?pill("done",t("linked")):null,trustSelect(p,(w.trust||{})[p.toLowerCase()]||"supervised"),el("button",{class:"btn small",text:t("use"),onclick:()=>{setProject(p);render();}}),el("button",{class:"btn small",text:t("project"),onclick:()=>{setProject(p);go("project");}}),el("button",{class:"btn small",text:t("inspect"),onclick:()=>{setProject(p);go("agent");setTimeout(()=>runGoal(LANG==="ar"?"افحص المشروع وأعطني ملخصاً عن بنيته وحالته":"Inspect the project and summarise its structure and state","auto"),80);}})));}))),
    el("section",{class:"card"},el("h3",{text:t("linkFolder")}),el("div",{style:"display:grid;gap:.6rem;margin-top:.6rem"},el("label",{class:"f"},t("folderPath"),pathIn),el("label",{class:"f"},t("projectName"),nameIn),
     el("button",{class:"btn primary",onclick:async()=>{const p=pathIn.value.trim(),n=nameIn.value.trim()||p.split(/[\\/]/).filter(Boolean).pop()||"";if(!p||!n)return;try{let r=await api("/v1/projects/link",{method:"POST",body:{projectId:n,path:p},allow:[400,409]});if(r.error==="project_id_taken"&&confirm(t("relinkQ").replace("{name}",n).replace("{path}",r.path?" ("+r.path+")":"")))r=await api("/v1/projects/link",{method:"POST",body:{projectId:n,path:p,replace:true},allow:[400,409]});if(r.ok===false){toast(r.error==="project_id_taken"?t("nameTaken"):(r.message||r.error));return;}setProject(n);toast("✓ "+n);render();}catch(e){toast(e.message);}}},t("link"))))));
 },
 async git(v){
  const out=el("div",{class:"term",style:"max-height:50vh"},el("div",{class:"muted",text:"git status · git diff · git log"}));
  const run=async(tool)=>{out.replaceChildren(el("div",{class:"wait",text:"…"}));const r=await safe(quickTool(tool,{}),{ok:false,error:"network"});const d=r.data||{};out.replaceChildren(el("div",{class:"cmd",text:"> "+(d.command||tool)}),el("div",{text:r.ok?String(d.stdout||"(empty)"):reasonText(r.error)}));};
  fill(v,head(t("git"),t("gitLead")),el("div",{class:"grid2"},
   el("section",{class:"card"},el("div",{class:"actions"},el("button",{class:"btn",onclick:()=>run("git.status")},icon("git"),"git status"),el("button",{class:"btn",onclick:()=>run("git.diff")},"git diff"),el("button",{class:"btn",onclick:()=>run("git.log")},"git log"),el("button",{class:"btn",onclick:createBranch},icon("branch"),t("createBranch"))),out),
   el("section",{class:"card"},el("h3",{text:t("gitAsk")}),goalChips([t("gitCommit"),t("gitPush"),t("gitPR")].join("|")))));
  run("git.status");
 },
 async ecommerce(v){
  const b=(await safe(api("/v1/business"),{})).business||{};S.biz=b;
  fill(v,head(t("ecommerce"),"Shopify · WooCommerce"),stats([[t("stores"),(b.stores||[]).length],[t("products"),(b.products||[]).length],[t("orders"),(b.orders||[]).length],[t("orderValue"),(b.orders||[]).reduce((n,o)=>n+(o.total||0),0)]]),
   el("div",{class:"grid2",style:"margin-top:1rem"},
    el("section",{class:"card"},el("h3",{text:t("products")}),el("div",{class:"rows"},(b.products||[]).slice(-12).reverse().map(p=>el("div",{class:"row"},el("div",{class:"t",dir:"auto",text:p.name}),el("div",{class:"s",text:(p.price??"")+" "+(p.currency||"")}),el("div",{class:"a"},pill(p.externalId?"done":"pend",p.externalId?t("published"):"draft")))),(b.products||[]).length?null:el("div",{class:"empty",text:"—"}))),
    el("section",{class:"card"},el("h3",{text:t("gitAsk")}),goalChips(t("shopGoals")),el("h3",{style:"margin-top:1rem",text:t("orders")}),el("div",{class:"rows"},(b.orders||[]).slice(-8).reverse().map(o=>el("div",{class:"row"},el("div",{class:"t mono",text:o.externalId||o.id.slice(0,8)}),el("div",{class:"s",text:(o.total??"")+" "+(o.currency||"")+" · "+(o.status||"")}))),(b.orders||[]).length?null:el("div",{class:"empty",text:"—"})))));
 },
 async social(v){
  const [b,oc]=await Promise.all([safe(api("/v1/business"),{}).then(x=>x.business||{}),safe(api("/v1/oauth/connections"),{connections:[]})]);
  const content=b.content||[];
  fill(v,head(t("social"),"Instagram · Facebook · TikTok · YouTube · X · LinkedIn · Pinterest"),
   stats([[t("accounts"),(b.socialAccounts||[]).length+(oc.connections||[]).length],[t("content"),content.length],[t("published"),content.filter(c=>c.status==="published").length],[t("scheduled"),content.filter(c=>c.status==="scheduled").length]]),
   el("div",{class:"grid2",style:"margin-top:1rem"},
    el("section",{class:"card"},el("h3",{text:t("content")}),el("div",{class:"rows"},content.slice(-12).reverse().map(c=>el("div",{class:"row"},el("div",{class:"t",dir:"auto",text:c.title||c.id}),el("div",{class:"s",text:(c.platforms||[]).join(", ")+(c.scheduledAt?" · "+new Date(c.scheduledAt).toLocaleString():"")}),el("div",{class:"a"},c.quality?el("span",{class:"status "+STATUS_CLASS[c.quality.verdict==="pass"?"done":c.quality.verdict==="review"?"wait":"fail"],title:t("qualityL")+" · "+t("hzV_"+c.quality.verdict),text:c.quality.humanScore+"/100"}):null,pill(c.status==="published"?"done":c.status==="failed"?"fail":c.status==="scheduled"?"run":"pend",c.status)))),content.length?null:el("div",{class:"empty",text:"—"}))),
    el("section",{class:"card"},el("h3",{text:t("gitAsk")}),goalChips(t("socialGoals")),el("h3",{style:"margin-top:1rem",text:t("accounts")}),el("div",{class:"rows"},[...(b.socialAccounts||[]).map(a=>a.platform+" · "+(a.name||a.externalId||"")),...(oc.connections||[]).map(c=>c.provider+" · "+(c.accountName||c.accountId))].map(x=>el("div",{class:"row"},el("div",{class:"t",text:x}))),((b.socialAccounts||[]).length+(oc.connections||[]).length)?null:el("div",{class:"empty",text:t("needsSetup")})))),
   humanizerCard(),await voiceCard());
 },
 async trading(v){
  const swap=(id,node)=>{const o=document.getElementById(id);if(o)o.replaceWith(node);};
  let d=await safe(trOverview(trPref("connect","")==="1"),{ok:false,error:"network"});
  const runs=(await safe(api("/v1/trading/tester"),{runs:[]})).runs||[];
  const reload=async()=>{const n=await safe(trOverview(true),null);if(!n||current!=="trading")return;d=n;
   if(!n.connected){draw();return;}
   swap("trAccount",trAccountSection(n));swap("trScalper",trScalperSection(n,reload));swap("trQuote",trQuoteSection(n,reload));swap("trPositions",trPositionsSection(n));swap("trHistory",trHistorySection(n,reload));
   const l=await safe(api("/v1/trading/tester"),null);if(l)swap("trRuns",trRunsList(l.runs||[]));};
  const connectBtn=el("button",{class:"btn primary",onclick:async()=>{trSetPref("connect","1");connectBtn.disabled=true;d=await safe(trOverview(true),{ok:false,error:"network"});draw();}},icon("bolt"),t("trConnect"));
  const draw=()=>{
   if(d.ok===false&&d.error){fill(v,head(t("trading"),t("tradingLead")),el("section",{class:"card"},el("p",{class:"tr-neg",text:reasonText(d.error)})));return;}
   if(d.enabled===false){fill(v,head(t("trading"),t("tradingLead")),el("section",{class:"card"},el("p",{text:t("trOff")}),el("button",{class:"btn",onclick:()=>go("team"),text:t("team")})));return;}
   const top=head(t("trading"),t("tradingLead"),d.connected?el("button",{class:"btn",onclick:reload},icon("activity"),t("trRefresh")):null);
   if(!d.connected){
    const failed=d.account&&!d.account.ok?el("p",{class:"tr-neg",dir:"auto",style:"margin-top:.6rem"},el("b",{text:t("trFailed")+" "}),d.account.error):null;
    fill(v,top,el("section",{class:"card",style:"margin-bottom:1rem"},el("p",{text:t("trConnectHint")}),connectBtn,failed),el("div",{class:"grid2"},trScalperSection(d,reload)),trTesterSection(runs));return;
   }
   fill(v,top,trAccountSection(d),el("div",{class:"grid2",style:"margin-top:1rem"},trScalperSection(d,reload),trQuoteSection(d,reload)),trPositionsSection(d),trHistorySection(d,reload),trTesterSection(runs));
  };
  draw();
  // Prices and positions move: refresh every 10 s while connected (the forms are kept).
  timers.push(setInterval(()=>{if(d.connected&&!document.hidden)reload();},10000));
 },
 async ads(v){
  const d=await safe(api("/v1/ads"),{});const a=d.ads||{};const dash=d.dashboard||{};
  fill(v,head(t("ads"),"Google Ads · Meta · TikTok · X · LinkedIn · Snapchat"),
   stats([[t("accounts"),(a.adAccounts||[]).length],[t("campaigns"),(a.paidCampaigns||[]).length],...Object.entries(dash).filter(([,x])=>typeof x==="number").slice(0,4).map(([k,x])=>[k,Math.round(x*100)/100])]),
   el("div",{class:"grid2",style:"margin-top:1rem"},
    el("section",{class:"card"},el("h3",{text:t("campaigns")}),el("div",{class:"rows"},(a.paidCampaigns||[]).slice(-12).reverse().map(c=>el("div",{class:"row"},el("div",{class:"t",dir:"auto",text:c.name||c.id}),el("div",{class:"s",text:(c.platform||"")+" · "+(c.dailyBudget??c.budget??"")}),el("div",{class:"a"},pill(c.status==="active"?"run":c.status==="completed"?"done":c.status==="failed"?"fail":"pend",c.status)))),(a.paidCampaigns||[]).length?null:el("div",{class:"empty",text:t("needsSetup")}))),
    el("section",{class:"card"},el("h3",{text:t("gitAsk")}),goalChips(t("adsGoals")))));
 },
 async analytics(v){
  const [b,g]=await Promise.all([safe(api("/v1/business/analytics"),{}),safe(api("/v1/growth/dashboard"),{})]);const x=b.analytics||{};const gd=g.dashboard||{};
  fill(v,head(t("analytics"),t("analyticsLead")),
   stats([[t("stores"),x.stores],[t("products"),x.products],[t("orders"),x.orders],[t("orderValue"),x.orderValue],[t("content"),x.content],[t("published"),x.publishedContent],[t("scheduled"),x.scheduledContent],[t("campaigns"),x.campaigns]]),
   el("section",{class:"card",style:"margin-top:1rem"},el("h3",{text:"Growth"}),stats([[t("experiments"),gd.experiments],[t("st_run"),gd.runningExperiments],[t("openActions"),gd.openActions],[t("completed"),gd.completedExperiments]])));
 },
 async integrations(v){
  await Promise.all([loadSetup(true),safe(api("/v1/channels/status"),null).then(x=>S.channels=x),safe(api("/v1/oauth/connections"),null).then(x=>S.oauth=x)]);
  fill(v,head(t("integrations"),"",el("a",{class:"btn",href:"/setup",text:t("setup")})),el("div",{class:"grid3"},integrationStatus().map(([n,st,d])=>el("div",{class:"integ"},el("span",{class:"dot "+(st==="on"?"on":st==="part"?"part":"")}),el("div",{},el("b",{text:n}),el("small",{class:"mono",text:d}))))),await platformsPanel(),await mcpPanel());
 },
 async team(v){
  const s=await loadSetup(true);const caps=s?.capabilities||{};
  const ext=await safe(api("/v1/agents/external"),{agents:[]});
  const specialised=el("section",{class:"card",style:"margin-bottom:1rem"},el("h3",{text:t("agentsL")}),el("div",{class:"grid3",style:"margin-top:.6rem"},["core","coder","tester","researcher","operator","business"].map(a=>el("div",{class:"integ"},el("span",{class:"dot on"}),el("div",{},el("b",{text:t("ag_"+a)}),el("small",{class:"mono",text:a}))))),
   el("h3",{style:"margin-top:1rem",text:t("externalL")}),(ext.agents||[]).length?el("div",{class:"grid3",style:"margin-top:.6rem"},ext.agents.map(a=>el("div",{class:"integ"},el("span",{class:"dot "+(a.kind==="local"||ext.cloudAllowed?"on":"part")}),el("div",{},el("b",{text:a.label}),el("small",{text:a.kind==="local"?t("localKind"):t("cloudKind")}))))):el("p",{class:"muted",text:t("noExternal")}));
  fill(v,head(t("team"),t("teamLead")),specialised,el("div",{class:"grid3"},Object.entries(caps).map(([k,c])=>{const box=el("input",{type:"checkbox"});box.checked=c.enabled;
   box.addEventListener("change",async()=>{try{await api("/v1/setup/settings",{method:"PUT",body:{capabilities:{[k]:box.checked}}});toast(t("restartNote"));}catch(e){box.checked=!box.checked;toast(e.message);}});
   return el("label",{class:"integ",style:"cursor:pointer"},el("span",{class:"dot "+(c.enabled?"on":"")}),el("div",{style:"flex:1"},el("b",{text:k}),el("small",{text:c.label})),box);})),el("p",{class:"muted",text:t("restartNote")}));
 },
 async schedules(v){
  const d=await api("/v1/scheduler");const list=d.schedules||[];
  const goal=el("input",{class:"text",dir:"auto"}),kind=el("select",{class:"text"},el("option",{value:"daily",text:t("daily")}),el("option",{value:"interval",text:t("interval")}),el("option",{value:"once",text:t("once")})),when=el("input",{class:"text",type:"time",value:"08:00",dir:"ltr"});
  kind.addEventListener("change",()=>{when.type=kind.value==="daily"?"time":kind.value==="once"?"datetime-local":"number";when.value=kind.value==="daily"?"08:00":kind.value==="interval"?"60":"";when.placeholder=kind.value==="interval"?t("minutes"):"";});
  const add=el("button",{class:"btn primary",text:t("add"),onclick:async()=>{const g=goal.value.trim();if(!g)return;let trigger;if(kind.value==="daily"){const[h,m]=(when.value||"08:00").split(":").map(Number);trigger={kind:"daily",hour:h,minute:m};}else if(kind.value==="interval")trigger={kind:"interval",intervalMs:Math.max(1,Number(when.value)||60)*60000};else{if(!when.value)return;trigger={kind:"once",runAt:new Date(when.value).toISOString()};}
   try{await api("/v1/scheduler/schedules",{method:"POST",body:{goal:g,projectId:project(),trigger}});render();}catch(e){toast(e.message);}}});
  const describe=x=>x.kind==="daily"?t("daily")+" "+String(x.hour??0).padStart(2,"0")+":"+String(x.minute??0).padStart(2,"0"):x.kind==="interval"?t("interval")+" "+Math.round((x.intervalMs||0)/60000)+" "+t("minutes"):t("once")+" "+(x.runAt?new Date(x.runAt).toLocaleString():"");
  fill(v,head(t("schedules"),t("scheduleLead")),el("section",{class:"card"},el("h3",{text:t("newSchedule")}),el("div",{class:"form",style:"margin-top:.6rem"},el("label",{class:"f"},t("task"),goal),el("label",{class:"f"},t("repeat"),kind),el("label",{class:"f"},t("time"),when),add)),
   el("section",{class:"card",style:"margin-top:1rem"},el("div",{class:"rows"},list.length?list.map(s=>el("div",{class:"row"},el("div",{class:"t",dir:"auto",text:s.goal}),el("div",{class:"s",text:describe(s.trigger)+(s.nextRunAt?" · "+new Date(s.nextRunAt).toLocaleString():"")}),el("div",{class:"a"},pill(s.enabled?"done":"pend",s.enabled?t("enabled"):t("disabled")),el("button",{class:"btn small",text:s.enabled?t("pause"):t("resume"),onclick:async()=>{try{await api("/v1/scheduler/"+encodeURIComponent(s.id)+"/enable",{method:"POST",body:{enabled:!s.enabled}});render();}catch(e){toast(e.message);}}})))):el("div",{class:"empty",text:t("noSchedules")}))));
 },
 async models(v){
  const s=await loadSetup(true);const o=s.ollama;const plan=o.plan?.assignments||{};
  fill(v,head(t("models"),"",el("a",{class:"btn",href:"/setup",text:t("openSetup")})),el("div",{class:"grid2"},
   el("section",{class:"card"},el("h3",{text:t("localModels")}),el("div",{class:"rows",style:"margin-top:.5rem"},Object.entries(plan).map(([k,m])=>el("div",{class:"row"},el("div",{class:"t",text:k}),el("div",{class:"a"},el("span",{class:"mono",text:m||"—"})))),o.models.map(m=>el("div",{class:"row"},el("div",{class:"t mono",text:m.name}),el("div",{class:"s",text:[m.paramsB?m.paramsB+"B":"",m.sizeGB?m.sizeGB+" GB":"",m.capabilities.join(", ")].filter(Boolean).join(" · ")}))))),
   el("section",{class:"card"},el("h3",{text:t("cloudModels")}),el("div",{class:"rows",style:"margin-top:.5rem"},s.cloud.providers.map(p=>el("div",{class:"row"},el("div",{class:"t",text:p.label}),el("div",{class:"s mono",text:p.model}),el("div",{class:"a"},pill(p.active?"done":p.hasKey?"wait":"pend",p.active?t("connected"):p.hasKey?t("restart"):t("needsSetup")))))))));
 },
 async tools(v){
  const[tl,sk]=await Promise.all([api("/v1/tools"),safe(api("/v1/skills"),{skills:[]})]);const tools=(tl.tools||[]).slice().sort((a,b)=>a.name.localeCompare(b.name));let q="";const box=el("div",{class:"rows"});
  const draw=()=>box.replaceChildren(...tools.filter(x=>!q||(x.name+" "+x.description).toLowerCase().includes(q)).map(x=>el("div",{class:"row"},el("div",{class:"t mono",text:x.name}),el("div",{class:"s",text:x.description}),el("div",{class:"a"},el("span",{class:"status "+(x.permission==="L4_EXECUTE"?"s-fail":x.permission==="L3_MODIFY"?"s-run":"s-pend"),text:x.permission}),x.dangerous?el("span",{class:"status s-wait",text:t("needsApproval")}):null))));
  fill(v,head(t("tools"),t("toolsLead")),el("div",{class:"grid2"},el("section",{class:"card"},el("input",{class:"text",placeholder:t("search")+" ("+tools.length+")",oninput:e=>{q=e.target.value.trim().toLowerCase();draw();}}),el("div",{style:"margin-top:.4rem"},box)),
   el("section",{class:"card"},el("h3",{text:t("skills")}),el("div",{class:"rows"},(sk.skills||[]).length?sk.skills.map(s=>el("div",{class:"row"},el("div",{class:"t",text:s.name||s.id}),el("div",{class:"s",text:s.description||""}),el("div",{class:"a"},pill("pend",s.status)))):el("div",{class:"empty",text:t("noSkills")})))));draw();
 },
 async activity(v){
  await loadMissions();await Promise.all(S.missions.slice(0,8).map(m=>missionDetail(m.id)));
  const items=[];for(const m of S.missions.slice(0,8)){for(const a of S.details.get(m.id)?.audit||[])if(shownActivity(a))items.push({...a,goal:goalText(m)});}
  items.sort((x,y)=>Date.parse(y.timestamp||0)-Date.parse(x.timestamp||0));
  fill(v,head(t("activity"),t("activityLead")),el("section",{class:"card"},items.length?el("ul",{class:"acts"},items.slice(0,80).map(a=>{const x=activityText(a,a.goal);return el("li",{},icon(x.ic),el("span",{class:"t",dir:"auto",text:x.t}),el("span",{class:"mono muted",text:a.resource&&a.resource.length<40?a.resource:""}),el("time",{text:ago(a.timestamp)}));})):el("div",{class:"empty",text:t("noActivity")})));
 },
 async settings(v){
  const[st,h]=await Promise.all([api("/v1/status"),safe(api("/v1/health",{allow:[503]}),{})]);
  fill(v,head(t("settings"),t("settingsLead")),el("div",{class:"grid2"},
   el("section",{class:"card"},el("div",{class:"actions"},el("button",{class:"btn",onclick:()=>{LANG=LANG==="ar"?"en":"ar";localStorage.setItem("lx.cc.lang",LANG);boot();}},t("language")),el("a",{class:"btn",href:"/setup"},icon("settings"),t("setup")),el("a",{class:"btn",href:"/voice"},icon("mic"),t("voice")),
     el("button",{class:"btn",onclick:async()=>{try{await api("/v1/setup/restart",{method:"POST",body:{}});toast("…");setTimeout(()=>location.reload(),6000);}catch(e){toast(e.message);}}},t("restart")))),
   el("section",{class:"card"},el("h3",{text:t("status")}),stats([["ready",st.ready?"✓":"✗"],["health",h.healthy?"✓":"!"],["persistence",st.persistence],["AI mode",st.providers?.mode]]))),
   el("pre",{class:"raw",style:"margin-top:1rem",text:JSON.stringify({status:st,health:h},null,2)}));
 }
};

// ------------------------------------------------------------------ chrome
const NAV=["dashboard","agent","autonomous","missions","approvals","computer","terminal","projects","project","git","|","ecommerce","social","ads","analytics","trading","integrations","team","learning","|","schedules","models","tools","activity","settings"];
const NAV_ICON={dashboard:"dashboard",agent:"agent",autonomous:"spark",missions:"missions",approvals:"approvals",computer:"computer",terminal:"terminal",projects:"projects",project:"flag",git:"git",ecommerce:"ecommerce",social:"social",ads:"ads",analytics:"analytics",trading:"trading",integrations:"integrations",team:"team",learning:"spark",schedules:"schedules",models:"models",tools:"tools",activity:"activity",settings:"settings"};
let current="dashboard",timers=[];
function logo(){const s=document.createElementNS("http://www.w3.org/2000/svg","svg");s.setAttribute("viewBox","0 0 48 48");s.setAttribute("class","logo");s.setAttribute("aria-hidden","true");
 s.innerHTML='<defs><linearGradient id="lxg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#60A5FA"/><stop offset="1" stop-color="#2563EB"/></linearGradient></defs><path d="M6 6h10l8 11 8-11h10L29 24l13 18H32l-8-11-8 11H6l13-18z" fill="url(#lxg)"/>';return s;}
function drawBell(){const pend=S.approvals.filter(isPending).length;const b=$("#bellBadge");if(b){b.hidden=!pend;b.textContent=String(pend);}const c=$("#navCount");if(c){c.hidden=!pend;c.textContent=String(pend);}}
function buildChrome(){
 document.documentElement.lang=LANG;document.documentElement.dir=LANG==="ar"?"rtl":"ltr";
 const askIn=el("input",{placeholder:t("ask"),dir:"auto","aria-label":t("ask")});
 askIn.addEventListener("keydown",e=>{if(e.key==="Enter"&&askIn.value.trim()){const g=askIn.value.trim();askIn.value="";if(current!=="dashboard"&&current!=="agent")go("agent");setTimeout(()=>runGoal(g,"auto"),80);}});
 const drop=el("div",{class:"drop",hidden:true});
 const bell=el("button",{class:"icon-btn","aria-label":t("notifications"),onclick:async e=>{e.stopPropagation();drop.hidden=!drop.hidden;if(!drop.hidden){await loadApprovals();const pend=S.approvals.filter(isPending);drop.replaceChildren(el("h4",{text:t("notifications")}),el("div",{class:"rows"},pend.length?pend.map(a=>approvalRow(a,async()=>{await loadApprovals();drawBell();drop.hidden=true;})):el("div",{class:"empty",text:t("noNotifications")})));}}},icon("bell"),el("span",{class:"badge",id:"bellBadge",hidden:true}));
 document.addEventListener("click",e=>{if(!drop.contains(e.target))drop.hidden=true;});
 const status=el("span",{class:"pill",id:"agentPill"},el("span",{class:"dot"}),el("span",{id:"agentPillText",text:t("online")}));
 $("#topbar").replaceChildren(
  el("button",{class:"icon-btn menu","aria-label":"menu",onclick:()=>document.body.classList.toggle("menu-open")},icon("menu")),
  el("a",{class:"brand",href:"#dashboard"},logo(),el("div",{},el("b",{text:"LayanX AI"}),el("small",{text:t("tagline")}))),
  el("label",{class:"ask"},icon("search"),askIn,el("a",{href:"/voice",title:t("voice"),"aria-label":t("voice")},icon("mic"))),
  el("div",{class:"top-right"},status,el("div",{style:"position:relative"},bell,drop),
   el("div",{class:"user"},el("div",{class:"avatar",id:"avatar",text:initials()}),el("div",{},el("b",{id:"ownerName",text:S.setup?.owner?.name||"LayanX"}),el("small",{text:t("owner")}))),
   el("button",{class:"icon-btn",title:t("language"),"aria-label":t("language"),onclick:()=>{LANG=LANG==="ar"?"en":"ar";localStorage.setItem("lx.cc.lang",LANG);boot();},text:LANG==="ar"?"EN":"ع"}),
   el("a",{class:"icon-btn",href:"/setup",title:t("setup"),"aria-label":t("setup")},icon("settings"))));
 $("#nav").replaceChildren(...NAV.map(id=>id==="|"?el("div",{class:"nav-sep"}):el("button",{class:"nav-btn","data-view":id,onclick:()=>go(id)},icon(NAV_ICON[id]),el("span",{text:t(id)}),id==="approvals"?el("span",{class:"count",id:"navCount",hidden:true}):null)));
}
function go(id){if(!VIEWS[id])id="dashboard";if(location.hash!=="#"+id)history.replaceState(null,"","#"+id);current=id;render();}
async function render(){
 timers.forEach(clearInterval);timers=[];document.body.classList.remove("menu-open");
 document.querySelectorAll(".nav-btn").forEach(b=>b.setAttribute("aria-current",b.dataset.view===current?"page":"false"));
 const v=$("#view");v.replaceChildren(el("div",{class:"empty",text:t("loading")}));
 try{await VIEWS[current](v);}catch(e){if(e.message!=="unauthorized")v.replaceChildren(el("section",{class:"card"},el("h3",{text:t("loadFailed")}),el("p",{class:"muted",text:e.message})));}
 drawBell();
}
async function heartbeat(){
 const h=await safe(api("/v1/health",{allow:[503]}),null);const ok=!!h&&h.ready!==false;
 const p=$("#agentPill");if(p){p.classList.toggle("off",!ok);$("#agentPillText").textContent=ok?t("online"):t("offline");}
 await loadApprovals();drawBell();
}
async function boot(){
 await loadSetup(true);buildChrome();
 const n=$("#ownerName");if(n&&S.setup?.owner?.name)n.textContent=S.setup.owner.name;
 const id=location.hash.slice(1);current=VIEWS[id]?id:"dashboard";render();heartbeat();
}
window.addEventListener("hashchange",()=>{const id=location.hash.slice(1);if(VIEWS[id]&&id!==current){current=id;render();}});
setInterval(heartbeat,15000);
boot();
