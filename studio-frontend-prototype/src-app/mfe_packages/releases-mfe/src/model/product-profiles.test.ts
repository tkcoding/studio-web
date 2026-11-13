// The profile part of the prototype's src/product.test.ts (at 00828880), copied unchanged.
import { describe, expect, it } from "vitest";

import { declaredProfiles, deployableProfiles, profileLabel } from "./product-profiles";

describe("the profiles the saved description declares", () => {
  const text = `gdl_version = "1.5"
product(
    id = "shop",
    # profiles = [kubernetes(id = "commented")],
    profiles = [
        embedded(id = "dev", development = True, database = postgres(host = "127.0.0.1")),
        kubernetes(id = "stage", discovery = "static", namespace = "shop-stage"),
        kubernetes(id = "prod", discovery = "static", namespace = "shop"),
        self_hosted(id = "lab", host = "lab"),
    ],
    gears = [use_gear("api-gateway", source = "gears-rust")],
)`;

  it("are read with their kinds, and only kubernetes ones can be bound", () => {
    const declared = declaredProfiles(text);
    expect(declared.map((p) => [p.id, p.kind])).toEqual([
      ["dev", "embedded"],
      ["stage", "kubernetes"],
      ["prod", "kubernetes"],
      ["lab", "self_hosted"],
    ]);
    expect(deployableProfiles(declared).map((p) => p.id)).toEqual(["stage", "prod"]);
    expect(profileLabel("stage", declared)).toBe("Kubernetes · stage");
    expect(profileLabel("lab", declared)).toBe("One host · lab");
  });

  it("fall back to the three a new description starts with", () => {
    for (const none of [null, "", "# no product here", "product(id = \"x\", profiles = PROFILES)"]) {
      expect(deployableProfiles(declaredProfiles(none)).map((p) => p.id)).toEqual(["prod"]);
    }
  });
});
