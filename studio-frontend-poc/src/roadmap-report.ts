// The roadmap report, as `GET /studio-components-catalog/v1/roadmap-report`
// serves it (`components_catalog/roadmap_report.rs`). The server decides every
// number; the workbook download is the server's too
// (`components_catalog/roadmap_workbook.rs`).

export interface RoadmapDemand {
  consumer: string;
  priority: number;
}

export interface RoadmapAxis {
  label: string;
  value: string;
  pct: number | null;
}

export interface RoadmapReadiness {
  stage: string | null;
  stage_at: number | null;
  stage_of: number | null;
  lifecycle: string | null;
  milestone: string | null;
  due: string | null;
  committed: boolean | null;
  plan: string | null;
  plan_lamp: string | null;
  plan_reasons: string[];
  demand: RoadmapDemand[];
  progress: RoadmapAxis[];
  last_release: string | null;
  released_on: string | null;
  used_by: number | null;
  roadmap_item: string | null;
  grade: string | null;
  grade_fixes: string[];
}

export interface RoadmapRow {
  /** The implementing component, or the board's title for a gear with no code. */
  name: string;
  /** The board's title for the gear. */
  title: string;
  number: number | null;
  /** The title's `DOMAIN - ` prefix, or `Ungrouped`. */
  group: string;
  /** The catalogued components it is the plan of; empty: no code yet. */
  components: string[];
  closed: boolean;
  off_board: boolean;
  category: string | null;
  readiness: RoadmapReadiness;
  assignees: string | null;
  /** Person-days. */
  effort_md: number | null;
  remaining_md: number | null;
  roadmap_title: string | null;
}

export interface RoadmapGroup {
  group: string;
  total: number;
  done: number;
  in_code: number;
  axes: { label: string; average: number | null }[];
  estimated: number;
  effort_md: number;
  remaining_md: number;
}

export interface RoadmapCount {
  label: string;
  count: number;
}

export interface RoadmapMilestone {
  milestone: string;
  due: string | null;
  total: number;
  committed: number;
  at_risk: number;
}

export interface RoadmapConsumer {
  consumer: string;
  p1: number;
  p2: number;
  p3: number;
  p1_not_on_track: number;
}

export interface RoadmapReport {
  items: RoadmapRow[];
  total: number;
  /** Gears no catalogued component implements yet. */
  not_in_code: number;
  not_on_board: number;
  summary: {
    by_group: RoadmapGroup[];
    by_stage: RoadmapCount[];
    by_milestone: RoadmapMilestone[];
    by_consumer: RoadmapConsumer[];
    by_plan: RoadmapCount[];
    overdue: string[];
  };
}

/** `Acronis P1, Virtuozzo P3`, most urgent first. */
export function demandText(demand: RoadmapDemand[]): string {
  return [...demand]
    .sort((a, b) => a.priority - b.priority || a.consumer.localeCompare(b.consumer))
    .map((d) => `${d.consumer} P${d.priority}`)
    .join(", ");
}

/** The progress axes across all rows, in the order the board lists them. */
