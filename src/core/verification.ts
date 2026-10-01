import type {Mission} from "./types.js";
import type {VerificationResult} from "./contracts.js";

type Operator="=="|"!="|">="|"<="|">"|"<"|"contains";

function readPath(value:unknown,path:string):unknown{
 let current=value;
 for(const segment of path.split(".")){
  if(segment==="length"){
   if(typeof current==="string"||Array.isArray(current)) current=current.length;
   else return undefined;
   continue;
  }
  if(!current||typeof current!=="object"||!(segment in current)) return undefined;
  current=(current as Record<string,unknown>)[segment];
 }
 return current;
}

function parseLiteral(value:string):unknown{
 const trimmed=value.trim();
 if(trimmed==="true")return true;
 if(trimmed==="false")return false;
 if(trimmed==="null")return null;
 if(/^-?\d+(?:\.\d+)?$/.test(trimmed))return Number(trimmed);
 try{return JSON.parse(trimmed);}catch{return trimmed.replace(/^["']|["']$/g,"");}
}

function compare(actual:unknown,operator:Operator,expected:unknown):boolean{
 switch(operator){
  case "==": return JSON.stringify(actual)===JSON.stringify(expected);
  case "!=": return JSON.stringify(actual)!==JSON.stringify(expected);
  case "contains":
   if(typeof actual==="string"&&typeof expected==="string")return actual.includes(expected);
   if(Array.isArray(actual))return actual.some(item=>JSON.stringify(item)===JSON.stringify(expected));
   return false;
  case ">=": return typeof actual==="number"&&typeof expected==="number"&&actual>=expected;
  case "<=": return typeof actual==="number"&&typeof expected==="number"&&actual<=expected;
  case ">": return typeof actual==="number"&&typeof expected==="number"&&actual>expected;
  case "<": return typeof actual==="number"&&typeof expected==="number"&&actual<expected;
 }
}

function evaluateCriterion(result:unknown,criterion:string):{ok:boolean;failure?:string}{
 const match=criterion.trim().match(/^result\.([A-Za-z0-9_.]+)\s*(==|!=|>=|<=|>|<|contains)\s*(.+)$/);
 if(!match)return{ok:false,failure:`Unsupported success criterion: ${criterion}. Use result.<path> <operator> <value>.`};
 const path=match[1];
 const operator=match[2];
 const rawExpected=match[3];
 if(!path||!operator||rawExpected===undefined)return{ok:false,failure:`Unsupported success criterion: ${criterion}.`};
 const actual=readPath(result,path);
 if(actual===undefined)return{ok:false,failure:`Success criterion path not found: result.${path}.`};
 const expected=parseLiteral(rawExpected);
 if(!compare(actual,operator as Operator,expected))return{ok:false,failure:`Success criterion failed: ${criterion} (actual=${JSON.stringify(actual)}).`};
 return{ok:true};
}

export class VerificationEngine {
 verify(mission:Mission,result?:unknown,successCriteria:string[]=[]):VerificationResult {
  const failures:string[]=[];
  const checks:string[]=["mission exists","mission has goal","mission has execution plan"];
  if(!mission.goal.trim()) failures.push("Mission goal is empty.");
  if(mission.steps.length===0) failures.push("Mission has no steps.");
  const executionStep=mission.steps.find(step=>step.description.startsWith("Execute"));
  if(executionStep && executionStep.status!=="completed") failures.push("Execution step is not completed.");
  if(successCriteria.some(criteria=>!criteria.trim())) failures.push("Success criteria contains an empty item.");
  if(result===null||result===undefined) failures.push("Execution returned no result.");
  for(const criterion of successCriteria.filter(item=>item.trim())){
   const evaluated=evaluateCriterion(result,criterion);
   checks.push(`success criterion: ${criterion}`);
   if(!evaluated.ok&&evaluated.failure) failures.push(evaluated.failure);
  }
  return {verified:failures.length===0,checks,failures};
 }
}
