import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";

export function readTaskServerSource(projectRoot:string):string|undefined{
  const target=path.join(projectRoot,"src","server.mjs");
  try{
    const base=fs.realpathSync(projectRoot);
    const realTarget=fs.realpathSync(target);
    const relative=path.relative(base,realTarget);
    if(relative===".."||relative.startsWith(".."+path.sep)||path.isAbsolute(relative)||
       fs.lstatSync(target).isSymbolicLink())return undefined;
    const stat=fs.statSync(target);
    if(!stat.isFile()||stat.size===0||stat.size>512*1024)return undefined;
    return fs.readFileSync(target,"utf8");
  }catch{return undefined;}
}

/** Repair only the observed delete crash, preserving the array shared by the handlers. */
export function repairTaskDeleteAssignment(projectRoot:string,blockers:string[]):string|undefined{
  if(blockers.includes("delete-task: Deleted task still appears in task list")){
    const source=readTaskServerSource(projectRoot);
    if(!source)return undefined;
    // URL segments are strings, while this generated POST handler uses numeric IDs.
    const filter=/(\bconst id = req\.url\.split\('\/'\)\[2\];\s*tasks = tasks\.filter\(task => )task\.id !== id(\);)/g;
    if([...source.matchAll(filter)].length!==1)return undefined;
    return source.replace(filter,"$1String(task.id) !== id$2");
  }
  const failure=blockers.find(blocker=>blocker.startsWith("delete-task:")&&
    blocker.includes("TypeError: Assignment to constant variable."));
  const line=failure&&/\/src\/server\.mjs:(\d+)\r?\n/.exec(failure)?.[1];
  const source=line?readTaskServerSource(projectRoot):undefined;
  if(!source||!line||!/\bconst\s+tasks\s*=/.test(source))return undefined;
  const lines=source.split(/\r?\n/);
  const index=Number(line)-1;
  const statement=/^(\s*)tasks = tasks\.filter\(task => task\.id !== id\);\s*$/.exec(lines[index]??"");
  if(!statement)return undefined;
  lines[index]=statement[1]+"const taskIndex = tasks.findIndex(task => task.id === id);\n"+
    statement[1]+"if (taskIndex !== -1) tasks.splice(taskIndex, 1);";
  return lines.join(source.includes("\r\n")?"\r\n":"\n");
}

/**
 * Narrow, deterministic repair for HTML response strings that small local
 * coding models accidentally emit across physical JavaScript source lines.
 *
 * No generated application code is ever executed. Both the original and the
 * candidate are syntax-checked by the same Node interpreter, via stdin.
 * This helper NEVER writes files; callers must apply the proposal through
 * the audited files.write tool, respecting approvals and project isolation.
 * Normal tests and HTTP behavior checks still decide whether the app works.
 */
