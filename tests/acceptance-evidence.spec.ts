import {describe,it,expect} from "vitest";
import {evaluateAcceptance} from "../src/autonomy/acceptance-evidence.js";
const req=[{id:"login",description:"Login works",required:true}];
const proof={requirementId:"login",checkId:"e2e:login",passed:true,observedAt:"2026-11-05T12:00:00Z",artifact:"reports/login.json"};
describe("acceptance evidence",()=>{
 it("blocks missing evidence",()=>expect(evaluateAcceptance(req,[]).status).toBe("blocked"));
 it("blocks skipped and failed checks",()=>{
   expect(evaluateAcceptance(req,[{...proof,skipped:true}]).status).toBe("blocked");
   expect(evaluateAcceptance(req,[{...proof,passed:false}]).status).toBe("blocked");
 });
 it("blocks a model claim without artifact",()=>expect(evaluateAcceptance(req,[{...proof,artifact:""}]).status).toBe("blocked"));
 it("passes independently evidenced requirements",()=>expect(evaluateAcceptance(req,[proof]).status).toBe("verified"));
 it("blocks duplicate IDs",()=>expect(evaluateAcceptance([...req,...req],[proof]).status).toBe("blocked"));
});
