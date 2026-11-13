//! What a kit brings, shown before anyone installs it (ADR-0068 §2, §4, §8).
//!
//! Organised by the sections of the kit manifest (`kit.gdl`, ADR-0068 §3):
//! screens, types, rules, functions, services, inbox sources, MCP tools,
//! permissions, and the working material `cfs` writes into a checkout.
//!
//! Where it comes from, per shelf:
//!
//! - **Built-in kits** are compiled into Studio, so their contents are
//!   declared here, beside [`super::service::builtin_catalogue`], and say only
//!   what Studio has today.
//! - **Official kits** are read from a copy of their `.cf-studio-kit.toml` at
//!   the commit [`super::service::official_catalogue`] pins (`manifests/`). A
//!   request never fetches anything. A deployment that pins another commit
//!   (`STUDIO_KIT_CATALOGUE`) or another repository gets empty contents and no
//!   manifest rather than a description of a version it does not install.
//! - **Organization kits** (ADR-0068 phase 7) are read from the manifest
//!   their shelf keeps ([`super::shelf`], [`super::manifest`]).

use super::service::{KitDescriptor, SHELF_BUILTIN, SHELF_OFFICIAL};

/// `manifest` of a built-in kit: its contents are compiled in.
pub const MANIFEST_BUILTIN: &str = "built-in";
/// `manifest` of a kit described by its installer manifest.
pub const MANIFEST_CF_STUDIO_KIT: &str = ".cf-studio-kit.toml";
/// `manifest` of a kit described by Studio's interim `kit.json` (an
/// organization's own kit, or a built-in kit that brings a model).
pub const MANIFEST_KIT_JSON: &str = "kit.json";

/// One kit of the library and what it brings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KitDetail {
    pub kit: KitDescriptor,
    pub contents: KitContents,
    /// Where `contents` came from: [`MANIFEST_BUILTIN`],
    /// [`MANIFEST_CF_STUDIO_KIT`], `kit.gdl`, or `None` when nothing reliable
    /// describes the kit (and `contents` is empty).
    pub manifest: Option<&'static str>,
}

