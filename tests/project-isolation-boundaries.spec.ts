import {ProjectIsolation} from "../src/security/project-isolation.js";
import {resolve} from "node:path";

const isolation = new ProjectIsolation();

function mustReject(label: string, operation: () => unknown): void {
  let rejected = false;
  try {
    operation();
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`Expected rejection: ${label}`);
}

// Missions must be bound to the same canonical project as the security context.
isolation.assertMissionProject("project-a", "project-a");
mustReject("cross-project mission", () => isolation.assertMissionProject("project-a", "project-b"));
mustReject("unbound mission", () => isolation.assertMissionProject("project-a", undefined));

// Tool requests must not be allowed to cross project boundaries or omit their binding.
isolation.assertRequestProject("project-a", "project-a");
mustReject("cross-project request", () => isolation.assertRequestProject("project-a", "project-b"));
mustReject("unbound request", () => isolation.assertRequestProject("project-a", undefined));

// Resource ownership and memory namespaces must be explicitly project-scoped.
isolation.assertSameProject("project-a", {projectId: "project-a", resourceId: "resource-1"});
mustReject("cross-project resource", () => isolation.assertSameProject("project-a", {projectId: "project-b", resourceId: "resource-2"}));
isolation.assertMemoryNamespace("project-a", "project:project-a");
mustReject("other project's memory namespace", () => isolation.assertMemoryNamespace("project-a", "project:project-b"));
mustReject("global memory namespace", () => isolation.assertMemoryNamespace("project-a", "global"));

// Reject path traversal and invalid IDs before they can become workspace paths.
for (const invalidId of ["", "../project-b", "project/a", "project\\\\b", ".hidden?"]) {
  mustReject(`invalid project ID ${JSON.stringify(invalidId)}`, () => isolation.normalize(invalidId));
}

const root = resolve(process.cwd(), "isolation-test-root");
const canonicalId = process.platform === "win32" ? "project-a" : "Project-A";
const expected = resolve(root, canonicalId);
if (isolation.workspacePath(root, "Project-A") !== expected) {
  throw new Error("Workspace path did not use the canonical project identity.");
}

console.log("Project isolation boundary tests passed.");
