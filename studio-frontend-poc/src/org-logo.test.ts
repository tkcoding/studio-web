// A logo is a small image of a kind the backend keeps; the page refuses the
// rest before sending it, in the words the backend would use.
import { describe, expect, it } from "vitest";

import { logoFileProblem, logoSrc, MAX_LOGO_BYTES } from "./org-logo";

describe("an organization's logo", () => {
  it("is shown from its bytes as a data URL", () => {
    expect(logoSrc({ content_type: "image/png", data: "AAEC" })).toBe("data:image/png;base64,AAEC");
  });

  it("is refused before upload when it is not a picture of a kept kind, or too big", () => {
    expect(logoFileProblem({ type: "image/png", size: 1000 })).toBeNull();
    expect(logoFileProblem({ type: "image/svg+xml", size: 1000 })).toContain("PNG");
    expect(logoFileProblem({ type: "image/png", size: MAX_LOGO_BYTES + 1 })).toContain("256 KiB");
  });
});
