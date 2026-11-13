import { describe, expect, it } from "vitest";
import { demandText, type RoadmapReport, type RoadmapRow } from "./roadmap-report";

const row = (name: string, over: Partial<RoadmapRow["readiness"]> = {}): RoadmapRow => ({
  name,
  category: "core",
  assignees: "@a, @b",
  title: `CORE - ${name}`,
  number: 1,
  group: "CORE",
  components: name.startsWith("cf-") ? [name] : [],
  closed: false,
  off_board: false,
  effort_md: 40,
  remaining_md: 20,
  roadmap_title: `#1 ${name}`,
  readiness: {
    stage: "In Dev",
    stage_at: 3,
    stage_of: 6,
    lifecycle: null,
    milestone: "26.10",
    due: "2026-10-31",
    committed: true,
    plan: "on track",
    plan_lamp: "good",
    plan_reasons: [],
    demand: [],
    progress: [],
    last_release: null,
    released_on: null,
    used_by: null,
    roadmap_item: "https://github.com/o/r/issues/1",
    grade: "C",
    grade_fixes: [],
    ...over,
  },
});

const report: RoadmapReport = {
  items: [
    row("cf-gears-event-broker", {
      demand: [
        { consumer: "Virtuozzo", priority: 3 },
        { consumer: "Acronis", priority: 1 },
      ],
      progress: [
        { label: "Design", value: "80%", pct: 80 },
        { label: "SDK", value: "Done", pct: 100 },
      ],
    }),
    row("cf-gears-file-storage", {
      plan: "at risk",
      plan_lamp: "bad",
      plan_reasons: ["overdue: due 2026-07-31", "P1 for Acronis"],
      progress: [{ label: "Tests", value: "N/A", pct: null }],
    }),
  ],
  total: 2,
  not_in_code: 0,
  not_on_board: 5,
  summary: {
    by_group: [
      {
        group: "CORE",
        total: 2,
        done: 0,
        in_code: 2,
        axes: [
          { label: "Design", average: 80 },
          { label: "SDK", average: null },
        ],
        estimated: 2,
        effort_md: 80,
        remaining_md: 40,
      },
    ],
    by_stage: [{ label: "In Dev", count: 2 }],
    by_milestone: [{ milestone: "26.10", due: "2026-10-31", total: 2, committed: 2, at_risk: 1 }],
    by_consumer: [{ consumer: "Acronis", p1: 1, p2: 0, p3: 0, p1_not_on_track: 0 }],
    by_plan: [
      { label: "at risk", count: 1 },
      { label: "on track", count: 1 },
    ],
    overdue: ["cf-gears-file-storage"],
  },
};

describe("roadmap report", () => {
  it("lists demand most urgent first", () => {
    expect(demandText(report.items[0].readiness.demand)).toBe("Acronis P1, Virtuozzo P3");
  });
});
