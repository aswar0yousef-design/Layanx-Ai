/*
 * Every visible word lives here, in English and Arabic. Arabic switches the whole layout to right-to-left.
 * Add a key here before using new text in a component.
 */
export const STRINGS = {
  en: {
    brand: "Orbit", workspace: "Workspace", sales: "Sales", insights: "Insights",
    overview: "Overview", pipeline: "Pipeline", tasks: "Tasks", customers: "Customers", reports: "Reports", settings: "Settings",
    search: "Search deals, people, pages…", newDeal: "New deal", newTask: "New task", language: "العربية",
    kpi_pipeline: "Open pipeline", kpi_forecast: "Weighted forecast", kpi_won: "Won this quarter", kpi_deal: "Average deal",
    vsLast: "vs last quarter", revenue: "Revenue", revenueSub: "Last 12 months, in thousands", activity: "Recent activity",
    goal: "Q4 goal", goalSub: "of the quarter target",
    pipelineSub: "Drag deals between stages. Drop one on Won to close it.",
    lead: "Lead", qualified: "Qualified", proposal: "Proposal", negotiation: "Negotiation", won: "Won",
    emptyStage: "No deals here yet", due: "Due",
    tasksSub: "What needs you today, and what is coming next.",
    overdue: "Overdue", today: "Today", upcoming: "Upcoming", completed: "Completed",
    all: "All", call: "Calls", email: "Emails", meeting: "Meetings", todo: "To-dos",
    high: "High", medium: "Medium", low: "Low", nothing: "Nothing here. Nice.",
    markDone: "Mark as done", markOpen: "Mark as not done", soon: "This page is ready for your content.",
  },
  ar: {
    brand: "أوربت", workspace: "مساحة العمل", sales: "المبيعات", insights: "التحليلات",
    overview: "نظرة عامة", pipeline: "مسار الصفقات", tasks: "المهام", customers: "العملاء", reports: "التقارير", settings: "الإعدادات",
    search: "ابحث في الصفقات والأشخاص والصفحات…", newDeal: "صفقة جديدة", newTask: "مهمة جديدة", language: "English",
    kpi_pipeline: "الصفقات المفتوحة", kpi_forecast: "التوقع المرجّح", kpi_won: "المكسوب هذا الربع", kpi_deal: "متوسط الصفقة",
    vsLast: "مقارنة بالربع الماضي", revenue: "الإيرادات", revenueSub: "آخر 12 شهراً، بالآلاف", activity: "آخر النشاط",
    goal: "هدف الربع الرابع", goalSub: "من هدف الربع",
    pipelineSub: "اسحب الصفقات بين المراحل، وأفلتها في «مكسوبة» لإغلاقها.",
    lead: "عميل محتمل", qualified: "مؤهّل", proposal: "عرض سعر", negotiation: "تفاوض", won: "مكسوبة",
    emptyStage: "لا توجد صفقات هنا بعد", due: "الموعد",
    tasksSub: "ما يحتاجك اليوم، وما هو قادم.",
    overdue: "متأخرة", today: "اليوم", upcoming: "قادمة", completed: "منجزة",
    all: "الكل", call: "مكالمات", email: "رسائل", meeting: "اجتماعات", todo: "مهام",
    high: "عالية", medium: "متوسطة", low: "منخفضة", nothing: "لا شيء هنا. ممتاز.",
    markDone: "تعليم كمنجزة", markOpen: "إلغاء الإنجاز", soon: "هذه الصفحة جاهزة لمحتواك.",
  },
};

export function t(lang, key) {
  return STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
}