/// What a kit brings, by the sections of its manifest. Every list may be
/// empty.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct KitContents {
    pub screens: Vec<KitScreen>,
    pub types: Vec<KitType>,
    pub rules: Vec<KitNamed>,
    pub functions: Vec<KitFunction>,
    pub services: Vec<KitNamed>,
    pub inbox: Vec<KitInboxSource>,
    pub mcp_tools: Vec<KitNamed>,
    pub permissions: KitPermissions,
    pub material: Vec<KitMaterial>,
    pub kinds: Vec<String>,
    pub docs: Vec<String>,
    /// The built micro-frontends it carries, `mfe/<package>`.
    pub mfe: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KitScreen {
    /// `tab` (on a level's tab bar) or `section` (inside another screen).
    pub kind: &'static str,
    pub level: String,
    pub label: String,
    /// The portal route, when the screen exists in the portal today.
    pub route: Option<String>,
    /// For a section: the slot it goes in.
    pub slot: Option<String>,
    /// Domain types another kit brings that the screen shows; the shell hides
    /// it where one is not installed.
    pub needs: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KitType {
    pub gts: String,
    pub name: String,
    pub description: Option<String>,
}

/// A rule, a service or an MCP tool: a name and what it is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KitNamed {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KitFunction {
    pub name: String,
    /// `wasm` or `agent`.
    pub runtime: &'static str,
    pub description: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KitInboxSource {
    pub id: String,
    pub label: String,
    /// Which screen and tool answer its items.
    pub destination: Option<super::manifest::ManifestInboxDestination>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct KitPermissions {
    pub reads: Vec<String>,
    pub writes: Vec<String>,
    pub listens: Vec<String>,
}

/// A file or directory `cfs` writes into a project's checkout.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KitMaterial {
    /// Relative to the kit's directory in the checkout
    /// (`<cf-studio-path>/config/kits/<slug>/`); a directory ends in `/`.
    pub path: String,
    pub description: Option<String>,
}

/// Kit `slug` of `library`, with what it brings; `None` when the library does
/// not hold it.
pub fn find(library: Vec<KitDescriptor>, slug: &str) -> Option<KitDetail> {
    let slug = super::service::normalize_slug(slug).ok()?;
    library
        .into_iter()
        .find(|kit| kit.slug == slug)
        .map(describe)
}

/// One kit of the library with what it brings.
pub fn describe(kit: KitDescriptor) -> KitDetail {
    let (contents, manifest) = match kit.shelf.as_str() {
        SHELF_BUILTIN => match builtin_contents(&kit.slug) {
            Some(mut contents) => {
                // What its compiled-in `kit.json` adds: a model, Inbox
                // sources, MCP tools and the routes behind them.
                if let Some(m) = super::manifest::builtin_manifest(&kit.slug) {
                    let more = super::manifest::contents_of(&m);
                    contents.screens.extend(more.screens);
                    contents.types.extend(more.types);
                    contents.inbox.extend(more.inbox);
                    contents.mcp_tools.extend(more.mcp_tools);
                    contents.rules.extend(more.rules);
                    contents.functions.extend(more.functions);
                    contents.permissions.reads.extend(more.permissions.reads);
                    contents.permissions.writes.extend(more.permissions.writes);
                    contents
                        .permissions
                        .listens
                        .extend(more.permissions.listens);
                }
                (contents, Some(MANIFEST_BUILTIN))
            }
            None => (KitContents::default(), None),
        },
        SHELF_OFFICIAL => match official_contents(&kit) {
            Some(contents) => (contents, Some(MANIFEST_CF_STUDIO_KIT)),
            None => (KitContents::default(), None),
        },
        _ => (KitContents::default(), None),
    };
    KitDetail {
        kit,
        contents,
        manifest,
    }
}

fn tab(level: &str, label: &str, route: Option<&str>) -> KitScreen {
    KitScreen {
        kind: "tab",
        level: level.to_owned(),
        label: label.to_owned(),
        route: route.map(str::to_owned),
        slot: None,
        needs: Vec::new(),
    }
}

fn project_tab(label: &str, route: Option<&str>) -> KitScreen {
    tab("project", label, route)
}

fn owned(items: &[&str]) -> Vec<String> {
    items.iter().map(|item| (*item).to_owned()).collect()
}

/// A built-in kit's contents: what Studio has for it today, nothing planned.
/// `None` for a slug that is not a built-in kit.
///
/// `permissions.reads` names the gears' routes the kit's screen calls, as
/// `METHOD /path`, and only routes it calls today; a `POST` that only
/// computes an answer (a plan, a preview, a check, a test of a connection) is
/// a read. `permissions.writes` names the routes that change something.
fn builtin_contents(slug: &str) -> Option<KitContents> {
    let contents = match slug {
        // Project status and phases, which have no screen of their own yet;
        // and the project templates a workspace offers (`project-templates-mfe`).
        "project-lifecycle" => KitContents {
            screens: vec![tab(
                "workspace",
                "Project templates",
                Some("/project-templates"),
            )],
            permissions: KitPermissions {
                reads: owned(&["GET /studio-organizations/v1/project-types"]),
                ..KitPermissions::default()
            },
            ..KitContents::default()
        },
        // The project's Specs section of `projects-mfe`, and the document types
        // a workspace offers (`document-types-mfe`).
        "project-specs" => KitContents {
            screens: vec![
                tab("workspace", "Document types", Some("/document-types")),
                project_tab("Specs", Some("/projects/specs")),
            ],
            permissions: KitPermissions {
                reads: owned(&[
                    "GET /studio-documents/v1/workspaces/{workspace_id}/types",
                    "GET /studio-documents/v1/spec-rows",
                    "GET /studio-spec-quality/v1/status",
                ]),
                ..KitPermissions::default()
            },
            ..KitContents::default()
        },
        // `reports-mfe`: the organization's reports (studio-reports).
        "org-reports" => KitContents {
            screens: vec![tab("organization", "Reports", Some("/reports"))],
            permissions: KitPermissions {
                reads: owned(&[
                    "GET /studio-reports/v1/reports",
                    "GET /studio-reports/v1/reports/{report_id}",
                ]),
                ..KitPermissions::default()
            },
            ..KitContents::default()
        },
        // The Issues tab: what a project has to decide before it builds from
        // its documents, computed by studio-documents.
        "project-issues" => KitContents {
            screens: vec![project_tab("Issues", Some("/issues"))],
            permissions: KitPermissions {
                reads: owned(&[
                    "GET /studio-documents/v1/project-domain-model/issues",
                    "GET /studio-documents/v1/project-domain-model/readiness",
                    "GET /studio-documents/v1/project-domain-model/doc-quality",
                    "GET /studio-documents/v1/project-domain-model",
                ]),
                writes: owned(&[
                    "POST /studio-documents/v1/project-domain-model/reviews",
                    "POST /studio-documents/v1/project-domain-model/findings/{fingerprint}/decision",
                    "POST /studio-documents/v1/project-domain-model/issues",
                    "POST /studio-documents/v1/project-domain-model/entities",
                    "POST /studio-documents/v1/project-domain-model/sentences/proposals",
                    "POST /studio-documents/v1/project-domain-model/glossary/decisions",
                ]),
                ..KitPermissions::default()
            },
            ..KitContents::default()
        },
        // `tests-mfe`: CI runs, the repositories and their open pull
        // requests, document checks and spec-to-code conformance.
        "project-tests" => KitContents {
            screens: vec![project_tab("Tests", Some("/tests"))],
            permissions: KitPermissions {
                reads: owned(&[
                    "GET /studio-artifact-ingest/v1/runs",
                    "GET /studio-artifact-ingest/v1/nodes",
                    "GET /studio-artifact-ingest/v1/open-pull-requests",
                    "POST /studio-documents/v1/pull-request-checks",
                    "GET /studio-documents/v1/workspaces/{workspace_id}/capabilities",
                    "GET /studio-spec-mapping/v1/capabilities",
                    "POST /studio-spec-mapping/v1/conformance",
                ]),
                ..KitPermissions::default()
            },
            ..KitContents::default()
        },
        // A section of `projects-mfe` today: the project's ingested
        // artifacts.
        "project-artifacts" => KitContents {
            screens: vec![project_tab("Artifacts", Some("/projects/artifacts"))],
            permissions: KitPermissions {
                reads: owned(&["GET /studio-artifact-ingest/v1/nodes"]),
                ..KitPermissions::default()
            },
            ..KitContents::default()
        },
        // `activity-mfe`: the project's Activity (the checks and comments
        // studio-artifact-ingest keeps) and its Timeline, which shows
        // project-lifecycle's `milestone` objects (ADR-0070 §2, §7). The
        // Timeline's extension declares `needs: ["milestone"]`, so the portal
        // hides it where that type is not installed; Activity needs no other
        // kit.
        "project-activity" => KitContents {
            screens: vec![
                project_tab("Activity", Some("/projects/activity")),
                KitScreen {
                    needs: vec!["milestone".to_owned()],
                    ..project_tab("Timeline", Some("/projects/timeline"))
                },
            ],
            permissions: KitPermissions {
                reads: owned(&[
                    "GET /studio-artifact-ingest/v1/activity",
                    "GET /studio-domain-model/v1/types",
                    "POST /studio-domain-model/v1/query",
                ]),
                writes: owned(&["POST /studio-domain-model/v1/mutate"]),
                ..KitPermissions::default()
            },
            ..KitContents::default()
        },
        // `costs-mfe`: the organization's costs, its price list and budgets
        // (studio-usage).
        "org-costs" => KitContents {
            screens: vec![KitScreen {
                kind: "tab",
                level: "organization".to_owned(),
                label: "Costs".to_owned(),
                route: Some("/costs".to_owned()),
                slot: None,
                needs: Vec::new(),
            }],
            permissions: KitPermissions {
                reads: owned(&[
                    "GET /studio-usage/v1/costs",
                    "GET /studio-usage/v1/prices",
                    "GET /studio-usage/v1/budgets",
                    "GET /studio-usage/v1/budget-status",
                ]),
                ..KitPermissions::default()
            },
            ..KitContents::default()
        },
        // `api-docs-mfe`, opened from the product menu: the gateway's
        // OpenAPI document, grouped by the gear that serves each route.
        "studio-api-docs" => KitContents {
            screens: vec![KitScreen {
                kind: "section",
                level: "platform".to_owned(),
                label: "Docs & API".to_owned(),
                route: Some("/api-docs".to_owned()),
                slot: Some("product-menu".to_owned()),
                needs: Vec::new(),
            }],
            permissions: KitPermissions {
                reads: owned(&["GET /openapi.json"]),
                ..KitPermissions::default()
            },
            ..KitContents::default()
        },
        // `components-mfe` (ADR-0042, ADR-0046): the platform's catalogue,
        // its gear repositories and the publication requests it answers;
        // the organization's catalogue and registry; and a project's
        // inventory, which has no screen in the new portal yet. The routes
        // are the ones the old prototype's screens call
        // (`components-catalog`, `component-registry`,
        // `catalogue-levels-view`, `platform-sources`,
        // `publication-requests`, `project-components-view`).
        "components" => KitContents {
            screens: vec![
                tab("platform", "Components", Some("/platform/components")),
                tab("platform", "Repositories", Some("/platform/repositories")),
                tab(
                    "platform",
                    "Publication requests",
                    Some("/platform/publication-requests"),
                ),
                tab("organization", "Components", Some("/components")),
                project_tab("Components", Some("/project-components")),
            ],
            permissions: KitPermissions {
                reads: owned(&[
                    "GET /studio-components-catalog/v1/components",
                    "GET /studio-components-catalog/v1/components/{name}/docs",
                    "GET /studio-components-catalog/v1/profiles",
                    "GET /studio-components-catalog/v1/versions",
                    "GET /studio-components-catalog/v1/component-values",
                    "GET /studio-components-catalog/v1/component-history",
                    "GET /studio-components-catalog/v1/field-schemas",
                    "GET /studio-components-catalog/v1/sources",
                    "GET /studio-components-catalog/v1/platform/sources",
                    "GET /studio-components-catalog/v1/platform/pins",
                    "GET /studio-components-catalog/v1/platform/publication-requests",
                    "GET /studio-components-catalog/v1/platform/curators",
                    "GET /studio-components-catalog/v1/publications",
                    "GET /studio-components-catalog/v1/registry",
                    "GET /studio-components-catalog/v1/registry/{name}",
                    "GET /studio-components-catalog/v1/registry/{name}/readiness",
                    "POST /studio-components-catalog/v1/registry/{name}/suggest",
                    "GET /studio-components-catalog/v1/registry/projects",
                    "GET /studio-components-catalog/v1/registry/excluded-projects",
                    "GET /studio-components-catalog/v1/registry/gear-repository",
                    "GET /studio-components-catalog/v1/project-components",
                    "GET /studio-tasks/v1/runs/{id}",
                    "GET /studio-kits/v1/catalog",
                    "GET /studio-product/v1/gearbox",
                    "GET /studio-product/v1/projects/{project_id}/product",
                    "GET /studio-connector/v1/connections",
                    "POST /studio-connector/v1/connections/{id}/test",
                    "GET /studio-user/v1/me",
                    "GET /studio-user/v1/me/colleagues",
                    "GET /studio-user/v1/organizations/{org_id}/members",
                    "GET /studio-documents/v1/workspaces/{workspace_id}/capabilities",
                    "GET /studio-documents/v1/project-domain-model",
                    "GET /studio-documents/v1/project-domain-model/glossary",
                    "GET /studio-spec-mapping/v1/plan",
                    "GET /studio-spec-mapping/v1/capabilities",
                    "POST /studio-spec-mapping/v1/conformance",
                ]),
                writes: owned(&[
                    "POST /studio-components-catalog/v1/sync",
                    "POST /studio-components-catalog/v1/platform/sync",
                    "POST /studio-components-catalog/v1/project-catalogue/sync",
                    "PUT /studio-components-catalog/v1/sources",
                    "PUT /studio-components-catalog/v1/platform/sources",
                    "PUT /studio-components-catalog/v1/platform/pins",
                    "PUT /studio-components-catalog/v1/platform/curators",
                    "POST /studio-components-catalog/v1/platform/publication-requests/{name}/decisions",
                    "POST /studio-components-catalog/v1/publications",
                    "POST /studio-components-catalog/v1/publications/{id}/decisions",
                    "POST /studio-components-catalog/v1/components/{name}/profile",
                    "POST /studio-components-catalog/v1/registry/{name}/decisions",
                    "POST /studio-components-catalog/v1/registry/{name}/declare",
                    "PUT /studio-components-catalog/v1/registry/excluded-projects",
                    "PUT /studio-components-catalog/v1/registry/gear-repository",
                    "DELETE /studio-components-catalog/v1/registry/gear-repository",
                    "POST /studio-components-catalog/v1/registry/gear-repository/create",
                    "POST /studio-components-catalog/v1/registry/scaffold",
                    "POST /studio-connector/v1/connections",
                    "PATCH /studio-connector/v1/connections/{id}",
                    "DELETE /studio-connector/v1/connections/{id}",
                ]),
                ..KitPermissions::default()
            },
            ..KitContents::default()
        },
        // `infrastructure-mfe` (ADR-0056 §2): the places an organization
        // holds, the environments on them, their namespaces, registries and
        // image retention, and the deploys waiting on a decision. The routes
        // are the ones the old prototype's `OrgInfrastructure` calls
        // (`environments-screen`, `namespace-assignments-view`,
        // `registry-browser-view`).
        "org-infrastructure" => KitContents {
            screens: vec![tab(
                "organization",
                "Infrastructure",
                Some("/infrastructure"),
            )],
            permissions: KitPermissions {
                reads: owned(&[
                    "GET /studio-environments/v1/environments",
                    "GET /studio-environments/v1/environments/{environment_id}/readiness",
                    "POST /studio-environments/v1/environments/{environment_id}/test",
                    "GET /studio-environments/v1/deployments",
                    "GET /studio-environments/v1/deployments/{deployment_id}/status",
                    "GET /studio-environments/v1/deployments/{deployment_id}/logs",
                    "GET /studio-environments/v1/research/projects",
                    "GET /studio-environments/v1/research/projects/{project}/hardware",
                    "GET /studio-environments/v1/namespace-assignments",
                    "GET /studio-environments/v1/image-retention",
                    "GET /studio-environments/v1/registries",
                    "GET /studio-environments/v1/registries/{connection_id}/repositories",
                    "GET /studio-environments/v1/registries/{connection_id}/repositories/{repository}/tags",
                    "GET /studio-environments/v1/registries/{connection_id}/orphans",
                    "GET /studio-connector/v1/connections",
                    "POST /studio-connector/v1/connections/{id}/test",
                    // Whether a Research place may be added (constructor-research).
                    "GET /studio-kits/v1/installed-kits",
                ]),
                writes: owned(&[
                    "POST /studio-environments/v1/environments",
                    "PUT /studio-environments/v1/environments/{environment_id}",
                    "DELETE /studio-environments/v1/environments/{environment_id}",
                    "PUT /studio-environments/v1/open-clusters",
                    "POST /studio-environments/v1/deployments/{deployment_id}/decisions",
                    "PUT /studio-environments/v1/namespace-assignments",
                    "PUT /studio-environments/v1/image-retention",
                    "DELETE /studio-environments/v1/registries/{connection_id}/repositories/{repository}/versions/{digest}",
                ]),
                ..KitPermissions::default()
            },
            ..KitContents::default()
        },
        // A project's Product (ADR-0043, ADR-0045, ADR-0056) — its map,
        // configurator, frontend and description — and its Releases: builds,
        // images, its own environments and deploys. Neither has a screen in
        // the new portal yet. The routes are the ones the old prototype's
        // `product-*-view`, `frontend-constructor-view`, `kits` (its product
        // part), `releases-tab`, `builds-tab`, `deploy-actions`,
        // `project-images` and `ProjectEnvironments` call.
        "product-releases" => KitContents {
            screens: vec![
                project_tab("Product", Some("/product")),
                project_tab("Releases", Some("/releases")),
            ],
            permissions: KitPermissions {
                reads: owned(&[
                    "GET /studio-product/v1/projects/{project_id}/product",
                    "POST /studio-product/v1/projects/{project_id}/product/preview",
                    "GET /studio-product/v1/projects/{project_id}/gear-repo",
                    "GET /studio-product/v1/product-description",
                    "GET /studio-product/v1/product-description-revisions",
                    "GET /studio-product/v1/product-description-revisions/{revision}",
                    "GET /studio-product/v1/product-description-branches",
                    "POST /studio-product/v1/product-description-outlines",
                    "GET /studio-product/v1/product-infra",
                    "GET /studio-product/v1/product-kind",
                    "GET /studio-product/v1/gdl-file",
                    "GET /studio-product/v1/gearbox",
                    "GET /studio-product/v1/gearbox/catalogue",
                    "POST /studio-product/v1/gearbox/complete",
                    "POST /studio-product/v1/gearbox/brings",
                    "POST /studio-product/v1/gearbox/config-schema",
                    "GET /studio-product/v1/gear-explanations",
                    "GET /studio-components-catalog/v1/components",
                    "GET /studio-components-catalog/v1/profiles",
                    "GET /studio-components-catalog/v1/sources",
                    "GET /studio-components-catalog/v1/screen-previews",
                    "GET /studio-components-catalog/v1/project-components",
                    "GET /studio-environments/v1/targets",
                    // The project's path to running (#1050), one read.
                    "GET /studio-environments/v1/project-path",
                    "GET /studio-environments/v1/config-secrets",
                    "GET /studio-environments/v1/deployments/{deployment_id}",
                    // The Research targets of the one deploy dialog (#1053),
                    // answered only where constructor-research applies.
                    "GET /studio-environments/v1/research/my-projects",
                    "GET /studio-environments/v1/research/my-projects/{research_project}/hardware",
                    "GET /studio-environments/v1/environments",
                    "GET /studio-environments/v1/environments/{environment_id}/infra-plan",
                    "GET /studio-environments/v1/project-environments",
                    "GET /studio-environments/v1/infra-services",
                    "GET /studio-environments/v1/project-build",
                    "POST /studio-environments/v1/builds/plan",
                    "GET /studio-environments/v1/builds/{build_id}/log",
                    "GET /studio-environments/v1/deployments",
                    "GET /studio-environments/v1/deployments/{deployment_id}/status",
                    "GET /studio-environments/v1/deployments/{deployment_id}/logs",
                    "GET /studio-environments/v1/images",
                    "GET /studio-environments/v1/images/{image_id}",
                    "GET /studio-environments/v1/image-retention",
                    "GET /studio-artifact-ingest/v1/nodes",
                    "GET /studio-tasks/v1/runs/{id}",
                    "GET /studio-connector/v1/connections",
                    "GET /studio-documents/v1/workspaces/{workspace_id}/capabilities",
                    "GET /studio-documents/v1/project-domain-model",
                    "GET /studio-documents/v1/project-domain-model/glossary",
                    "GET /studio-spec-mapping/v1/plan",
                    "GET /studio-spec-mapping/v1/capabilities",
                    "GET /studio-spec-mapping/v1/requirements",
                    "POST /studio-spec-mapping/v1/conformance",
                ]),
                writes: owned(&[
                    "PUT /studio-product/v1/projects/{project_id}/product",
                    "POST /studio-product/v1/product-description-revisions",
                    "PUT /studio-product/v1/product-infra",
                    "PUT /studio-product/v1/product-kind",
                    "PUT /studio-product/v1/gear-explanations/{gear_id}",
                    "POST /studio-product/v1/gear-explanations/{gear_id}/generations",
                    "POST /studio-spec-mapping/v1/decisions",
                    "POST /studio-components-catalog/v1/sync",
                    "PUT /studio-components-catalog/v1/sources",
                    "PUT /studio-environments/v1/bindings",
                    "PUT /studio-environments/v1/infra-services",
                    "PUT /studio-environments/v1/project-build",
                    "POST /studio-environments/v1/project-environments",
                    "PUT /studio-environments/v1/project-environments/{environment_id}",
                    "DELETE /studio-environments/v1/project-environments/{environment_id}",
                    "POST /studio-environments/v1/builds",
                    "POST /studio-environments/v1/build-workflows",
                    "POST /studio-artifact-ingest/v1/builds/dispatch",
                    "POST /studio-environments/v1/deployments",
                    "POST /studio-environments/v1/deployments/{deployment_id}/decisions",
                    "DELETE /studio-environments/v1/previews/{deployment_id}",
                    "PUT /studio-environments/v1/config-secrets/{key}",
                    "DELETE /studio-environments/v1/config-secrets/{key}",
                    "POST /studio-environments/v1/images/imports",
                    "POST /studio-environments/v1/images/{image_id}/promotions",
                    "PUT /studio-environments/v1/images/{image_id}/pin",
                    "DELETE /studio-environments/v1/images/{image_id}/pin",
                    "DELETE /studio-environments/v1/images/{image_id}",
                    "PUT /studio-environments/v1/image-retention",
                ]),
                ..KitPermissions::default()
            },
            ..KitContents::default()
        },
        // The Project domain model (ADR-0066, ADR-0067; not the Studio domain
        // model): the model a project's documents make, the findings and
        // issues they leave to decide, the glossary, traces to work. The
        // portal's screen is `domain-model-mfe`; the routes are the ones the
        // old prototype's `spec-model-tab` called, under their new path.
        // `admin-mfe`'s Integrations section, shown for the organization in
        // scope. Admin › Integrations stays the platform administrator's.
        "org-connections" => KitContents {
            screens: vec![tab("organization", "Connections", Some("/connections"))],
            ..KitContents::default()
        },
        // Building and running a product in Constructor Research (ADR-0049,
        // docs/design/studio-kits.md §3.13). Not a base kit by default
        // (`OPT_IN_BUILTIN`); installed for an organization or one project.
        // Its screen is Organization › Constructor Research, an entry
        // of `infrastructure-mfe`; a project's build, deploy and rollback to
        // Research stay on its Releases tab (product-releases), and
        // studio-environments refuses them with `KIT_NOT_INSTALLED` where
        // this kit is not installed. Where it applies, the project's path
        // answers `research_kit` and the one "Deploy to…" dialog of
        // product-releases lists the caller's Research projects as a target
        // (#1053); without it the target is absent.
        "constructor-research" => KitContents {
            // Its Inbox sources, MCP tools and the routes behind the sources
            // are in its compiled-in kit.json
            // (`builtin/constructor-research.kit.json`).
            screens: vec![tab(
                "organization",
                "Constructor Research",
                Some("/constructor-research"),
            )],
            permissions: KitPermissions {
                reads: owned(&[
                    "GET /studio-environments/v1/environments",
                    "POST /studio-environments/v1/environments/{environment_id}/test",
                    "GET /studio-environments/v1/research/projects",
                    "GET /studio-environments/v1/research/projects/{project}/hardware",
                    // The Research target it adds to product-releases' one
                    // deploy dialog (#1053): the caller's own projects and
                    // hardware, the deploy, its log and where it answers.
                    "GET /studio-environments/v1/research/my-projects",
                    "GET /studio-environments/v1/research/my-projects/{research_project}/hardware",
                    "GET /studio-environments/v1/deployments",
                    "GET /studio-environments/v1/deployments/{deployment_id}",
                    "GET /studio-environments/v1/deployments/{deployment_id}/status",
                    "GET /studio-environments/v1/deployments/{deployment_id}/logs",
                    "GET /studio-environments/v1/builds/{build_id}/log",
                    "GET /studio-connector/v1/connections",
                ]),
                writes: owned(&[
                    "POST /studio-environments/v1/environments",
                    "PUT /studio-environments/v1/environments/{environment_id}",
                    "POST /studio-environments/v1/project-environments",
                    "POST /studio-environments/v1/builds",
                    "POST /studio-environments/v1/deployments",
                ]),
                ..KitPermissions::default()
            },
            ..KitContents::default()
        },
        // `team-mfe`: a project's Team, the role grants scoped to it in the
        // organization's access config. That config is account-management's
        // tenant metadata (read and written whole, as the old prototype did),
        // a platform route outside this backend's contract, so it is not
        // listed here.
        "project-team" => KitContents {
            screens: vec![project_tab("Team", Some("/projects/team"))],
            permissions: KitPermissions {
                reads: owned(&[
                    "GET /studio-user/v1/organizations/{org_id}/members",
                    "GET /studio-user/v1/me/colleagues",
                    "GET /studio-organizations/v1/access-catalogue",
                ]),
                ..KitPermissions::default()
            },
            ..KitContents::default()
        },
        // `assistant-mfe`: Studio AI, docked in the shell's sidebar beside
        // whatever screen is open (the old prototype's `studio-ai.tsx`). No
        // route: it is not a tab. It answers through studio-llm-proxy on the
        // person's own key (a workspace's AI connections count inside a
        // workspace); a chat completion only computes an answer, so it is a
        // read. Its model, tool and message types come with ADR-0070 phase 8.
        "assistant" => KitContents {
            screens: vec![KitScreen {
                kind: "section",
                level: "organization".to_owned(),
                label: "Studio AI".to_owned(),
                route: None,
                slot: Some("sidebar".to_owned()),
                needs: Vec::new(),
            }],
            permissions: KitPermissions {
                reads: owned(&[
                    "GET /studio-llm/v1/client-config",
                    "GET /studio-llm/v1/workspaces/{workspace_id}/client-config",
                    "POST /studio-llm/v1/chat/completions",
                    "POST /studio-llm/v1/workspaces/{workspace_id}/chat/completions",
                ]),
                ..KitPermissions::default()
            },
            ..KitContents::default()
        },
        // `project-git`: a Git host's workflow (ADR-0070 phase 5, #1036): the
        // pull requests of a project's repositories, `repository.hosts`. No
        // screen of its own yet; its Inbox source and status signal follow
        // with #1039. The model comes from its `kit.json`.
        "project-git" => KitContents::default(),
        "project-domain-model" => KitContents {
            screens: vec![project_tab("Project domain model", Some("/domain-model"))],
            permissions: KitPermissions {
                reads: owned(&[
                    "GET /studio-documents/v1/project-domain-model",
                    "GET /studio-documents/v1/project-domain-model/build-estimate",
                    "GET /studio-documents/v1/project-domain-model/findings",
                    "GET /studio-documents/v1/project-domain-model/reviews",
                    "GET /studio-documents/v1/project-domain-model/requirements",
                    "GET /studio-documents/v1/project-domain-model/related",
                    "GET /studio-documents/v1/project-domain-model/trace",
                    "GET /studio-documents/v1/project-domain-model/work",
                    "GET /studio-documents/v1/project-domain-model/check-methods",
                    "GET /studio-documents/v1/project-domain-model/glossary",
                    "GET /studio-documents/v1/project-domain-model/glossary/document",
                    "GET /studio-spec-mapping/v1/findings",
                    "GET /studio-spec-mapping/v1/plan",
                    "GET /studio-kits/v1/projects/{project_id}/installations",
                    "GET /studio-user/v1/organizations/{org_id}/members",
                    "GET /studio-user/v1/organizations/{org_id}/members/{user_id}/identities",
                ]),
                writes: owned(&[
                    "POST /studio-documents/v1/project-domain-model/builds",
                    "POST /studio-documents/v1/project-domain-model/entities",
                    "POST /studio-documents/v1/project-domain-model/reviews",
                    "POST /studio-documents/v1/project-domain-model/issues",
                    "POST /studio-documents/v1/project-domain-model/findings/{fingerprint}/decision",
                    "POST /studio-documents/v1/project-domain-model/findings/{fingerprint}/proposals",
                    "POST /studio-documents/v1/project-domain-model/files/proposals",
                    "POST /studio-documents/v1/project-domain-model/sentences/proposals",
                    "POST /studio-documents/v1/project-domain-model/glossary/decisions",
                    "POST /studio-documents/v1/project-domain-model/glossary/distinct",
                    "POST /studio-documents/v1/project-domain-model/glossary/proposals",
                    "POST /studio-documents/v1/project-domain-model/glossary/document/proposals",
                    "POST /studio-documents/v1/workspaces/{workspace_id}/projects/{project_id}/documents",
                ]),
                ..KitPermissions::default()
            },
            ..KitContents::default()
        },
        _ => return None,
    };
    Some(contents)
}

/// An official kit's installer manifest as it is at a pinned commit.
struct ManifestCopy {
    slug: &'static str,
    repository_url: &'static str,
    commit: &'static str,
    body: &'static str,
}

/// The copies in `manifests/`, one per official kit, at the commits
/// [`super::service::official_catalogue`] pins.
const MANIFEST_COPIES: &[ManifestCopy] = &[
    ManifestCopy {
        slug: "sdlc",
        repository_url: "https://github.com/constructorfabric/studio-kit-sdlc",
        commit: "5c5b85c870cb4b62ed0506ae1a8ca196156d1c74",
        body: include_str!("manifests/sdlc.cf-studio-kit.toml"),
    },
    ManifestCopy {
        slug: "compete",
        repository_url: "https://github.com/constructorfabric/studio-kits-pm",
        commit: "fbd2f5c43fd1f34d2c12767f2d57f6ac107f2b48",
        body: include_str!("manifests/compete.cf-studio-kit.toml"),
    },
];

fn same_repository(left: &str, right: &str) -> bool {
    let norm = |url: &str| {
        url.trim()
            .trim_end_matches('/')
            .trim_end_matches(".git")
            .to_ascii_lowercase()
    };
    norm(left) == norm(right)
}

/// What an official kit brings, from the copy of its manifest -- only when
/// the catalogue offers it from that repository at that commit.
fn official_contents(kit: &KitDescriptor) -> Option<KitContents> {
    let copy = MANIFEST_COPIES.iter().find(|copy| {
        copy.slug == kit.slug
            && copy.commit == kit.default_version
            && same_repository(copy.repository_url, &kit.repository_url)
    })?;
    read_manifest(copy.body, copy.slug)
}

/// The material and artifact kinds of kit `slug` in a `.cf-studio-kit.toml`
/// (a single- or multi-kit manifest), read line by line as the catalogue
/// reads its kits (`components_catalog::repo_enrich::manifest_kits`). `None`
/// when the manifest has no such kit.
///
/// A resource is material at its `install_path`; the kinds are the keys of
/// `[kits.resources.artifacts.<KIND>]`, in the manifest's order.
pub(super) fn read_manifest(body: &str, slug: &str) -> Option<KitContents> {
    #[derive(PartialEq)]
    enum At {
        Elsewhere,
        Kit,
        Resource,
    }
    let mut at = At::Elsewhere;
    let mut current_slug: Option<String> = None;
    let mut found = false;
    let mut contents = KitContents::default();
    // install_path, description, is a directory
    let mut resource: Option<(Option<String>, Option<String>, bool)> = None;
    let flush = |resource: &mut Option<(Option<String>, Option<String>, bool)>,
                 ours: bool,
                 contents: &mut KitContents| {
        if let Some((Some(path), description, directory)) = resource.take()
            && ours
        {
            let path = if directory && !path.ends_with('/') {
                format!("{path}/")
            } else {
                path
            };
            contents.material.push(KitMaterial { path, description });
        }
    };
    for raw in body.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let ours = current_slug.as_deref() == Some(slug);
        if line.starts_with('[') {
            flush(&mut resource, ours, &mut contents);
            at = At::Elsewhere;
            if line == "[[kits]]" {
                current_slug = None;
                at = At::Kit;
            } else if line == "[[kits.resources]]" {
                resource = Some((None, None, false));
                at = At::Resource;
            } else if let Some(kind) = line
                .strip_prefix("[kits.resources.artifacts.")
                .and_then(|rest| rest.strip_suffix(']'))
            {
                let kind = kind.trim().trim_matches('"').to_owned();
                if ours && !kind.is_empty() && !contents.kinds.contains(&kind) {
                    contents.kinds.push(kind);
                }
            }
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        let string = value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .map(str::to_owned);
        match at {
            At::Kit if key == "slug" => {
                current_slug = string;
                found |= current_slug.as_deref() == Some(slug);
            }
            At::Resource => {
                if let Some((path, description, directory)) = resource.as_mut() {
                    match key {
                        "install_path" => *path = string,
                        "description" => *description = string,
                        "type" => *directory = string.as_deref() == Some("directory"),
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    let ours = current_slug.as_deref() == Some(slug);
    flush(&mut resource, ours, &mut contents);
    found.then_some(contents)
}

#[cfg(test)]
#[path = "contents_tests.rs"]
mod tests;
