import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";

/**
 * Narrow, deterministic repair for HTML response strings that small local
 * coding models accidentally emit across physical JavaScript source lines.
 *
 * No generated application code is ever executed. Both the original and the
 * candidate are syntax-checked by the same Node interpreter. If the candidate
 * does not pass, the original bytes are preserved. Normal tests and HTTP
 * behavior checks still decide whether the application is working.
 */
export function repairMultilineHtmlResponse(projectRoot:string,buildFailure:string):boolean{
  if(!/SyntaxError: Invalid or unexpected token/i.test(buildFailure) ||
     !/src[\\/]server\.mjs/i.test(buildFailure))return false;
  const target=path.join(projectRoot,"src","server.mjs");
  let original:string;
  try{
    // Never follow a model-created symlink out of its project workspace.
    const base=fs.realpathSync(projectRoot);
    const realTarget=fs.realpathSync(target);
    const relative=path.relative(base,realTarget);
    if(relative===".."||relative.startsWith(".."+path.sep)||path.isAbsolute(relative)||
       fs.lstatSync(target).isSymbolicLink())return false;
    const stat=fs.statSync(target);
    if(!stat.isFile()||stat.size===0||stat.size>512*1024)return false;
    original=fs.readFileSync(target,"utf8");
  }catch{return false;}
  const check=():boolean=>{
    const run=spawnSync(process.execPath,["--check",target],{encoding:"utf8",timeout:4000,windowsHide:true});
    return !run.error&&run.status===0;
  };
  if(check())return false;
  const response=/(\bres\.end\s*\(\s*)(["'])(<html\b[\s\S]{0,131072}?<\/html>)(\2\s*\))/gi;
  let repaired=false;
  const candidate=original.replace(response,(whole,open:string,quote:string,html:string,close:string)=>{
    if(repaired||!/[\r\n]/.test(html))return whole;
    repaired=true;
    return open+quote+html.replace(/\r\n?|\n/g,"\\n")+close;
  });
  if(!repaired||candidate===original)return false;
  // Writes only to this project's existing src/server.mjs.
  // Restore the original on any failed syntax check.
  try{
    fs.writeFileSync(target,candidate,"utf8");
    if(check())return true;
  }catch{}
  try{fs.writeFileSync(target,original,"utf8");}catch{}
  return false;
}
