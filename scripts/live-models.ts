import fs from "node:fs";
import path from "node:path";
import {resolveDataPaths} from "../src/platform/paths.js";

/**
 * The models the owner's LayanX really uses: the plan it saved at start-up (LOCALAPPDATA/LayanX/ollama-models.json), applied
 * the way src/local/host.ts applies it. Without this a trial's runtime fell back to llama3.2:3b (found 2026-11-13: social
 * drafts in mixed languages), so its model steps did not measure the owner's LayanX.
 * The plan is read when this module loads: a trial points LAYANX_DATA_DIR at a throwaway folder before it runs, and reading
 * it after that found nothing (found 2026-11-13: a re-measurement silently ran on the fallback model again).
 */
const PLAN:Record<string,string>=(()=>{
  try{return JSON.parse(fs.readFileSync(path.join(resolveDataPaths().dataDir,"ollama-models.json"),"utf8")).plan?.assignments??{};}catch{return{};}
})();
export function liveModelPlan(){return{...PLAN};}
export function applyLiveModelPlan(env:NodeJS.ProcessEnv=process.env):{main?:string;vision?:string}{
  const main=PLAN.planning??PLAN.general;
  if(!main)throw new Error("The live LayanX model plan (ollama-models.json) was not found, so this trial would not measure the owner's models.");
  env.OLLAMA_MODEL=main;
  if(PLAN.vision)env.OLLAMA_VISION_MODEL=PLAN.vision;
  return{main,...(PLAN.vision?{vision:PLAN.vision}:{})};
}
