import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import { errText } from "./format";

describe("errText", () => {
  function problem(status: number, body: unknown): ApiError {
    return new ApiError(status, body);
  }

  it("shows a failed precondition's reason, not the name of the category", () => {
    // What the connector answers when a webhook connection is asked for its
    // channels. `detail` is generic; the sentence is in the violation.
    const text = errText(
      problem(400, {
        title: "Failed Precondition",
        detail: "Operation precondition not met",
        context: {
          violations: [
            {
              description:
                "connection 'Releases' is an incoming webhook: its channel is fixed in the URL",
            },
          ],
        },
      }),
    );
    expect(text).toContain("incoming webhook");
    expect(text).toContain("Operation precondition not met");
  });

  it("does not stutter when the constraint is already the detail", () => {
    // `invalid_argument` puts the same sentence in both places.
    const said = "name exactly one destination: `connection_id` or `workspace_id`";
    const text = errText(
      problem(400, { title: "Invalid Argument", detail: said, context: { constraint: said } }),
    );
    expect(text).toBe(`HTTP 400 · Invalid Argument — ${said}`);
  });

  it("keeps working for a body with nothing in it", () => {
    expect(errText(problem(503, undefined))).toMatch(/^HTTP 503 · Studio did not answer/);
    expect(errText(new Error("network down"))).toBe("Error: network down");
  });

  it("joins several unmet preconditions rather than showing the first", () => {
    const text = errText(
      problem(400, {
        detail: "Operation precondition not met",
        context: { violations: [{ description: "first" }, { description: "second" }] },
      }),
    );
    expect(text).toContain("first");
    expect(text).toContain("second");
  });
});
