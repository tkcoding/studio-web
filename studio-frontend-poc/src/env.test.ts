import { describe, expect, it } from "vitest";

import { idpConsoleUrl } from "./env";

/**
 * The identity provider's console, derived from the issuer.
 *
 * It used to be the literal `https://localhost:8443/admin/`, so on every
 * deployment that was not a developer's own machine the button opened the
 * reader's own port 8443 — a link that always rendered and never worked.
 */
describe("idpConsoleUrl", () => {
  it("keeps the issuer's origin and replaces its path", () => {
    // Keycloak serves /admin/ from the same origin as /realms/<realm>, which
    // is why one configured value can answer both.
    expect(idpConsoleUrl("https://id.example.test/realms/studio")).toBe(
      "https://id.example.test/admin/",
    );
  });

  it("keeps a non-default port", () => {
    expect(idpConsoleUrl("https://localhost:8443/realms/studio")).toBe(
      "https://localhost:8443/admin/",
    );
  });

  it("offers nothing when the deployment has not said where its IdP is", () => {
    // No link at all beats a link to somebody else's machine.
    expect(idpConsoleUrl(undefined)).toBeNull();
    expect(idpConsoleUrl("")).toBeNull();
  });

  it("offers nothing rather than throwing on a malformed issuer", () => {
    expect(idpConsoleUrl("not a url")).toBeNull();
  });
});
