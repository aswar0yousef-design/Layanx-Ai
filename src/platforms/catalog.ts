import type {McpServerConfig} from "../mcp/manager.js";

/**
 * The platforms LayanX works on for websites, in one list. Each one connects in exactly one way,
 * on top of what LayanX already has, never a second copy of it:
 *
 *   existing  already in LayanX (Claude as a cloud model and Claude Code as a coding agent)
 *   native    LayanX's own tools against the platform's REST API (Vercel: its official MCP
 *             server only admits clients Vercel approved, so a token + REST API is the way)
 *   mcp       the platform's official MCP server, pinned, run through the existing MCP manager
 *             (owner approval, secrets passed to that server only, every tool dangerous unless
 *             listed in safeTools)
 *
 * GitHub is both: the existing git.* / github.* tools, plus the official server for what they
 * lack (Actions: CI runs and their logs), with the same GITHUB_TOKEN.
 * Checked against each platform's own documentation and package registry, 2026-10.
 */
export type PlatformId="github"|"vercel"|"hostinger"|"cloudflare"|"netlify"|"supabase"|"context7"|"claude";
export type PlatformCategory="code"|"hosting"|"dns"|"database"|"docs"|"ai";
export interface PlatformSecret{
  name:string;
  /** Where the owner creates it. */
  createUrl:string;
  /** What to tick when creating it. */
  scopes:{ar:string;en:string};
  optional?:boolean;
  /** Also used by other parts of LayanX: disconnecting never deletes it. */
  shared?:boolean;
}
export interface PlatformEntry{
  id:PlatformId;
  label:string;
  category:PlatformCategory;
  about:{ar:string;en:string};
  via:Array<"existing"|"native"|"mcp">;
  secrets:PlatformSecret[];
  /** Server config added to the MCP manager on connect (id is the MCP server id). */
  mcp?:Omit<McpServerConfig,"enabled"|"approved"|"addedAt"|"approvedAt">;
  /** Tools LayanX itself provides for this platform (prefixes end with "."). */
  tools:string[];
  /** For "existing" platforms: which secret or tool makes it active. */
  activeWhen?:{anySecret?:string[];tool?:string};
  docs:string;
}

const GITHUB_TOKEN:PlatformSecret={name:"GITHUB_TOKEN",createUrl:"https://github.com/settings/personal-access-tokens/new",shared:true,
  scopes:{ar:"Fine-grained: اختر المستودعات، ثم Contents وPull requests وIssues وActions: Read and write، وMetadata: Read.",en:"Fine-grained: pick the repositories, then Contents, Pull requests, Issues and Actions: Read and write; Metadata: Read."}};

