// The store over the server's product-infra route; what it merges and writes
// is studio-product's (infra_gdl.rs, with the prototype's tests).
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type InfraService } from "../api/client";
import { infraStore } from "./infra-store";

const item = { passport: { name: "keycloak", provides: {} } } as unknown as InfraService;

afterEach(() => vi.restoreAllMocks());

describe("the infra services' store", () => {
  it("reads the server's list with where it is kept and the revision it was read at", async () => {
    vi.spyOn(api, "productInfra").mockResolvedValue({ items: [item], source: "product-description", revision: 3, services: [] });
    expect(await infraStore("t", "p").load()).toEqual({ items: [item], source: "product-description", revision: 3 });
  });

  it("saves the whole list against the revision it was read at", async () => {
    const put = vi
      .spyOn(api, "putProductInfra")
      .mockResolvedValue({ items: [item], source: "product-description", revision: 4, services: [] });
    expect(await infraStore("t", "p").save([item], 3)).toEqual({ items: [item], source: "product-description", revision: 4 });
    expect(put).toHaveBeenCalledWith("t", "p", { base_revision: 3, items: [item] });
  });

  it("says a project without a description keeps the list alone", async () => {
    vi.spyOn(api, "productInfra").mockResolvedValue({ items: [], source: "project-list", revision: null, services: [] });
    expect((await infraStore("t", "p").load()).source).toBe("project-list");
  });
});
