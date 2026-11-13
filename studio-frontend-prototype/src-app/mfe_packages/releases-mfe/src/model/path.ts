/* A project's path to running (#1050): Specs → Product → Build → Image →
 * Environment → Running. The server decides Product to Running from what
 * the project keeps (`GET /studio-environments/v1/project-path`); Specs is
 * the spec mapping's, read here from the size of its plan. What a step's
 * action does on this screen, which deploy the address names (the Inbox's
 * "A Research deploy you asked for failed" opens one, #1054), and the
 * Research target of the one deploy dialog (#1053) are decided here too. */

import type {
  DeployEnvironment,
  DeployEnvironmentInput,
  PathAction,
  PathStep,
  PathStepId,
  ProjectPath,
} from "../api/types";

/** The order of the steps, as the path is drawn. */
export const PATH_STEPS: readonly PathStepId[] = ["specs", "product", "build", "image", "environment", "running"];

/** How many capabilities the project's specifications need, or why it is not known. */
export type SpecsSeen = { count: number } | "unavailable";

/** The Specs step: done once the specifications name a capability; never
 *  blocks the rest -- a product may be composed without them. */
export function specsStep(seen: SpecsSeen): PathStep {
  if (seen === "unavailable") {
    return { id: "specs", state: "later", reason: "", checklist: [] };
  }
  return seen.count > 0
    ? { id: "specs", state: "done", reason: "", checklist: [] }
    : { id: "specs", state: "next", reason: "", checklist: [], action: { kind: "open_specs", label: "" } };
}

/** The whole path: Specs first, then the server's steps. The step to look
 *  at stays the server's -- Specs only says what the documents give. */
export function pathSteps(path: ProjectPath, specs: SpecsSeen): PathStep[] {
  return [specsStep(specs), ...path.steps];
}

/** What pressing a step's (or a cause's) button does on Releases. */
export type Intent =
  | { kind: "screen"; route: string }
  | { kind: "tab"; tab: "build" | "deploy" }
  | { kind: "deploy"; environmentId: string | null; research: boolean }
  | { kind: "deployment"; id: string }
  | { kind: "url"; url: string }
  | { kind: "none" };

/** The screens a step leads to, by their routes. */
export const ROUTES = {
  specs: "/projects/specs",
  product: "/product",
  connections: "/connections",
  infrastructure: "/infrastructure",
} as const;

export function intentOf(a: Pick<PathAction, "kind"> & Partial<PathAction>, deploymentId?: string | null): Intent {
  switch (a.kind) {
    case "open_specs":
      return { kind: "screen", route: ROUTES.specs };
    case "open_product":
    case "open_gear":
      return { kind: "screen", route: ROUTES.product };
    case "build":
    case "open_build":
      return { kind: "tab", tab: "build" };
    case "deploy":
    case "retry":
      return { kind: "deploy", environmentId: a.environment_id ?? null, research: false };
    case "choose_hardware":
      return { kind: "deploy", environmentId: null, research: true };
    case "bind_profile":
    case "provide_secret":
    case "check_environment":
      return { kind: "tab", tab: "deploy" };
    case "sign_in":
      return { kind: "screen", route: ROUTES.connections };
    case "ask_admin":
    case "ask_organization":
      return { kind: "screen", route: ROUTES.infrastructure };
    case "open_deployment":
    case "open_log": {
      const id = a.deployment_id ?? deploymentId ?? null;
      return id ? { kind: "deployment", id } : { kind: "tab", tab: "deploy" };
    }
    case "open_app":
      return a.url ? { kind: "url", url: a.url } : { kind: "none" };
    default:
      return { kind: "none" };
  }
}

/** The deploy the address names (`…&deployment=<id>`), as the Inbox links it. */
export function deploymentFromSearch(search: string): string | null {
  try {
    const id = new URLSearchParams(search).get("deployment");
    return id && /^[0-9a-f-]{8,}$/i.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** The project's own Research environment that runs in `researchProject`
 *  on `hardware`, if it has one: the dialog reuses it rather than adding
 *  another. */
export function researchEnvironmentFor(
  environments: readonly DeployEnvironment[],
  researchProject: string,
  hardware: string | null,
): DeployEnvironment | undefined {
  return environments.find(
    (e) =>
      e.kind === "research" &&
      e.research_project === researchProject &&
      (e.research_hardware ?? null) === (hardware || null),
  );
}

/** A project's own Research environment, on the caller's own sign-in. */
export function researchEnvironmentInput(
  connectionId: string,
  researchProject: { id: string; name: string },
  hardware: string | null,
): DeployEnvironmentInput {
  return {
    name: `Research ${researchProject.name || researchProject.id}`.slice(0, 60),
    description: "",
    kind: "research",
    connection_id: connectionId,
    research_project: researchProject.id,
    research_hardware: hardware || null,
    registry: "",
    database: "none",
    protected: false,
  };
}

/** A build or a deploy that has ended. */
export function ended(state: string): boolean {
  return ["passed", "failed", "cancelled", "succeeded", "declined"].includes(state);
}
