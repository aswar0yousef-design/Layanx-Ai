/** Verify a claimed delivery artifact against the actual project filesystem. */
import {lstat,realpath} from "node:fs/promises";
import {isAbsolute,relative,resolve,sep} from "node:path";

export interface ArtifactCheck {ok:boolean;reason?:string}

export async function verifyAcceptanceArtifact(projectRoot:string,artifact:string):Promise<ArtifactCheck>{
  if(!artifact||!artifact.trim())return {ok:false,reason:"Artifact path is empty."};
  if(isAbsolute(artifact)||/^[a-zA-Z]:[\\/]/.test(artifact)||artifact.startsWith("\\\\"))
    return {ok:false,reason:"Artifact must be relative to the project."};
  const root=resolve(projectRoot);
  const target=resolve(root,artifact);
  const rel=relative(root,target);
  if(!rel||rel===".."||rel.startsWith(".."+sep)||isAbsolute(rel))
    return {ok:false,reason:"Artifact path escapes the project or refers to its root."};
  try{
    const [rootReal,targetReal,stat]=await Promise.all([realpath(root),realpath(target),lstat(target)]);
    const realRel=relative(rootReal,targetReal);
    if(!realRel||realRel===".."||realRel.startsWith(".."+sep)||isAbsolute(realRel))
      return {ok:false,reason:"Artifact resolves outside the project."};
    if(!stat.isFile())return {ok:false,reason:"Artifact is not a regular file."};
    return {ok:true};
  }catch{return {ok:false,reason:"Artifact file does not exist or is inaccessible."};}
}
