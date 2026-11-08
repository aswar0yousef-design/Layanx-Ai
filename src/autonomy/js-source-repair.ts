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
