import type {Mission} from "./types.js";
import type {VerificationResult} from "./contracts.js";

type Comparable=string|number|boolean|null;

export class VerificationEngine {
  verify(mission:Mission,result?:unknown,successCriteria:string[]=[]):VerificationResult {
    const failures:string[]=[];
    const checks:string[]=["mission exists","mission has goal","mission has execution plan","execution result satisfies success criteria"];
    if(!mission.goal.trim()) failures.push("Mission goal is empty.");
    if(mission.steps.length===0) failures.push("Mission has no steps.");
    const executionStep=mission.steps.find(step=>/execute|run|perform|action/i.test(step.description));
    if(!executionStep) failures.push("Mission has no execution step.");
    else if(executionStep.status!=="completed") failures.push("Execution step is not completed.");
    if(successCriteria.some(criteria=>!criteria.trim())) failures.push("Success criteria contains an empty item.");
    if(result===null||result===undefined) failures.push("Execution returned no result.");
    if(failures.length===0){
      for(const criteria of successCriteria){
        const evaluation=this.evaluateCriterion(criteria,result);
        if(!evaluation.supported||!evaluation.matched) failures.push(evaluation.reason);
      }
    }
    return {verified:failures.length===0,checks,failures};
  }

  private evaluateCriterion(criteria:string,result:unknown):{supported:boolean;matched:boolean;reason:string}{
    const text=criteria.trim();
    const equality=/^result(?:\.([A-Za-z_$][\w$]*))?\s*(===|==|!==|!=)\s*(.+)$/i.exec(text);
    if(equality){
      const actual=this.readPath(result,equality[1]??"");
      const expected=this.parseLiteral(equality[3]??"");
      if(!expected.supported)return{supported:false,matched:false,reason:`Unsupported success criterion: ${text}`};
      const equal=this.same(actual,expected.value);
      const matched=equality[2]==="==="||equality[2]==="=="?equal:!equal;
      return{supported:true,matched,reason:matched?"":`Success criterion failed: ${text} (actual=${JSON.stringify(actual)})`};
    }
    const comparison=/^result(?:\.([A-Za-z_$][\w$]*))?\s*(>=|<=|>|<)\s*(-?(?:\d+\.?\d*|\.\d+))$/i.exec(text);
    if(comparison){
      const actual=this.readPath(result,comparison[1]??"");
      const expected=Number(comparison[3]);
      if(typeof actual!=="number"||!Number.isFinite(actual))return{supported:true,matched:false,reason:`Success criterion failed: ${text} (actual is not numeric)`};
      const op=comparison[2];
      const matched=op===">"?actual>expected:op===">="?actual>=expected:op===">"?actual>expected:actual<=expected;
      return{supported:true,matched,reason:matched?"":`Success criterion failed: ${text} (actual=${actual})`};
    }
    const contains=/^result(?:\.([A-Za-z_$][\w$]*))?\s+contains\s+(.+)$/i.exec(text);
    if(contains){
      const actual=this.readPath(result,contains[1]??"");
      const expected=this.parseLiteral(contains[2]??"");
      if(!expected.supported)return{supported:false,matched:false,reason:`Unsupported success criterion: ${text}`};
      const matched=typeof actual==="string"&&typeof expected.value==="string"?actual.includes(expected.value):Array.isArray(actual)?actual.some(item=>this.same(item,expected.value)):false;
      return{supported:true,matched,reason:matched?"":`Success criterion failed: ${text}`};
    }
    const length=/^result(?:\.([A-Za-z_$][\w$]*))?\.(?:length|count)\s*(===|==|!==|!=|>=|<=|>|<)\s*(\d+)$/i.exec(text);
    if(length){
      const actual=this.readPath(result,length[1]??"");
      const size=typeof actual==="string"||Array.isArray(actual)?actual.length:undefined;
      if(size===undefined)return{supported:true,matched:false,reason:`Success criterion failed: ${text} (value has no length)`};
      const expected=Number(length[3]);
      const op=length[2];
      const matched=op==="=="||op==="==="?size===expected:op==="!="||op==="!=="?size!==expected:op===">"?size>expected:op===">="?size>=expected:op==="<"?size<expected:size<=expected;
      return{supported:true,matched,reason:matched?"":`Success criterion failed: ${text} (actual=${size})`};
    }
    return{supported:false,matched:false,reason:`Unsupported success criterion: ${text}`};
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
