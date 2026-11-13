/*
 * Sample data. Replace it with the project's real data (an API call, a JSON file, local storage);
 * keep the same shapes so every page keeps working.
 */
export const TODAY = "2026-11-13";

export const user = { name: "Sara Haddad", role: "Head of Sales", initials: "SH" };

export const kpis = [
  { id: "pipeline", value: 846000, previous: 772000, money: true, trend: [42, 48, 45, 53, 58, 55, 63, 70, 68, 76, 81, 85] },
  { id: "forecast", value: 452000, previous: 430000, money: true, trend: [30, 31, 33, 32, 36, 38, 37, 40, 42, 41, 44, 45] },
  { id: "won", value: 229000, previous: 251000, money: true, trend: [28, 26, 27, 25, 24, 26, 23, 22, 24, 23, 22, 23] },
  { id: "deal", value: 47000, previous: 41000, money: true, trend: [32, 33, 35, 34, 37, 38, 40, 41, 43, 44, 46, 47] },
];

export const revenue = [
  { month: "Dec", value: 61 }, { month: "Jan", value: 58 }, { month: "Feb", value: 66 }, { month: "Mar", value: 72 },
  { month: "Apr", value: 69 }, { month: "May", value: 78 }, { month: "Jun", value: 84 }, { month: "Jul", value: 81 },
  { month: "Aug", value: 90 }, { month: "Sep", value: 96 }, { month: "Oct", value: 104 }, { month: "Nov", value: 112 },
];

export const stages = [
  { id: "lead", color: "#a3a8b8" },
  { id: "qualified", color: "#1fb6c9" },
  { id: "proposal", color: "#7c5cff" },
  { id: "negotiation", color: "#fbbf24" },
  { id: "won", color: "#34d399" },
];

export const people = {
  noor: { name: "Noor A.", hue: 18 },
  omar: { name: "Omar K.", hue: 200 },
  lina: { name: "Lina S.", hue: 280 },
  yusuf: { name: "Yusuf M.", hue: 140 },
};

export const deals = [
  { id: "d1", title: "Fleet tracking rollout", company: "Northwind Freight", value: 64000, stage: "lead", owner: "noor", progress: 15, due: "2026-11-28" },
  { id: "d2", title: "Supplier portal", company: "Cedar Foods", value: 37000, stage: "lead", owner: "omar", progress: 10, due: "2026-12-03" },
  { id: "d3", title: "Warehouse scanners", company: "Delta Logistics", value: 21000, stage: "lead", owner: "yusuf", progress: 20, due: "2026-12-09" },
  { id: "d4", title: "Lab data sync", company: "Helix Labs", value: 52000, stage: "qualified", owner: "lina", progress: 40, due: "2026-11-25" },
  { id: "d5", title: "Loyalty programme", company: "Palm Outdoor", value: 29000, stage: "qualified", owner: "noor", progress: 35, due: "2026-12-01" },
  { id: "d6", title: "Onboarding automation", company: "Brightpath HR", value: 41000, stage: "proposal", owner: "omar", progress: 60, due: "2026-11-21" },
  { id: "d7", title: "Clinic network licence", company: "Saha Clinics", value: 148000, stage: "proposal", owner: "lina", progress: 55, due: "2026-11-30" },
  { id: "d8", title: "Store analytics", company: "Oasis Retail", value: 86000, stage: "negotiation", owner: "yusuf", progress: 80, due: "2026-11-18" },
  { id: "d9", title: "Support desk migration", company: "Falcon Telecom", value: 33000, stage: "negotiation", owner: "noor", progress: 75, due: "2026-11-20" },
  { id: "d10", title: "Studio seats x40", company: "Atlas Design", value: 18400, stage: "won", owner: "omar", progress: 100, due: "2026-11-10" },
  { id: "d11", title: "Live-ops dashboard", company: "Pixel Forge", value: 76000, stage: "won", owner: "lina", progress: 100, due: "2026-11-07" },
];

export const tasks = [
  { id: "t1", title: "Follow up on the renewal call", kind: "call", priority: "high", due: "2026-11-11", owner: "noor", done: false },
  { id: "t2", title: "Send the revised proposal", kind: "email", priority: "high", due: "2026-11-12", owner: "omar", done: false },
  { id: "t3", title: "Product demo with the ops team", kind: "meeting", priority: "medium", due: "2026-11-13", owner: "lina", done: false },
  { id: "t4", title: "Discovery call with a new lead", kind: "call", priority: "medium", due: "2026-11-13", owner: "yusuf", done: false },
  { id: "t5", title: "Update close dates in the pipeline", kind: "todo", priority: "low", due: "2026-11-14", owner: "noor", done: false },
  { id: "t6", title: "Contract review with legal", kind: "meeting", priority: "high", due: "2026-11-15", owner: "omar", done: false },
  { id: "t7", title: "Quarterly business review invite", kind: "email", priority: "low", due: "2026-11-17", owner: "lina", done: false },
  { id: "t8", title: "Thank-you note after signing", kind: "email", priority: "low", due: "2026-11-10", owner: "yusuf", done: true },
  { id: "t9", title: "Share the case study deck", kind: "todo", priority: "medium", due: "2026-11-12", owner: "noor", done: true },
];

export const activity = [
  { id: "a1", who: "lina", text: { en: "moved Clinic network licence to Proposal", ar: "نقلت ترخيص شبكة العيادات إلى العرض" }, when: { en: "12 min ago", ar: "قبل 12 دقيقة" } },
  { id: "a2", who: "omar", text: { en: "won Studio seats x40", ar: "ربح صفقة مقاعد الاستوديو ×40" }, when: { en: "1 h ago", ar: "قبل ساعة" } },
  { id: "a3", who: "noor", text: { en: "added a note to Fleet tracking rollout", ar: "أضافت ملاحظة إلى نظام تتبع الأسطول" }, when: { en: "3 h ago", ar: "قبل 3 ساعات" } },
  { id: "a4", who: "yusuf", text: { en: "scheduled a call with Oasis Retail", ar: "حدد مكالمة مع واحة للتجزئة" }, when: { en: "Yesterday", ar: "أمس" } },
];
