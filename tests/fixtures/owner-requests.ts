/**
 * Requests worded the way the owner writes them (Arabic with Gulf/Yemeni phrasing, some English), each with where it must
 * go. answer: a reply in words. task: the agent runs tools now. project-*: the supervisor, which builds or repairs with
 * checks and reports when proven. Used to measure the router, not to train it: new wordings are added when they fail.
 */
export type Route="answer"|"task"|"project-build"|"project-repair"|"project-status";
export const OWNER_REQUESTS:Array<[string,Route]>=[
  ["من انت","answer"],["what can you do","answer"],["صباح الخير","answer"],["كيف أربط واتساب مع LayanX؟","answer"],
  ["هل يمكنك بناء موقع؟","answer"],["شو الفرق بين MT4 و MT5","answer"],["اشرح لي كيف يعمل البحث عن العملاء","answer"],
  ["ليش النموذج المحلي بطيء؟","answer"],["what is a pull request","answer"],["كم سعر الشحن عادة من صنعاء لعدن؟","answer"],
  ["التقط صورة للشاشة وصف ما تراه","task"],["افتح كروم","task"],["ابحث لي عن عملاء محتملين لموقع layanx.com","task"],
  ["اقرأ بريدي الأخير","task"],["ارسل رسالة واتساب لأحمد أني تأخرت","task"],["رتب ملفات التنزيلات","task"],
  ["open youtube.com","task"],["send me today's shipping report","task"],["خذ لقطة شاشة","task"],
  ["ذكرني بكرة الساعة 9 بموعد البنك","task"],["حمل آخر فواتير الشحن من الإيميل إلى جوجل شيت","task"],["شوف لي إيميلاتي الجديدة","task"],
  ["ابن لي موقع لمتجر عطور","project-build"],["اعمل لي تطبيق قائمة مهام","project-build"],["صمم صفحة هبوط لشركة شحن","project-build"],
  ["اريدك تبني لعبة بسيطة في المتصفح","project-build"],["build me a calculator web app","project-build"],
  ["سوي لي سكربت يحول ملفات CSV إلى JSON","project-build"],["انشئ موقع شخصي لي","project-build"],["قم ببناء لوحة تحكم للمبيعات","project-build"],
  ["طور برنامج صغير يحسب الزكاة","project-build"],["أبغى موقع لمطعمي فيه المنيو والأسعار","project-build"],["ممكن تسوي لي تطبيق يحسب المصاريف","project-build"],
  ["اصلح العطل في مشروع mawid","project-repair"],["في مشكلة في الموقع، الصفحة الرئيسية ما تفتح، اصلحها","project-repair"],
  ["fix the bug in my app where login fails","project-repair"],["عالج الخطأ اللي يطلع في صفحة الأدوية","project-repair"],
  ["المشروع فيه خطأ لما أضغط حفظ، صلحه","project-repair"],["التطبيق يعلق عند فتح الإعدادات، شوف السبب واصلحه","project-repair"],
  ["وين وصل المشروع؟","project-status"],["ما حالة المشروع","project-status"],["how is the project going","project-status"],["كيف ماشي المشروع؟","project-status"]
];

/** Written after the router was tuned and measured once, without changing the rules afterwards: the honest number. */
export const HELD_OUT_REQUESTS:Array<[string,Route]>=[
  ["مساء الخير يا ليان","answer"],["ايش رأيك في استراتيجية السكالبينج؟","answer"],["how do I add a new shipping carrier?","answer"],
  ["هل تقدر تقرأ ملفات PDF؟","answer"],["وش يعني MCP؟","answer"],
  ["افتح واتساب","task"],["ابحث عن أرخص شركة شحن من جدة للرياض","task"],["احفظ هذا الملف في جوجل درايف","task"],
  ["check my calendar for tomorrow","task"],["حلل مبيعات الأسبوع الماضي","task"],
  ["ابغى تطبيق جوال لحجز المواعيد","project-build"],["سوي لي موقع تعريفي لشركتي","project-build"],["create a landing page for my perfume store","project-build"],
  ["صمم لي لعبة ألغاز بسيطة","project-build"],["طور سكربت ينسخ الملفات احتياطياً كل يوم","project-build"],
  ["الموقع ما يحفظ الطلبات، صلح المشكلة","project-repair"],["my site shows a blank page after login, fix it","project-repair"],["اصلح الخطأ في صفحة الدفع","project-repair"],
  ["وش صار في المشروع؟","project-status"],["is the project done yet","project-status"]
];
