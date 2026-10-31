/**
 * Dialogue Brain: shared deterministic input guard and output quality gate for
 * /voice and Control Center. No model-generated text can authorize a tool call.
 *
 * This is a conservative semantic gate, NOT a general-purpose language model.
 * Explicit instructions are allowed through the existing approval-gated agent.
 * Questions and ambiguous statements are conversation, not autonomous work.
 */
import {normalizeArabic} from "../providers/tool-selection.js";

export type DialogueKind="conversation"|"action";
export type DialogueTopic="identity"|"self-development"|"question"|"greeting"|"instruction"|"unclear";
export interface DialogueDecision{kind:DialogueKind;topic:DialogueTopic;reason:string}

function normalized(text:string):string{
 return normalizeArabic(String(text||""))
  .toLowerCase()
  .replace(/[؟?!،,.؛:]+/g," ")
  .replace(/\s+/g," ").trim();
}
function stripName(text:string):string{
 return text.replace(/^(?:(?:يا )?(?:ليان|layanx|layan x|جارفيس|jarvis)\s+)/u,"").trim();
}
const IDENTITY=/^(?:من انت|من تكون|ما اسمك|ما هو اسمك|عرفني بنفسك|تكلم عن نفسك|who are you|what is your name|tell me about yourself)$/u;
const LEARNING=/^(?:هل (?:تتعلم|تطور|تستطيع تعلم|تستطيع تطوير|يمكنك تطوير|بامكانك تطوير|تقدر تطور)(?: و?تطور)?(?: من نفسك| نفسك| ذاتيا)?|هل يمكنك (?:ان )?تطور نفسك|هل تستطيع (?:ان )?تطور نفسك|هل (?:تتعلم وتطور|تتعلم و تطور) من نفسك|do you learn(?: on your own| by yourself)?|can you (?:learn|improve|develop) yourself|can you improve your own code|do you improve yourself)$/u;
const ACTION=/^(?:قم|اريد منك|اريدك|ابد[اأ]|اكمل|تابع|اصلح|انش[ئيأ]|صمم|اكتب|افتح|شغل|نفذ|اعرض|استخرج|ابحث|تحقق|اختبر|راجع|حدث|اغلق|ارسل|انشر|سجل|تداول|احجز|حلل|انقل|احفظ|احضر|جهز|طور|ابن|بناء|اضف|اربط|انسخ|حمل|ثبت|اعمل|اذهب|سوي|run|create|build|make|fix|open|start|stop|write|send|publish|deploy|install|test|check|show|list|find|inspect|review|update|delete|remove|generate|commit|merge|push|pull|place|book|order)(?:\s|$)/iu;
const GREETING=/^(?:مرحبا|اهلا|هلا|السلام عليكم|صباح الخير|مساء الخير|hi|hey|hello|good morning|good evening|thanks|شكرا)(?:\s+(?:كيف الحال|كيف حالك|وسهلا|ورحمه الله|لك))?$/iu;
function startsWithQuestion(t:string):boolean{
 return /^(?:هل|من|ما|ماذا|ماهي|مالذي|لماذا|ليش|كيف|متي|اين|وين|كم|اي|ايش|وش)(?:\s|$)/u.test(t)
 || /^(?:who|what|why|how|where|when|which|can|could|do|are|is|does|will|would)(?:\s|$)/u.test(t);
}
export function classifyDialogue(text:string):DialogueDecision{
 const source=String(text||"").trim();
 const v=stripName(normalized(source));
 if(!v)return{kind:"conversation",topic:"unclear",reason:"empty"};
 if(IDENTITY.test(v))return{kind:"conversation",topic:"identity",reason:"identity_question"};
 if(LEARNING.test(v))return{kind:"conversation",topic:"self-development",reason:"self_development_question"};
 if(GREETING.test(v))return{kind:"conversation",topic:"greeting",reason:"small_talk"};
 const afterGreeting=v.replace(/^(?:مرحبا|اهلا|هلا|السلام عليكم|hi|hey|hello|شكرا)\s+/u,"").trim();
 if(afterGreeting!==v&&ACTION.test(afterGreeting))return{kind:"action",topic:"instruction",reason:"greeting_followed_by_command"};
 if(afterGreeting!==v&&startsWithQuestion(afterGreeting))return{kind:"conversation",topic:"question",reason:"greeting_followed_by_question"};
 // Two clear clauses, including an imperative, must retain the explicit action.
 // A bare question such as 'هل يمكنك إنشاء موقع؟' never executes anything.
 const hasInstructionInSecondClause=/\s(?:و|ثم)\s*(?:افتح|اكتب|ارسل|انشر|انشئ|صمم|نفذ|شغل|اصلح|قم)\s/u.test(v);
 if(hasInstructionInSecondClause&&startsWithQuestion(v))return{kind:"action",topic:"instruction",reason:"explicit_mixed_command"};
 if(startsWithQuestion(v))return{kind:"conversation",topic:"question",reason:"interrogative"};
 if(ACTION.test(v))return{kind:"action",topic:"instruction",reason:"explicit_command"};
 if(/[؟?]\s*$/.test(source))return{kind:"conversation",topic:"question",reason:"question_mark"};
 return{kind:"conversation",topic:"unclear",reason:"no_explicit_command"};
}

export function directDialogueAnswer(topic:DialogueTopic,lang:"ar"|"en"):string|null{
 if(topic==="identity")return lang==="ar"
  ?"أنا LayanX، مساعد ذكاء اصطناعي يعمل على حاسوبك. أساعدك في الأسئلة والمشاريع والمهام، لكنني لا أنفذ إجراءً إلا وفق الصلاحيات المتاحة."
  :"I'm LayanX, an AI assistant running on your computer. I help with questions and projects; actions use the permissions you grant.";
 if(topic==="self-development")return lang==="ar"
  ?"أستطيع مراجعة كود LayanX واقتراح تطويره وكتابة تعديلات واختبارها إذا طلبت ذلك وأُتيحت الصلاحيات. لكنني لا أعيد تدريب النموذج بنفسي ولا أعدّل النظام تلقائيًا دون مراجعة وموافقة."
  :"I can review and propose improvements to LayanX, edit code and run tests when requested and authorized. I do not retrain the model or modify myself automatically without review and approval.";
 return null;
}
export function reviewDialogueAnswer(question:string,reply:string):{ok:boolean;reason:string}{
 const answer=String(reply||"").trim();
 if(answer.length<8)return{ok:false,reason:"empty_or_too_short"};
 const v=normalized(answer),q=normalized(question);
 if(v===q)return{ok:false,reason:"parroted_question"};
 // Reject stock non-answers. An answer should actually address the question.
 if(/^(?:حسنا|تمام|حاضر|okay|ok|sure|كيف اقدر اساعدك|كيف يمكنني مساعدتك|هل هناك اي شيء يمكنني فعله|هل هناك شيء يمكنني فعله|how can i help you|how can i help|what can i do for you|is there anything i can do)(?:\s+(?:لك|اليوم|الان|please))?$/iu.test(v))
  return{ok:false,reason:"generic_non_answer"};
 // A conversational reply without a completed mission must not invent action receipts.
 if(/^(?:تم (?:انشاء|حذف|ارسال|نشر|تنفيذ|فتح)|انجزت|نفذت|ارسلت|نشرت|حذفت|i (?:have |already )?(?:sent|deleted|created|published|completed|done)|done i (?:sent|deleted|created))/iu.test(v))
  return{ok:false,reason:"unsupported_completion_claim"};
 return{ok:true,reason:"answer_accepted"};
}
