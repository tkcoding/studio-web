import { describe, expect, it } from "vitest";

import { runLine, taskLabel } from "./work-inbox";

describe("how finished work is named", () => {
  it("says the task type the way a person would", () => {
    expect(taskLabel("artifact.ingest")).toBe("Artifact ingest");
    expect(taskLabel("connector.graph_sync")).toBe("Connector graph sync");
  });

  it("never leaves the line blank", () => {
    // A run whose type the event did not carry still has to say something.
    expect(taskLabel("")).toBe("Background work");
    expect(taskLabel("   ")).toBe("Background work");
  });

  it("reports what a run said, or why it stopped", () => {
    expect(runLine({ run_id: "r", state: "succeeded", summary: "42 files" })).toBe("42 files");
    expect(runLine({ run_id: "r", state: "failed", error: "token expired" })).toBe("token expired");
  });

  it("has nothing to say when the run said nothing", () => {
    // An empty summary is not a line — rendering one would draw an empty row
    // under the title and look like a bug.
    expect(runLine({ run_id: "r", state: "succeeded", summary: "   " })).toBeUndefined();
    expect(runLine({ run_id: "r", state: "succeeded" })).toBeUndefined();
  });
});
