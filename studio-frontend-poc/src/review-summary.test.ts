import { describe, expect, it } from "vitest";
import { reviewCounts, reviewOf, type ReviewPart } from "./review-summary";

const part = (label: string, pass: boolean, known?: boolean): ReviewPart => ({
  area: "Quality assurance",
  label,
  pass,
  known,
  fix: `Fix ${label}`,
});

describe("the Review column", () => {
  it("has nothing to say without a grade", () => {
    expect(reviewOf(undefined)).toBeUndefined();
    expect(reviewOf([])).toBeUndefined();
  });

  it("puts a failure on an answer before one with no answer", () => {
    const summary = reviewOf([part("Coverage is published", false, false), part("PRD is written", false, true), part("Released", true, true)])!;

    expect(summary.top?.label).toBe("PRD is written");
    expect(summary.toReview.map((p) => p.label)).toEqual(["PRD is written"]);
    expect(summary.noData.map((p) => p.label)).toEqual(["Coverage is published"]);
    expect(reviewCounts(summary)).toBe("1 to review · 1 without data");
  });

  it("names the missing data when that is all that failed", () => {
    const summary = reviewOf([part("Coverage is published", false, false), part("Released", true, true)])!;

    expect(summary.top?.label).toBe("Coverage is published");
    expect(reviewCounts(summary)).toBe("1 without data");
  });

  it("reads a part from an older backend, with no known flag, as known", () => {
    expect(reviewOf([part("PRD is written", false)])!.toReview).toHaveLength(1);
  });

  it("has no counts when every check passed", () => {
    const summary = reviewOf([part("Released", true, true)])!;

    expect(summary.top).toBeUndefined();
    expect(reviewCounts(summary)).toBeUndefined();
  });
});
