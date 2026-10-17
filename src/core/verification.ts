import type {Mission} from "./types.js";
import type {VerificationResult} from "./contracts.js";

type Comparable=string|number|boolean|null;

/**
 * A plan step that does the work. Plans written by local models are often in Arabic or use
 * verbs like "write" or "fix"; only matching execute/run/perform/action marked real, completed
 * work as failed. Planning-only steps ("Understand goal") still do not count.
 */
export const EXECUTION_STEP=/\b(execute|run|perform|action|write|create|build|fix|implement|update|modify|edit|install|apply|generate|send|publish|deploy|delete|commit|push|open|click|type|search|collect|research|analy[sz]e|inspect|test|check|schedule|post|upload|download|take|capture)|تنفيذ|نفذ|نفّذ|شغل|شغّل|تشغيل|إجراء|اجراء|اكتب|كتابة|أنشئ|انشئ|إنشاء|انشاء|عدّل|عدل|تعديل|أصلح|اصلح|إصلاح|اصلاح|ابن|بناء|ثبّت|ثبت|تثبيت|أرسل|ارسل|إرسال|ارسال|انشر|نشر|افتح|فتح|ابحث|بحث|حلل|حلّل|تحليل|افحص|فحص|اختبر|اختبار|التقط|جدول|ارفع|رفع/i;


/**
 * Early loop completion must only use explicit, machine-checkable result criteria.
 * Descriptive criteria ("finished") and presence-only aliases ("done"/"echo") are too
 * broad for an early stop because any intermediate read/inspection tool returns a result.
 */
export function hasExplicitSuccessCriteria(criteria:string[]):boolean {
  if(!criteria.length)return false;
  let hasResultAssertion=false;
  for(const criterion of criteria){
    const text=criterion.trim();
    if(!text)return false;
    const normalized=text.toLowerCase();
    if(["mission exists","mission has goal","mission has execution plan"].includes(normalized))continue;
    if(/^approved$/i.test(text)){hasResultAssertion=true;continue;}
    if(/^result(?:\.|\s)/i.test(text)){hasResultAssertion=true;continue;}
    return false;
  }
  return hasResultAssertion;
}

export class VerificationEngine {
  verify(mission:Mission,result?:unknown,successCriteria:string[]=[]):VerificationResult {
    const failures:string[]=[];
    const checks:string[]=["mission exists","mission has goal","mission has execution plan","execution result satisfies success criteria"];
    if(!mission.goal.trim()) failures.push("Mission goal is empty.");
    if(mission.steps.length===0) failures.push("Mission has no steps.");
    const executionStep=mission.steps.find(step=>EXECUTION_STEP.test(step.description));
    if(!executionStep) failures.push("Mission has no execution step.");
    else if(executionStep.status!=="completed") failures.push("Execution step is not completed.");
    if(successCriteria.some(criteria=>!criteria.trim())) failures.push("Success criteria contains an empty item.");
    if(result===null||result===undefined) failures.push("Execution returned no result.");
    if(failures.length===0){
      for(const criteria of successCriteria){
        const text=criteria.trim().toLowerCase();
        if(text==="mission exists"||text==="mission has goal"||text==="mission has execution plan")continue;
        const evaluation=this.evaluateCriterion(criteria,result);
        if(!evaluation.supported||!evaluation.matched) failures.push(evaluation.reason);
      }
    }
    return {verified:failures.length===0,checks,failures};
  }

