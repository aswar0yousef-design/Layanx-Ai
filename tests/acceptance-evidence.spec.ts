import { strict as assert } from "node:assert";
import { test } from "node:test";
import { evaluateAcceptance } from "../src/autonomy/acceptance-evidence.js";

const requirements = [{ id: "login", description: "Login works", required: true }];
const receipt = {
  requirementId: "login",
  checkId: "e2e:login",
  passed: true,
  observedAt: "2026-11-05T12:00:00Z",
  artifact: "reports/login.json"
};

test("missing proof blocks completion", () => {
  assert.equal(evaluateAcceptance(requirements, []).status, "blocked");
});
test("skipped and failed checks block completion", () => {
  assert.equal(evaluateAcceptance(requirements, [{ ...receipt, skipped: true }]).status, "blocked");
  assert.equal(evaluateAcceptance(requirements, [{ ...receipt, passed: false }]).status, "blocked");
});
test("claims without evidence artifacts block completion", () => {
  assert.equal(evaluateAcceptance(requirements, [{ ...receipt, artifact: "" }]).status, "blocked");
});
test("evidenced required checks may pass", () => {
  assert.equal(evaluateAcceptance(requirements, [receipt]).status, "verified");
});
test("duplicate requirement IDs block completion", () => {
  assert.equal(evaluateAcceptance([...requirements, ...requirements], [receipt]).status, "blocked");
});

test("invalid timestamps and blank check IDs cannot certify acceptance", () => {
  assert.equal(evaluateAcceptance(requirements, [{ ...receipt, observedAt: "not-a-date" }]).status, "blocked");
  assert.equal(evaluateAcceptance(requirements, [{ ...receipt, checkId: " " }]).status, "blocked");
});
test("a failed check cannot be overridden by an earlier success", () => {
  assert.equal(evaluateAcceptance(requirements, [receipt, { ...receipt, passed: false }]).status, "blocked");
});
test("optional requirements do not require a proof", () => {
  assert.equal(evaluateAcceptance([...requirements, { id: "optional", description: "Nice to have", required: false }], [receipt]).status, "verified");
});
