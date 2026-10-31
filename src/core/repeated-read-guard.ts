/**
 * Fail-closed repeated-read protection for the live agent loop.
 * A small local model can return the same project.knowledge/read/status call
 * even after the call succeeded, consuming all steps without moving a goal forward.
 *
 * Only pure observational tools qualify; mutations, failed calls, or a changed
 * payload reset or differentiate the evidence. Never infer overall mission success.
 */
export interface ReadPlan {
  tool:string; action:string; permission:string; payload?:unknown;
}
const PURE_READS=new Set([
  "project.knowledge","files.list","files.read","files.stat",
  "runtime.status","mission.inspect","browser.read",
  "github.repo.read","github.issues.list","github.prs.list"
]);
function stable(value:unknown):string{
  if(Array.isArray(value))return "["+value.map(stable).join(",")+"]";
  if(value&&typeof value==="object"){
    const obj=value as Record<string,unknown>;
    return "{"+Object.keys(obj).sort().map(key=>JSON.stringify(key)+":"+stable(obj[key])).join(",")+"}";
  }
  return JSON.stringify(value)??"null";
}
export function readSignature(plan:ReadPlan):string|null{
  if(!PURE_READS.has(plan.tool)||!["L1_READ","L2_ANALYZE"].includes(plan.permission))return null;
  return plan.tool+"|"+plan.action+"|"+stable(plan.payload??{});
}
/** History holds successful read signatures since the last mutation/failure.
 * Two prior identical successes are sufficient to block the third identical call. */
export function repeatedReadReason(plan:ReadPlan,history:readonly string[]):string|null{
  const key=readSignature(plan);
  if(!key||history.filter(item=>item===key).length<2)return null;
  return "Repeated read-only tool blocked: "+plan.tool+
    " has already succeeded twice with the same arguments and no intervening change. "+
    "The agent must stop rather than report the request completed or repeat the same observation.";
}
