/**
 * LayanX bundles many roles (developer assistant, social publisher, ads
 * manager, store operator, Quran publisher, email, trading research...).
 * Registering every tool for every install makes small local models choose
 * badly and widens the attack surface. Each group can be switched on/off from
 * the setup page; the runtime checks `capabilityEnabled()` before registering.
 */
export const CAPABILITY_GROUPS={
  coding:"مساعد البرمجة (ملفات، طرفية، Git، اختبارات)",
  desktop:"التحكم بسطح المكتب (الشاشة، الفأرة، لوحة المفاتيح)",
  research:"البحث في الإنترنت (Agent Reach، المتصفح)",
  social:"النشر على وسائل التواصل",
  ads:"إدارة الإعلانات المدفوعة",
  business:"المتاجر والطلبات والمحتوى",
  email:"البريد وGoogle Workspace",
  quran:"ناشر فيديوهات القرآن",
  voice:"الواجهة الصوتية",
  trading:"تحليل التداول"
} as const;

export type CapabilityGroup=keyof typeof CAPABILITY_GROUPS;
export const ALL_CAPABILITIES=Object.keys(CAPABILITY_GROUPS) as CapabilityGroup[];

export function parseCapabilities(raw:string|undefined):Set<CapabilityGroup>{
  const value=(raw??"all").trim().toLowerCase();
  if(value===""||value==="all")return new Set(ALL_CAPABILITIES);
  if(value==="none")return new Set();
  const set=new Set<CapabilityGroup>();
  for(const item of value.split(",").map(v=>v.trim()))
    if((ALL_CAPABILITIES as string[]).includes(item))set.add(item as CapabilityGroup);
  return set;
}

export function capabilityEnabled(group:CapabilityGroup,env:NodeJS.ProcessEnv=process.env):boolean{
  return parseCapabilities(env.LAYANX_CAPABILITIES).has(group);
}

export function serializeCapabilities(enabled:Partial<Record<CapabilityGroup,boolean>>):string{
  const on=ALL_CAPABILITIES.filter(group=>enabled[group]!==false);
  if(on.length===ALL_CAPABILITIES.length)return "all";
  return on.length?on.join(","):"none";
}
