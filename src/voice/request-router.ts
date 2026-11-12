import {normalizeArabic} from "../providers/tool-selection.js";
import {classifyDialogue} from "./dialogue-brain.js";
import {asksProjectStatus,classifyProjectWork} from "./project-intent.js";
import {storeChangeRequest,storeReportRequest} from "../business/woocommerce.js";
import {shippingIntent} from "../business/store-shipping.js";
import {socialIntent} from "../business/social-posting.js";

/**
 * One router for every entry point (Control Center chat, voice, the assistant turn). Before this, the Control Center knew only
 * "conversation or action" and sent whole projects to the one-off agent with ten steps, while voice sent them to the
 * supervisor that builds and repairs with checks. Measured on 43 requests worded like the owner's (tests/fixtures/owner-requests.ts):
 * Control Center 20/43, voice 34/43. No model is asked: the rules are cheap, explainable and measured; anything unclear stays
 * a conversation, which never executes anything.
 */
export type Route="answer"|"task"|"project-build"|"project-repair"|"project-status";
export interface RouteDecision{route:Route;reason:string;work?:"build"|"repair"}

const clean=(text:string)=>normalizeArabic(String(text||"")).toLowerCase().replace(/[؟?!،,.؛:]+/g," ").replace(/\s+/g," ").trim();
// Things a project produces. Arabic has no \b in JS regexes, so word edges are spaces or the string's ends.
const PROJECT_NOUN=/(?:^|\s|ب|ل)(?:ال)?(?:مشروع|تطبيق|موقع|برنامج|لعبه|متجر|منصه|خادم|سيرفر|صفحه|حاسبه|اداه|سكربت|لوحه تحكم|بوت)(?:ي|نا|ه|ك)?(?=\s|$)|\b(?:project|app|application|website|site|web app|game|store|dashboard|server|api|script|tool|bot|landing page)\b/u;
// Owner wordings of "I want you to make": dialect desire + making verb or a noun for the owner ("أبغى موقع لمطعمي").
const WANT=/^(?:ابغي|ابغا|ابي|اريد|بدي|ودي|محتاج|احتاج|i want|i need|i'd like)\s/u;
const POLITE_MAKE=/^(?:ممكن|تقدر|لو سمحت|من فضلك|please|could you|can you)\s+(?:تسوي|تعمل|تبني|تصمم|تطور|تنشئ|build|make|create|develop)\s+(?:لي|لنا|me|us)\s/u;
const MAKE=/(?:^|\s)(?:قم\s+ب(?:بناء|انشاء|عمل|تطوير|تصميم)|ابن|انشئ|اصنع|صمم|طور|اعمل|سوي|build|create|make|develop)\s/u;
// A fault described in the owner's words, then a request to fix it anywhere in the sentence.
const FAULT=/(?:عطل|خطا|مشكله|يعلق|معلق|ما\s+(?:تفتح|يفتح|يشتغل|تشتغل|يحفظ|يعمل|تعمل)|لا\s+(?:تفتح|يفتح|يعمل|تعمل)|يطلع\s+خطا|crash|crashes|fails|broken|bug|error|doesn'?t work|not working)/u;
const FIX=/(?:^|\s)و?(?:اصلح|اصلحه|اصلحها|صلح|صلحه|صلحها|عالج|عالجه|عالجها|fix|repair|debug)(?=\s|$)/u;
const STATUS_MORE=/(?:كيف|وش|شو|ايش)\s+(?:ماشي|صار|الوضع\s+في|اخبار).{0,12}(?:مشروع|تطبيق|موقع)|\bhow(?:'s| is) (?:the|my) (?:project|app|site) going\b/u;
const QUESTION_START=/^(?:هل|ما|ماذا|ماهي|مالذي|لماذا|ليش|كيف|متي|اين|وين|كم|اي|ايش|وش|شو|who|what|why|how|where|when|which|is|are|does|do)\s/u;

export function routeRequest(text:string):RouteDecision{
  const v=clean(text);
  if(!v)return{route:"answer",reason:"empty"};
  if(asksProjectStatus(text)||STATUS_MORE.test(v))return{route:"project-status",reason:"asks how the project is going"};
  const work=classifyProjectWork(text);
  if(work)return{route:work==="build"?"project-build":"project-repair",work,reason:"command to "+work+" a project"};
  // "The app freezes when I open settings, find the cause and fix it": a fault and a fix request, in either order.
  if(FIX.test(v)&&(FAULT.test(v)||PROJECT_NOUN.test(v))&&!QUESTION_START.test(v))return{route:"project-repair",work:"repair",reason:"describes a fault and asks for a fix"};
  // "أبغى موقع لمطعمي", "ممكن تسوي لي تطبيق": a request for something made for the owner. "هل يمكنك بناء موقع؟" stays a question.
  if(PROJECT_NOUN.test(v)&&(WANT.test(v)||POLITE_MAKE.test(v)||MAKE.test(v)&&!QUESTION_START.test(v)))return{route:"project-build",work:"build",reason:"asks for something to be made"};
  // "How many orders today in my store?" is a question about the owner's own data: a chat model has none and would invent
  // numbers, so it is a task that reads the store (store.report), or one approved change (store.change).
  if(socialIntent(text))return{route:"task",reason:"asks for a social post or to publish it"};
  if(shippingIntent(text))return{route:"task",reason:"asks about shipments or invoices"};
  if(storeChangeRequest(text))return{route:"task",reason:"asks to change the owner's store"};
  if(storeReportRequest(text))return{route:"task",reason:"asks about the owner's store data"};
  const dialogue=classifyDialogue(text);
  return dialogue.kind==="action"?{route:"task",reason:dialogue.reason}:{route:"answer",reason:dialogue.reason};
}
