import {normalizeArabic} from "../providers/tool-selection.js";

/**
 * Recognizes "build this project" and "fix this project" so they reach the supervisor, which verifies and hands work
 * between models. Deliberately narrow: a command verb and a project word are both required, and a question never matches.
 */
export type ProjectWork="build"|"repair";
export interface ProjectJobView{id:string;projectId:string;goal:string;status:string;stepNumber:number;totalSteps:number;step?:string;result?:string;handoffs:number;verified:boolean}
export type ProjectStart={started:ProjectJobView;alreadyRunning?:boolean}|{needsProject:true};

const command=(text:string)=>normalizeArabic(String(text||"")).replace(/[؟?!،,.؛:]+/g," ").replace(/\s+/g," ").trim().replace(/^(?:(?:يا )?(?:ليان|layanx|layan x|جارفيس|jarvis)\s+)/u,"");
const BUILD=/^(?:(?:قم|ابدا)\s+(?:ب)?(?:بناء|انشاء|عمل|تطوير|تصميم)|(?:اريد|اريدك|اريد منك)(?:\s+ان)?\s+(?:تبني|تنشئ|تعمل|تطور|تصمم|تسوي)|ابن|انشئ|انشي|اصنع|صمم|طور|اعمل|سوي|build|create|make|develop|scaffold)(?:\s|$)/iu;
const REPAIR=/^(?:(?:قم|ابدا)\s+(?:ب)?(?:اصلاح|معالجه)|(?:اريد|اريدك|اريد منك)(?:\s+ان)?\s+(?:تصلح|تعالج)|اصلح|عالج|صلح|fix|repair|debug)(?:\s|$)/iu;
const PROJECT=/(?:^|[\sب])(?:ال)?(?:مشروع|تطبيق|موقع|برنامج|لعبه|متجر|منصه|خادم|سيرفر|صفحه|حاسبه|اداه|سكربت)(?:ي|نا|ه)?(?:\s|$)|\bلوحه تحكم\b|\b(?:project|app|application|website|site|web app|game|store|dashboard|server|api|program|calculator|landing page|web page|script|command[- ]line tool|cli)\b/iu;
const FAULT=/(?:^|[\sب])(?:ال)?(?:عطل|خطا|مشكله)(?:\s|$)|\b(?:bug|error|crash)\b/iu;
const QUESTION=/^(?:هل|من|ما|ماذا|ماهي|مالذي|لماذا|ليش|كيف|متي|اين|وين|كم|اي|ايش|وش|who|what|why|how|where|when|which|can|could|do|are|is|does|will|would)(?:\s|$)/iu;
const STATUS=/(?:(?:وين|اين|الي اين|لوين)\s+وصل|ما\s+حاله|ماهي\s+حاله|ماذا\s+حدث\s+(?:في|ل|بال)|شو\s+صار\s+(?:في|ب|بال)).{0,12}(?:مشروع|تطبيق|موقع)|\b(?:project status|status of the project|how is the project|how's the project)\b/iu;
const TASK_APP=/(?:قا[ئي]مه|تطبيق|موقع)\s+(?:ال)?مهام|\b(?:task[- ]?list|todo|to-do|tasks? app)\b/iu;

/** Kept to what the test-first paths can prove. Anything with a backend or another platform takes the general path. */
const OTHER_PLATFORM=/خادم|سيرفر|قاعده بيانات|تسجيل دخول|حسابات|دفع|متجر|منصه|اندرويد|ايفون|جوال|بايثون|\b(?:server|backend|database|login|payment|store|api|android|ios|mobile app|flutter|react|next\.?js|python)\b/iu;
const SITE_KIND=/موقع|صفحه|حاسبه|لعبه|\b(?:website|web ?page|landing page|site|calculator|game|web app)\b/iu;
const TOOL_KIND=/برنامج|اداه|سكربت|سطر الاوامر|\b(?:program|tool|script|command[- ]line|cli)\b/iu;
export type NewProjectKind="task-app"|"static-site"|"node-tool"|"general";
export function newProjectKind(text:string):NewProjectKind{
  const value=command(text);
  if(TASK_APP.test(value))return"task-app";
  if(OTHER_PLATFORM.test(value))return"general";
  return SITE_KIND.test(value)?"static-site":TOOL_KIND.test(value)?"node-tool":"general";
}
export function classifyProjectWork(text:string):ProjectWork|null{
  const value=command(text);
  if(!value||QUESTION.test(value))return null;
  if(BUILD.test(value)&&PROJECT.test(value))return"build";
  if(REPAIR.test(value)&&(PROJECT.test(value)||FAULT.test(value)))return"repair";
  return null;
}
export function asksProjectStatus(text:string):boolean{return STATUS.test(command(text));}
export function isTaskListApp(text:string):boolean{return TASK_APP.test(command(text));}

const shorten=(text:string,max:number)=>{const flat=text.replace(/\s+/g," ").trim();return flat.length>max?flat.slice(0,max)+"…":flat;};
export function projectStartedReply(view:ProjectJobView,lang:"ar"|"en",alreadyRunning=false):string{
  if(alreadyRunning)return lang==="ar"?`هذا المشروع قيد العمل بالفعل، في المجلد ${view.projectId}. اسألني: وين وصل المشروع؟`:`That project is already running, in folder ${view.projectId}. Ask me: what is the project status?`;
  return lang==="ar"
    ?`بدأت العمل، في المجلد ${view.projectId}. لن أعدّه منتهياً إلا بعد نجاح الفحوص، وإذا تعثر نموذج سأنقل العمل إلى غيره. اسألني في أي وقت: وين وصل المشروع؟`
    :`Started, in folder ${view.projectId}. It only counts as done once the checks pass, and if a model gets stuck the work moves to another. Ask me any time: what is the project status?`;
}
export function needsProjectReply(lang:"ar"|"en"):string{
  return lang==="ar"?"أي مشروع تقصد؟ اذكر اسم مجلد المشروع في طلبك أو افتح المشروع أولاً، ولن أعدّل شيئاً قبل أن أعرف المشروع المقصود.":"Which project do you mean? Name its folder or open the project first; I will not change anything until I know which one.";
}
/** Worded from the job's recorded state only. */
export function projectStatusReply(view:ProjectJobView|undefined,lang:"ar"|"en"):string{
  if(!view)return lang==="ar"?"لا يوجد مشروع بدأته بعد.":"No project has been started yet.";
  const ar=lang==="ar",where=ar?`المجلد: ${view.projectId}.`:`Folder: ${view.projectId}.`;
  const moved=view.handoffs?(ar?` انتقل العمل بين النماذج ${view.handoffs} مرة.`:` The work moved between models ${view.handoffs} time(s).`):"";
  switch(view.status){
    case"completed":return(view.verified?(ar?"اكتمل المشروع ونجحت فحوصه الآلية. ":"The project is complete and its automated checks passed. "):(ar?"انتهت المهمة لكن دون إثبات كامل. ":"The job ended without full proof. "))+where+moved;
    case"failed":return(ar?`لم يكتمل المشروع. ${shorten(view.result??"",260)} ما تم وما تبقى في .layanx/HANDOFF.md. `:`The project is not complete. ${shorten(view.result??"",260)} What was done and what remains is in .layanx/HANDOFF.md. `)+where+moved;
    case"budget_exhausted":return(ar?"توقف المشروع قبل اكتماله لانتهاء الوقت المخصص له. ":"The project stopped before finishing because its time ran out. ")+where+moved;
    case"waiting_approval":return(ar?"المشروع متوقف بانتظار موافقتك في لوحة التحكم. ":"The project is waiting for your approval in the Control Center. ")+where+moved;
    default:return(ar?`المشروع قيد العمل، الخطوة ${view.stepNumber} من ${view.totalSteps||"؟"}${view.step?`: ${shorten(view.step,80)}`:""}. `:`The project is in progress, step ${view.stepNumber} of ${view.totalSteps||"?"}${view.step?`: ${shorten(view.step,80)}`:""}. `)+where+moved;
  }
}
