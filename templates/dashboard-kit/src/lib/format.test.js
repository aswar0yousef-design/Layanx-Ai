import { describe, expect, it } from "vitest";
import { bucketTasks, changePercent, groupByStage, linePath, moveDeal, shortMoney, total } from "./format.js";

describe("format", () => {
  it("shortens money", () => {
    expect(shortMoney(846000)).toBe("$846K");
    expect(shortMoney(1250000)).toBe("$1.25M");
  });
  it("computes change", () => {
    expect(changePercent(120, 100)).toBe(20);
    expect(changePercent(5, 0)).toBe(0);
  });
  it("sums and groups deals", () => {
    const stages = [{ id: "lead" }, { id: "won" }];
    const deals = [{ id: 1, stage: "lead", value: 10 }, { id: 2, stage: "won", value: 5 }, { id: 3, stage: "gone", value: 1 }];
    expect(total(deals)).toBe(16);
    const g = groupByStage(deals, stages);
    expect(g.lead.map((d) => d.id)).toEqual([1]);
    expect(g.won.map((d) => d.id)).toEqual([2]);
    const moved = moveDeal(deals, 1, "won");
    expect(moved.find((d) => d.id === 1).stage).toBe("won");
    expect(deals[0].stage).toBe("lead");
  });
  it("buckets tasks", () => {
    const b = bucketTasks(
      [{ id: 1, due: "2026-01-01" }, { id: 2, due: "2026-01-05" }, { id: 3, due: "2026-02-01" }, { id: 4, due: "2026-01-01", done: true }],
      "2026-01-05"
    );
    expect([b.overdue.length, b.today.length, b.upcoming.length, b.completed.length]).toEqual([1, 1, 1, 1]);
  });
  it("draws a path", () => {
    expect(linePath([1, 2, 3], 100, 40).startsWith("M")).toBe(true);
    expect(linePath([], 100, 40)).toBe("");
  });
});
