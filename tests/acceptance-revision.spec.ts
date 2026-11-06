import { strict as assert } from "node:assert";
import { test } from "node:test";
import { evaluateAcceptance } from "../src/autonomy/acceptance-evidence.js";

test("empty criteria cannot be accepted", () => {
  assert.equal(evaluateAcceptance([], []).status, "blocked");
});

test("evidence belongs to the tested revision", () => {
  const criteria = [{ id: "login", description: "Login succeeds", required: true }];
  const evidence = {
    requirementId: "login",
    checkId: "login-e2e",
    passed: true,
    observedAt: "2026-11-05T12:00:00Z",
    artifact: "reports/login.json",
    revision: "abc"
  };
  assert.equal(evaluateAcceptance(criteria, [evidence], "def").status, "blocked");
  assert.equal(evaluateAcceptance(criteria, [evidence], "abc").status, "verified");
});
