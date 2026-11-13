import { describe, expect, it } from "vitest";

import { runCount, runMessage } from "./api";

describe("a sync read off its studio-tasks run", () => {
  it("counts what the run's result reports, and zero for what it has not", () => {
    const n = runCount({ result: { issues: 3, stored: 12, files: "x" } });
    expect(n("issues")).toBe(3);
    expect(n("stored")).toBe(12);
    expect(n("files")).toBe(0);
    expect(n("commits")).toBe(0);
    expect(runCount({ result: null })("gears")).toBe(0);
  });

  it("says what it did, else why it stopped, else where it is", () => {
    expect(runMessage({ summary: "12 stored", last_error: "x", progress: "y" })).toBe("12 stored");
    expect(runMessage({ summary: null, last_error: "token revoked", progress: "cloning" })).toBe("token revoked");
    expect(runMessage({ summary: null, last_error: null, progress: "cloning" })).toBe("cloning");
    expect(runMessage({})).toBeNull();
  });
});
