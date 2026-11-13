import { describe, expect, it } from "vitest";
import type { OpenPullRequest } from "./api";
import type { ReviewRequest } from "./review-requests";
import { concernsMe, inboxItems, pullKey, reviewKey, snoozeUntil, type InboxMark } from "./waiting-on-me";

const review = (id: string, over: Partial<ReviewRequest> = {}): ReviewRequest => ({
  id,
  project_id: "p",
  subject_kind: "binding",
  subject_id: "b",
  title: id,
  version: "v",
  requested_by: "ann",
  reviewers: [{ person: "me", required: true }],
  state: "open",
  overdue: false,
  outstanding: ["me"],
  created_at: "2026-10-13T10:00:00Z",
  verdicts: [],
  ...over,
});

const pull = (id: string): OpenPullRequest => ({ id, updated_at: "2026-10-13T09:00:00Z" }) as unknown as OpenPullRequest;

const NOW = new Date("2026-10-13T12:00:00Z");

describe("the inbox", () => {
  it("puts overdue reviews first, then by due date, then pull requests", () => {
    const { open } = inboxItems(
      [
        {
          workspace: "w",
          items: [
            review("later", { due_at: "2026-10-20T23:59:59Z" }),
            review("none"),
            review("late", { due_at: "2026-10-10T23:59:59Z", overdue: true }),
            review("soon", { due_at: "2026-10-14T23:59:59Z" }),
          ],
        },
      ],
      [{ workspace: "w", items: [pull("p1"), pull("p2")] }],
      [],
      NOW,
    );
    expect(open.map((i) => (i.kind === "review" ? i.review.id : i.pull.id))).toEqual([
      "late",
      "soon",
      "later",
      "none",
      "p1",
      "p2",
    ]);
  });

  it("hides what is done and what is snoozed until later, and counts it", () => {
    const marks: InboxMark[] = [
      { item_key: reviewKey(review("a")), state: "done", updated_at: "" },
      { item_key: reviewKey(review("b")), state: "snoozed", until: "2026-10-14T00:00:00Z", updated_at: "" },
      { item_key: reviewKey(review("c")), state: "snoozed", until: "2026-10-13T11:00:00Z", updated_at: "" },
      { item_key: pullKey(pull("p1")), state: "done", updated_at: "" },
    ];
    const { open, hidden, hiddenItems } = inboxItems(
      [{ workspace: "w", items: [review("a"), review("b"), review("c")] }],
      [{ workspace: "w", items: [pull("p1")] }],
      [...marks, { item_key: "review:gone", state: "done", updated_at: "" }],
      NOW,
    );
    expect(open.map((i) => i.key)).toEqual(["review:c"]);
    expect(hidden).toBe(3);
    // Only items still on a list: a mark for one that is gone is not "hidden".
    expect(hiddenItems.map((i) => i.key)).toEqual(["review:a", "review:b", pullKey(pull("p1"))]);
  });

  it("brings a pull request back when it moves again", () => {
    const done: InboxMark = { item_key: pullKey(pull("p1")), state: "done", updated_at: "" };
    const moved = { ...pull("p1"), updated_at: "2026-10-13T11:30:00Z" } as OpenPullRequest;
    expect(inboxItems([], [{ workspace: "w", items: [moved] }], [done], NOW).open).toHaveLength(1);
  });

  it("snoozes for whole days", () => {
    expect(snoozeUntil(NOW, 1)).toBe("2026-10-14T12:00:00.000Z");
  });

  it("listens only to review events about this person", () => {
    expect(concernsMe({ subject_type: "review_request", payload: { reviewers: ["me"] } }, "me")).toBe(true);
    expect(concernsMe({ subject_type: "review_request", payload: { requested_by: "me", reviewers: [] } }, "me")).toBe(true);
    expect(concernsMe({ subject_type: "review_request", payload: { reviewers: ["bob"] } }, "me")).toBe(false);
    expect(concernsMe({ subject_type: "task_run", payload: {} }, "me")).toBe(false);
  });
});