  private evaluateCriterion(criteria:string,result:unknown):{supported:boolean;matched:boolean;reason:string}{
    const text=criteria.trim();
    if(text==="done"||text==="echo")return{supported:true,matched:result!==null&&result!==undefined,reason:result!==null&&result!==undefined?"":`Success criterion failed: ${text}`};
    if(text==="approved"){const actual=this.readPath(result,"approved");return{supported:true,matched:actual===true,reason:actual===true?"":"Success criterion failed: approved"};}
    // A bare result path is an existence assertion, not a free-form phrase.
    // This supports planner criteria such as result.system / result.providers while keeping
    // missing or null fields a hard verification failure.
    const pathOnly=/^result\.([A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*)$/i.exec(text);
    if(pathOnly){
      const actual=this.readPath(result,pathOnly[1]);
      const matched=actual!==null&&actual!==undefined;
      return{supported:true,matched,reason:matched?"":`Success criterion failed: ${text} (value is missing or null)`};
    }
    const equality=/^result(?:\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*))?\s*(===|==|!==|!=)\s*(.+)$/i.exec(text);
    if(equality){
      const actual=this.readPath(result,equality[1]??"");
      const expected=this.parseLiteral(equality[3]??"");
      if(!expected.supported)return{supported:false,matched:false,reason:`Unsupported success criterion: ${text}`};
      // Match JavaScript-style nullish comparison for == null / != null, but keep strict operators strict.
      const looseNull=(equality[2]==="=="||equality[2]==="!=")&&expected.value===null;
      const equal=looseNull?(actual===null||actual===undefined):this.same(actual,expected.value);
      const matched=equality[2]==="==="||equality[2]==="=="?equal:!equal;
      return{supported:true,matched,reason:matched?"":`Success criterion failed: ${text} (actual=${JSON.stringify(actual)})`};
    }
    const comparison=/^result(?:\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*))?\s*(>=|<=|>|<)\s*(-?(?:\d+\.?\d*|\.\d+))$/i.exec(text);
    if(comparison){
      const actual=this.readPath(result,comparison[1]??"");
      const expected=Number(comparison[3]);
      if(typeof actual!=="number"||!Number.isFinite(actual))return{supported:true,matched:false,reason:`Success criterion failed: ${text} (actual is not numeric)`};
      const op=comparison[2];
      const matched=op===">"?actual>expected:op===">="?actual>=expected:op==="<"?actual<expected:actual<=expected;
      return{supported:true,matched,reason:matched?"":`Success criterion failed: ${text} (actual=${actual})`};
    }
    const contains=/^result(?:\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*))?\s+contains\s+(.+)$/i.exec(text);
    if(contains){
      const actual=this.readPath(result,contains[1]??"");
      const expected=this.parseLiteral(contains[2]??"");
      if(!expected.supported)return{supported:false,matched:false,reason:`Unsupported success criterion: ${text}`};
      const matched=typeof actual==="string"&&typeof expected.value==="string"?actual.includes(expected.value):Array.isArray(actual)?actual.some(item=>this.same(item,expected.value)):false;
      return{supported:true,matched,reason:matched?"":`Success criterion failed: ${text}`};
    }
    const length=/^result(?:\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*))?\.(?:length|count)\s*(===|==|!==|!=|>=|<=|>|<)\s*(\d+)$/i.exec(text);
    if(length){
      const actual=this.readPath(result,length[1]??"");
      const size=typeof actual==="string"||Array.isArray(actual)?actual.length:undefined;
      if(size===undefined)return{supported:true,matched:false,reason:`Success criterion failed: ${text} (value has no length)`};
      const expected=Number(length[3]);
      const op=length[2];
      const matched=op==="=="||op==="==="?size===expected:op==="!="||op==="!=="?size!==expected:op===">"?size>expected:op===">="?size>=expected:op==="<"?size<expected:size<=expected;
      return{supported:true,matched,reason:matched?"":`Success criterion failed: ${text} (actual=${size})`};
    }
    const exists=/^result(?:\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*))?\s+(exists|is present|is not empty)$/i.exec(text);
    if(exists){
      const actual=this.readPath(result,exists[1]??"");
      const present=actual!==null&&actual!==undefined&&!(exists[2]!.toLowerCase()==="is not empty"&&(actual===""||(Array.isArray(actual)&&!actual.length)));
      return{supported:true,matched:present,reason:present?"":`Success criterion failed: ${text}`};
    }
    // Formula-looking text with an unknown operator is a mistake, not a sentence: keep it strict.
    if(/^result\b/i.test(text))return{supported:false,matched:false,reason:`Unsupported success criterion: ${text}`};
    return this.descriptive(text,result);
  }

  /**
   * Plain-language criteria ("the file is created", "تم إنشاء الملف") cannot be evaluated literally.
   * They pass only when the final result shows no failure: present, ok !== false, exit code 0, no error.
   */
  private descriptive(text:string,result:unknown):{supported:boolean;matched:boolean;reason:string}{
    if(result===null||result===undefined)return{supported:true,matched:false,reason:`Success criterion failed: ${text} (no result)`};
    if(typeof result==="object"&&!Array.isArray(result)){
      const r=result as Record<string,unknown>;
      if(r.ok===false)return{supported:true,matched:false,reason:`Success criterion failed: ${text} (result reports ok=false)`};
      if(typeof r.exitCode==="number"&&r.exitCode!==0)return{supported:true,matched:false,reason:`Success criterion failed: ${text} (exit code ${r.exitCode})`};
      if(typeof r.error==="string"&&r.error.trim())return{supported:true,matched:false,reason:`Success criterion failed: ${text} (${r.error.slice(0,160)})`};
    }
    return{supported:true,matched:true,reason:""};
  }

  private readPath(value:unknown,path?:string):unknown{
    if(!path)return value;
    let current=value;
    for(const key of path.split(".")){
      if(!current||typeof current!=="object"||!(key in (current as unknown as Record<string,unknown>)))return undefined;
      current=(current as Record<string,unknown>)[key];
    }
    return current;
  }

  private parseLiteral(raw:string):{supported:boolean;value:Comparable}{
    const value=raw.trim();
    if(value==="null")return{supported:true,value:null};
    if(value==="true")return{supported:true,value:true};
    if(value==="false")return{supported:true,value:false};
    if(/^[-+]?\d+(?:\.\d+)?$/.test(value))return{supported:true,value:Number(value)};
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))return{supported:true,value:value.slice(1,-1)};
    return{supported:false,value:null};
  }

  private same(actual:unknown,expected:Comparable):boolean{
    return actual===expected;
  }
}