export interface LocatedSyntaxError{message:string;excerpt:string}
const checkModule=(source:string)=>spawnSync(process.execPath,["--check","--input-type=module"],{input:source,encoding:"utf8",timeout:4000,windowsHide:true,maxBuffer:512*1024});
/** Where Node says the file stops parsing. Local models often write the whole file on one line, so the column matters. */
export function locateSyntaxError(source:string):LocatedSyntaxError|undefined{
  const run=checkModule(source);
  if(run.error||run.status===0)return undefined;
  const output=String(run.stderr).split(/\r?\n/);
  const caret=output.findIndex(line=>/^\s*\^+\s*$/.test(line));
  const message=output.find(line=>/^\w*Error:/.test(line))??"SyntaxError";
  const lineNumber=Number(/:(\d+)\s*$/.exec(output.find(line=>/:\d+\s*$/.test(line))??"")?.[1]??0);
  if(caret<0||!lineNumber)return{message,excerpt:source.slice(0,1200)};
  const column=output[caret]!.indexOf("^"),lines=source.split(/\r?\n/),target=lines[lineNumber-1]??"";
  const marked=target.slice(Math.max(0,column-350),column)+"<<<PARSER STOPS HERE>>>"+target.slice(column,column+350);
  return{message,excerpt:[...lines.slice(Math.max(0,lineNumber-5),lineNumber-1).map(line=>line.slice(0,240)),marked,...lines.slice(lineNumber,lineNumber+4).map(line=>line.slice(0,240))].join("\n")};
}
export function buildSyntaxPatchPrompt(source:string,located:LocatedSyntaxError):string{
  return[
    "This JavaScript module does not parse. Fix only that. Return only JSON: {\"cause\":\"one sentence\",\"edits\":[{\"find\":\"exact text copied from the file\",\"replace\":\"corrected text\"}]}.",
    "At most 3 edits. Each find must appear exactly once in the file, so include enough surrounding characters. Do not rewrite the file.",
    "Parser error: "+located.message,
    "Where the parser stops:\n"+located.excerpt,
    "Whole file:\n"+source.slice(0,8000)
  ].join("\n\n");
}
/** Applies a model's patch only if the result parses. Throws the reason otherwise; writes nothing. */
export function applySyntaxPatch(source:string,proposal:unknown):string{
  const edits=(proposal as {edits?:unknown}|null)?.edits;
  if(!Array.isArray(edits)||!edits.length)throw new Error("The model returned no edits.");
  if(edits.length>3)throw new Error("More than 3 edits were proposed.");
  let result=source;
  for(const edit of edits as Array<{find?:unknown;replace?:unknown}>){
    if(typeof edit?.find!=="string"||typeof edit.replace!=="string"||!edit.find)throw new Error("An edit is missing find or replace.");
    const count=result.split(edit.find).length-1;
    if(count!==1)throw new Error(`find must occur exactly once; it occurs ${count} times: ${edit.find.slice(0,120)}`);
    result=result.replace(edit.find,()=>edit.replace as string);
  }
  const still=locateSyntaxError(result);
  if(still)throw new Error("The patched file still does not parse: "+still.message);
  return result;
}

export function repairMultilineHtmlResponse(projectRoot:string,buildFailure:string):{path:string;content:string}|undefined{
  // The exact message depends on what follows the stray backtick; a candidate only survives if Node accepts it.
  if(!/SyntaxError:/i.test(buildFailure) ||
     !/src[\\/]server\.mjs/i.test(buildFailure))return undefined;
  const original=readTaskServerSource(projectRoot);
  if(!original)return undefined;
  const check=(source:string):boolean=>{
    const run=spawnSync(process.execPath,["--check","--input-type=module"],
      {input:source,encoding:"utf8",timeout:4000,windowsHide:true,maxBuffer:512*1024});
    return !run.error&&run.status===0;
  };
  if(check(original))return undefined;
  const response=/(\bres\.end\s*\(\s*)(["'])(<html\b[\s\S]{0,131072}?<\/html>)(\2\s*\))/gi;
  let repaired=false;
  let candidate=original.replace(response,(whole,open:string,quote:string,html:string,close:string)=>{
    if(repaired||!/[\r\n]/.test(html))return whole;
    repaired=true;
    return open+quote+html.replace(/\r\n?|\n/g,"\\n")+close;
  });
  if(!repaired){
    // Escape browser template literals embedded inside a server-side HTML template.
    // Keep server-side interpolations outside the inline script intact.
    const inlineScript=/(\b(?:res\.end\s*\(|const\s+\w+\s*=)\s*`\s*(?:<!doctype\s+html\s*>\s*)?<html\b(?:(?!<\/html\s*>)[\s\S])*?<script\b[^>]*>)([\s\S]*?)(<\/script>)(?=(?:(?!<\/html\s*>)[\s\S])*?<\/html\s*>\s*`\s*[);])/gi;
    candidate=original.replace(inlineScript,(_whole,open:string,script:string,close:string)=>
      open+script.replace(/(?<!\\)`([^`\r\n]*)`/g,(_template,body:string)=>
        "\\`"+body.replace(/(?<!\\)\$\{/g,"\\${")+"\\`")+close);
  }
  if(candidate===original)return undefined;
  return check(candidate)?{path:"src/server.mjs",content:candidate}:undefined;
}
