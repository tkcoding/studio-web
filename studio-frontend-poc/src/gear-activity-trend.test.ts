import { describe, expect, it } from "vitest";
import { countTrend, mergeTimeTrend } from "./gear-activity";

describe("pull request trend against the previous window", () => {
  it("says nothing without a previous window to compare with", () => {
    expect(countTrend(4, undefined)).toBeUndefined();
    expect(mergeTimeTrend(10, undefined)).toBeUndefined();
    expect(mergeTimeTrend(10, null)).toBeUndefined();
    expect(mergeTimeTrend(null, 10)).toBeUndefined();
  });

  it("shows a count's change without calling it better or worse", () => {
    expect(countTrend(7, 4)).toMatchObject({ text: "▲ 3 vs previous", tone: "neutral" });
    expect(countTrend(2, 5)).toMatchObject({ text: "▼ 3 vs previous", tone: "neutral" });
    expect(countTrend(3, 3)).toMatchObject({ text: "= previous", tone: "same" });
  });

  it("calls a shorter merge time better and a longer one worse", () => {
    expect(mergeTimeTrend(19, 44)).toMatchObject({ tone: "better", text: "Better −25.0h" });
    expect(mergeTimeTrend(72, 24)).toMatchObject({ tone: "worse", text: "Worse +2d" });
  });

  it("reads a change under an hour, or under 5 %, as the same wait", () => {
    expect(mergeTimeTrend(10.5, 10)).toMatchObject({ tone: "same" });
    expect(mergeTimeTrend(102, 100)).toMatchObject({ tone: "same" });
  });
});
