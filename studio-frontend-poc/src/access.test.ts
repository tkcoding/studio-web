import { describe, expect, it } from "vitest";

import { describePrivilege, normalizeAccessConfig, privilegesByGroup, type RoleDef } from "./access";

/* ── What is left here, and what went ─────────────────────────────────────────
 *
 * `PRIVILEGES` and `defaultRoles()` used to live in this file as a second copy
 * of `studio-backend/src/access_config.rs`, and the test that guarded them read
 * the Rust source through Vite's `?raw` and matched it with a regular
 * expression. Both are gone: the screen reads
 * `GET /studio-organizations/v1/access-catalogue`, so there is no copy to
 * drift and nothing to parse. The rules those tests asserted are Rust tests
 * now, beside the catalogue they are about.
 *
 * What stays is this portal's own half — the names it puts on the server's ids,
 * and what it does with a stored document.
 */

describe("naming the server's privileges", () => {
  it("gives a known id its group and its label", () => {
    expect(describePrivilege("people.invite")).toEqual({
      id: "people.invite",
      group: "People & Team",
      label: "Invite to the organization",
    });
  });

  it("shows an id it has no string for rather than hiding it", () => {
    // The server is the authority on what exists. A privilege the PDP
    // understands and this build has never heard of is exactly what somebody
    // needs to see — under its own name, in a group of its own.
    expect(describePrivilege("billing.refund")).toEqual({
      id: "billing.refund",
      group: "Other",
      label: "billing.refund",
    });
  });
});

describe("grouping the catalogue for the editor", () => {
  it("keeps the server's order and puts each id in its family", () => {
    const groups = privilegesByGroup([
      "people.view",
      "secret.view",
      "people.manage",
      "session.open",
    ]);
    expect(groups.map((g) => g.group)).toEqual(["People & Team", "Secrets", "Sessions"]);
    expect(groups[0].items.map((p) => p.id)).toEqual(["people.view", "people.manage"]);
  });

  it("is empty when the catalogue could not be read", () => {
    // A failed load leaves the editor with nothing to offer, which is honest;
    // it must not fall back to a list this portal invented.
    expect(privilegesByGroup([])).toEqual([]);
  });
});

describe("normalizing a stored config", () => {
  const seeded: RoleDef[] = [
    { key: "owner", name: "Owner", system: true, privileges: ["people.view"] },
    { key: "viewer", name: "Viewer", system: true, privileges: ["people.view"] },
  ];

  it("fills a missing ladder from the seeded one rather than leaving a grant unresolvable", () => {
    const cfg = normalizeAccessConfig({ model: "roles", roles: [], grants: [] }, seeded);
    expect(cfg.roles.map((r) => r.key)).toEqual(["owner", "viewer"]);
  });

  it("keeps a stored ladder exactly as stored", () => {
    // The document is the record. Replacing a ladder somebody edited with the
    // seed would write roles the PDP was not built against.
    const stored: RoleDef[] = [{ key: "custom", name: "Custom", privileges: [] }];
    const cfg = normalizeAccessConfig({ model: "roles", roles: stored, grants: [] }, seeded);
    expect(cfg.roles).toEqual(stored);
  });

  it("treats anything but `roles` as the tenant model", () => {
    expect(normalizeAccessConfig(null, seeded).model).toBe("tenant");
    expect(normalizeAccessConfig({ model: "roles" }, seeded).model).toBe("roles");
  });

  it("starts an organization that has no document at all from the seeded ladder", () => {
    const cfg = normalizeAccessConfig(null, seeded);
    expect(cfg.grants).toEqual([]);
    expect(cfg.roles.map((r) => r.key)).toEqual(["owner", "viewer"]);
  });
});