export const PLATFORMS:PlatformEntry[]=[
  {id:"github",label:"GitHub",category:"code",via:["existing","mcp"],secrets:[GITHUB_TOKEN],
    about:{ar:"المستودعات والفروع وطلبات الدمج (موجودة)، ومعها GitHub Actions: تشغيلات CI وسجلاتها وإعادة تشغيلها.",en:"Repositories, branches and pull requests (built in), plus GitHub Actions: CI runs, their logs, and re-running them."},
    mcp:{id:"github-actions",name:"GitHub Actions",transport:"http",url:"https://api.githubcopilot.com/mcp/x/actions",envFromSecrets:["GITHUB_TOKEN"],
      safeTools:["actions_list","actions_get","get_job_logs"],source:{registry:"github/github-mcp-server",version:"remote"}},
    tools:["git.","github.","git.publish_pr"],docs:"https://github.com/github/github-mcp-server"},
  {id:"vercel",label:"Vercel",category:"hosting",via:["native"],
    secrets:[{name:"VERCEL_TOKEN",createUrl:"https://vercel.com/account/settings/tokens",scopes:{ar:"اختر النطاق (حسابك أو الفريق) ومدة الصلاحية.",en:"Pick the scope (your account or the team) and an expiry."}},
      {name:"VERCEL_TEAM_ID",createUrl:"https://vercel.com/account",optional:true,scopes:{ar:"اختياري: معرّف الفريق (team_...) من إعدادات الفريق إن كانت المشاريع داخل فريق.",en:"Optional: the team ID (team_...) from the team settings, when the projects belong to a team."}}],
    about:{ar:"المشاريع والنشرات وسجلات البناء، ونشر معاينة من مجلد المشروع، ثم الترقية للإنتاج بموافقتك.",en:"Projects, deployments and build logs; preview deploys from the project folder, then promotion to production with your approval."},
    tools:["vercel."],docs:"https://vercel.com/docs/rest-api"},
  {id:"hostinger",label:"Hostinger",category:"hosting",via:["mcp"],
    secrets:[{name:"HOSTINGER_API_TOKEN",createUrl:"https://hpanel.hostinger.com/profile/api",scopes:{ar:"hPanel ← الملف الشخصي ← API ← إنشاء مفتاح.",en:"hPanel -> Profile -> API -> Generate token."}}],
    about:{ar:"الاستضافة ونشر المواقع من ملف مضغوط، ووردبريس، والدومينات وDNS والـ VPS والبريد. البحث آمن، وكل تنفيذ بموافقتك.",en:"Hosting and site deploys from an archive, WordPress, domains, DNS, VPS and mail. Searching is safe; every execution needs your approval."},
    mcp:{id:"hostinger",name:"Hostinger",transport:"stdio",command:"npx",args:["-p","@hostinger/mcp@3.1.0","hostinger-api-mcp"],envFromSecrets:["HOSTINGER_API_TOKEN"],
      safeTools:["search"],source:{registry:"io.github.hostinger/hostinger-api-mcp",version:"3.1.0",package:"@hostinger/mcp"}},
    tools:[],docs:"https://github.com/hostinger/api-mcp-server"},
  {id:"cloudflare",label:"Cloudflare",category:"dns",via:["mcp"],
    secrets:[{name:"CLOUDFLARE_API_TOKEN",createUrl:"https://dash.cloudflare.com/profile/api-tokens",scopes:{ar:"Custom token بالصلاحيات التي تحتاجها (مثل Zone DNS Edit وCloudflare Pages Edit). بدون تقييد IP.",en:"A custom token with the permissions you need (e.g. Zone DNS Edit, Cloudflare Pages Edit). No client IP filtering."}}],
    about:{ar:"DNS والنطاقات وPages وWorkers والتخزين المؤقت عبر واجهة Cloudflare كاملة، مع بحث في التوثيق.",en:"DNS, zones, Pages, Workers and caching through the whole Cloudflare API, plus documentation search."},
    mcp:{id:"cloudflare",name:"Cloudflare",transport:"http",url:"https://mcp.cloudflare.com/mcp",envFromSecrets:["CLOUDFLARE_API_TOKEN"],
      safeTools:["search","docs"],source:{registry:"cloudflare/mcp",version:"remote"}},
    tools:[],docs:"https://github.com/cloudflare/mcp"},
  {id:"netlify",label:"Netlify",category:"hosting",via:["mcp"],
    secrets:[{name:"NETLIFY_PERSONAL_ACCESS_TOKEN",createUrl:"https://app.netlify.com/user/applications#personal-access-tokens",scopes:{ar:"User settings ← Applications ← New access token.",en:"User settings -> Applications -> New access token."}}],
    about:{ar:"المشاريع والنشر من مجلد المشروع ومتغيرات البيئة والنماذج والسجلات.",en:"Projects, deploys from the project folder, environment variables, forms and logs."},
    mcp:{id:"netlify",name:"Netlify",transport:"stdio",command:"npx",args:["@netlify/mcp@1.19.0"],envFromSecrets:["NETLIFY_PERSONAL_ACCESS_TOKEN"],
      safeTools:["netlify-coding-rules",...["user","deploy","team","project","extension","observability"].map(d=>`netlify-${d}-services-reader`)],source:{registry:"netlify/netlify-mcp",version:"1.19.0",package:"@netlify/mcp"}},
    tools:[],docs:"https://github.com/netlify/netlify-mcp"},
  {id:"supabase",label:"Supabase",category:"database",via:["mcp"],
    secrets:[{name:"SUPABASE_ACCESS_TOKEN",createUrl:"https://supabase.com/dashboard/account/tokens",scopes:{ar:"Account ← Access Tokens ← Generate new token.",en:"Account -> Access Tokens -> Generate new token."}}],
    about:{ar:"قواعد البيانات والجداول والترحيلات والدوال والسجلات وتوصيات الأمان. القراءة آمنة، وكل تعديل بموافقتك.",en:"Databases, tables, migrations, edge functions, logs and security advisors. Reading is safe; every change needs your approval."},
    mcp:{id:"supabase",name:"Supabase",transport:"stdio",command:"npx",args:["@supabase/mcp-server-supabase@0.14.0"],envFromSecrets:["SUPABASE_ACCESS_TOKEN"],
      safeTools:["list_organizations","get_organization","list_projects","get_project","get_project_url","get_publishable_keys","list_tables","list_extensions","list_migrations","list_edge_functions","get_edge_function","list_branches","list_storage_buckets","get_storage_config","get_logs","get_advisors","get_cost","search_docs","generate_typescript_types"],
      source:{registry:"supabase-community/supabase-mcp",version:"0.14.0",package:"@supabase/mcp-server-supabase"}},
    tools:[],docs:"https://github.com/supabase-community/supabase-mcp"},
  {id:"context7",label:"Context7",category:"docs",via:["mcp"],
    secrets:[{name:"CONTEXT7_API_KEY",createUrl:"https://context7.com/dashboard",optional:true,scopes:{ar:"اختياري: يرفع حد الطلبات. يعمل بدونه.",en:"Optional: raises the rate limit. Works without it."}}],
    about:{ar:"توثيق حديث لأي مكتبة (Next.js وReact وTailwind…) أثناء البرمجة، حتى لا يكتب الوكيل كوداً قديماً.",en:"Up-to-date docs for any library (Next.js, React, Tailwind…) while coding, so the agent does not write outdated code."},
    mcp:{id:"context7",name:"Context7",transport:"stdio",command:"npx",args:["@upstash/context7-mcp@4.4.2"],envFromSecrets:["CONTEXT7_API_KEY"],
      safeTools:["resolve-library-id","query-docs"],source:{registry:"upstash/context7",version:"4.4.2",package:"@upstash/context7-mcp"}},
    tools:[],docs:"https://github.com/upstash/context7"},
  {id:"claude",label:"Claude",category:"ai",via:["existing"],
    secrets:[{name:"ANTHROPIC_API_KEY",createUrl:"https://console.anthropic.com/settings/keys",shared:true,scopes:{ar:"مفتاح API من Claude Console (يُدار من صفحة الإعداد ← النماذج السحابية).",en:"An API key from the Claude Console (managed on the setup page -> cloud models)."}}],
    about:{ar:"Claude كنموذج سحابي للمهام الصعبة، وClaude Code كوكيل برمجة خارجي داخل مجلد المشروع. موجودان في LayanX.",en:"Claude as a cloud model for hard tasks, and Claude Code as an external coding agent in the project folder. Both built in."},
    activeWhen:{anySecret:["ANTHROPIC_API_KEY"],tool:"agent.external"},tools:["agent.external"],docs:"https://docs.claude.com"}
];

export function platform(id:string):PlatformEntry{
  const p=PLATFORMS.find(x=>x.id===id);
  if(!p)throw new Error("Unknown platform: "+id);
  return p;
}
/** Secret names every platform uses (for the setup page's list of known secrets). */
export const PLATFORM_SECRETS=[...new Set(PLATFORMS.flatMap(p=>p.secrets.map(s=>s.name)))];
