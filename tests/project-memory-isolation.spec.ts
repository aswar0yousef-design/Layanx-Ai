import {MemoryEngine} from "../src/core/memory.js";

const memory = new MemoryEngine();

memory.remember({
  missionId: "mission-a",
  projectId: "project-a",
  kind: "decision",
  summary: "Project alpha database migration",
  content: {detail: "alpha-private-marker"},
  confidence: 1,
  tags: ["database", "alpha"]
});
memory.remember({
  missionId: "mission-b",
  projectId: "project-b",
  kind: "decision",
  summary: "Project beta database migration",
  content: {detail: "beta-private-marker"},
  confidence: 1,
  tags: ["database", "beta"]
});

const alpha = memory.recall("alpha database migration", 10, "project-a");
if (alpha.length !== 1 || alpha[0].projectId !== "project-a" || alpha[0].content === undefined) {
  throw new Error("Project A recall returned unexpected results.");
}
if (alpha.some(entry => entry.projectId !== "project-a")) {
  throw new Error("Project A recall leaked another project's memory.");
}

const beta = memory.recall("beta database migration", 10, "project-b");
if (beta.length !== 1 || beta[0].projectId !== "project-b") {
  throw new Error("Project B recall returned unexpected results.");
}
if (beta.some(entry => entry.projectId !== "project-b")) {
  throw new Error("Project B recall leaked another project's memory.");
}

const restored = new MemoryEngine();
restored.restore(memory.list());
const restoredAlpha = restored.recall("alpha database migration", 10, "project-a");
if (restoredAlpha.length !== 1 || restoredAlpha.some(entry => entry.projectId !== "project-a")) {
  throw new Error("Restored memory recall crossed project boundaries.");
}

console.log("Project memory isolation tests passed.");
