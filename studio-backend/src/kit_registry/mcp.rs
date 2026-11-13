//! The kit library and its installer, as MCP tools (`crate::mcp`): an agent
//! installs a kit the way a person does (ADR-0068 §5), through the same REST
//! routes and so under the same checks.

use serde_json::{Value, json};

use crate::mcp::sdk::{Effect, Run, Tool, object};

fn organization_id() -> Value {
    json!({ "type": "string",
        "description": "The organization (its tenant id); the caller's own when absent." })
}

fn project_id() -> Value {
    json!({ "type": "string",
        "description": "The project (its tenant id)." })
}

fn kit_slug() -> Value {
    json!({ "type": "string",
        "description": "The kit's slug, from `kits_catalog`." })
}

fn version() -> Value {
    json!({ "type": "string",
        "description": "A Git ref for an official kit; the kit's default when absent. A built-in kit takes Studio's version only." })
}

pub fn tools() -> Vec<Tool> {
    vec![
        Tool {
            name: "kits_catalog",
            description: "The kit library: every kit a person may install, each with its \
                `shelf` (`builtin`: shipped in Studio; `official`: Constructor's, from its own \
                repository; `organization`: an organization's own), the `levels` it may be \
                installed on, and its `default_version`. Optionally one shelf.",
            input_schema: || {
                object(
                    json!({
                        "shelf": { "type": "string", "enum": ["builtin", "official", "organization"] },
                        "organization_id": { "type": "string",
                            "description": "List this organization's own kits too (its shelf)." },
                        "limit": { "type": "integer" },
                        "offset": { "type": "integer" }
                    }),
                    &[],
                )
            },
            effect: Effect::Read,
            experimental: false,
            run: Run::Get("/studio-kits/v1/catalog"),
        },
        Tool {
            name: "kits_describe",
            description: "What is inside one kit, before anyone installs it: the catalogue \
                entry and its `contents` by the sections of a kit manifest (`screens`, `types`, \
                `rules`, `functions`, `services`, `inbox`, `mcp_tools`, `permissions`, the \
                `material` cfs writes into a checkout, artifact `kinds`, `docs`), and \
                `manifest`, where that came from (`built-in`, `.cf-studio-kit.toml`, or null \
                when nothing reliable describes it). An organization's own kit is described \
                from the manifest kept at its pinned commit, with `origin`.",
            input_schema: || {
                object(
                    json!({ "kit_slug": kit_slug(), "organization_id": organization_id() }),
                    &["kit_slug"],
                )
            },
            effect: Effect::Read,
            experimental: false,
            run: Run::Get("/studio-kits/v1/catalog/{kit_slug}"),
        },
        Tool {
            name: "kits_installed",
            description: "The kits that apply to an organization, or to a project with \
                `project_id`: `base` (installed by the platform for every organization; the \
                organization cannot uninstall these), `organization` (installed by the \
                organization for itself), `project` (installed for that project alone; empty \
                without `project_id`) and `effective` (all together, one entry per kit at the \
                newest version).",
            input_schema: || {
                object(
                    json!({ "organization_id": organization_id(), "project_id": project_id() }),
                    &[],
                )
            },
            effect: Effect::Read,
            experimental: false,
            run: Run::Get("/studio-kits/v1/installed-kits"),
        },
        Tool {
            name: "kit_base_install",
            description: "Install a kit for EVERY organization, as a base kit. Platform \
                administrators only. Installing it again changes its version. Ask your person \
                first: every organization's people see what the kit brings.",
            input_schema: || {
                object(
                    json!({ "kit_slug": kit_slug(), "version": version() }),
                    &["kit_slug"],
                )
            },
            effect: Effect::Write,
            experimental: true,
            run: Run::Put {
                path: "/studio-kits/v1/base-kits/{kit_slug}",
                query: &[],
            },
        },
        Tool {
            name: "kit_base_uninstall",
            description: "Stop a kit being installed for every organization. Platform \
                administrators only. A built-in kit stays removed until it is installed again; \
                organizations that installed the kit themselves keep it. Ask your person first.",
            input_schema: || object(json!({ "kit_slug": kit_slug() }), &["kit_slug"]),
            effect: Effect::Destructive,
            experimental: true,
            run: Run::Delete("/studio-kits/v1/base-kits/{kit_slug}"),
        },
        Tool {
            name: "kit_organization_install",
            description: "Install a kit for one organization only. Its administrators (or a \
                platform administrator) only. Installing it again changes its version; a kit \
                that is also a base kit applies at the newer of the two versions.",
            input_schema: || {
                object(
                    json!({
                        "organization_id": organization_id(),
                        "kit_slug": kit_slug(),
                        "version": version()
                    }),
                    &["kit_slug"],
                )
            },
            effect: Effect::Write,
            experimental: true,
            run: Run::Put {
                path: "/studio-kits/v1/organization-kits/{kit_slug}",
                query: &["organization_id"],
            },
        },
        Tool {
            name: "kit_organization_uninstall",
            description: "Uninstall a kit the organization installed for itself. Its \
                administrators only. A base kit cannot be uninstalled by an organization \
                (refused with `BASE_KIT`). Ask your person first.",
            input_schema: || {
                object(
                    json!({ "organization_id": organization_id(), "kit_slug": kit_slug() }),
                    &["kit_slug"],
                )
            },
            effect: Effect::Destructive,
            experimental: true,
            run: Run::Delete("/studio-kits/v1/organization-kits/{kit_slug}"),
        },
        Tool {
            name: "kit_project_install",
            description: "Install a kit for one project only. Whoever may install kits for the \
                project's organization (its administrators, or a platform administrator). Only \
                a kit whose `levels` include `project` (refused with `NOT_A_PROJECT_KIT`). \
                Installing it again changes its version; a kit the organization or the \
                platform also installed applies at the newest version.",
            input_schema: || {
                object(
                    json!({
                        "project_id": project_id(),
                        "kit_slug": kit_slug(),
                        "version": version()
                    }),
                    &["project_id", "kit_slug"],
                )
            },
            effect: Effect::Write,
            experimental: true,
            run: Run::Put {
                path: "/studio-kits/v1/project-kits/{kit_slug}",
                query: &["project_id"],
            },
        },
        Tool {
            name: "kit_project_uninstall",
            description: "Uninstall a kit installed for one project. Whoever may install kits \
                for the project's organization. A kit the project has from its organization \
                (`ORGANIZATION_KIT`) or the platform (`BASE_KIT`) is refused. Ask your person \
                first.",
            input_schema: || {
                object(
                    json!({ "project_id": project_id(), "kit_slug": kit_slug() }),
                    &["project_id", "kit_slug"],
                )
            },
            effect: Effect::Destructive,
            experimental: true,
            run: Run::Delete("/studio-kits/v1/project-kits/{kit_slug}"),
        },
        Tool {
            name: "kits_shelf",
            description: "The kits an organization added from its own repositories (its \
                shelf), each described as `kits_describe` does, with `origin`: the connection, \
                repository, directory and ref it was read from and the commit it is pinned to.",
            input_schema: || {
                object(
                    json!({
                        "organization_id": organization_id(),
                        "limit": { "type": "integer" },
                        "offset": { "type": "integer" }
                    }),
                    &[],
                )
            },
            effect: Effect::Read,
            experimental: false,
            run: Run::Get("/studio-kits/v1/organization-shelf"),
        },
        Tool {
            name: "kit_shelf_preview",
            description: "Read a kit from a repository the organization's connection reaches \
                without adding it: what adding it would add. The organization's kit \
                administrators only.",
            input_schema: shelf_source_schema,
            effect: Effect::Read,
            experimental: true,
            run: Run::Post {
                path: "/studio-kits/v1/organization-shelf/preview",
                query: &["organization_id"],
            },
        },
        Tool {
            name: "kit_shelf_add",
            description: "Add a kit from a repository to the organization's shelf, pinned to \
                the newest commit that touched its directory on `ref`. Then install it with \
                `kit_organization_install` or `kit_project_install`. The organization's kit \
                administrators only. Ask your person first.",
            input_schema: shelf_source_schema,
            effect: Effect::Write,
            experimental: true,
            run: Run::Post {
                path: "/studio-kits/v1/organization-shelf",
                query: &["organization_id"],
            },
        },
        Tool {
            name: "kit_shelf_refresh",
            description: "Read a shelf kit's source again at its ref and re-pin it. Those who \
                installed it keep the commit they installed until they install it again.",
            input_schema: || {
                object(
                    json!({ "organization_id": organization_id(), "kit_slug": kit_slug() }),
                    &["kit_slug"],
                )
            },
            effect: Effect::Write,
            experimental: true,
            run: Run::Post {
                path: "/studio-kits/v1/organization-shelf/{kit_slug}/refresh",
                query: &["organization_id"],
            },
        },
        Tool {
            name: "kit_shelf_remove",
            description: "Take a kit off the organization's shelf. Refused with `KIT_INSTALLED` \
                while the organization has it installed. Ask your person first.",
            input_schema: || {
                object(
                    json!({ "organization_id": organization_id(), "kit_slug": kit_slug() }),
                    &["kit_slug"],
                )
            },
            effect: Effect::Destructive,
            experimental: true,
            run: Run::Delete("/studio-kits/v1/organization-shelf/{kit_slug}"),
        },
        Tool {
            name: "kits_inbox_sources",
            description: "The Inbox sources of the kits installed for an organization: each \
                kit's query over its objects that says what waits on whom (`$me` is the person), \
                how an item is titled, and the kit. `me_inbox` runs them for you.",
            input_schema: || object(json!({ "organization_id": organization_id() }), &[]),
            effect: Effect::Read,
            experimental: false,
            run: Run::Get("/studio-kits/v1/inbox-sources"),
        },
        Tool {
            name: "project_phase",
            description: "A project's phase (the built-in Project lifecycle kit): the phase, who \
                moves it on and since when, the lifecycle's phases and the moves open from the \
                current one. `installed` is false where the kit does not apply.",
            input_schema: || object(json!({ "project_id": project_id() }), &["project_id"]),
            effect: Effect::Read,
            experimental: false,
            run: Run::Get("/studio-kits/v1/project-phase"),
        },
        Tool {
            name: "project_phase_set",
            description: "Move a project to a phase along the lifecycle Project lifecycle \
                declares (idea → discovery → build → run, and back); a move it does not declare \
                is refused with `NO_SUCH_TRANSITION`. `owner` (a subject id) is who moves it on \
                from there; the project's current owner, else you, when absent.",
            input_schema: || {
                object(
                    json!({
                        "project_id": project_id(),
                        "phase": { "type": "string", "enum": ["idea", "discovery", "build", "run"] },
                        "owner": { "type": "string" }
                    }),
                    &["project_id", "phase"],
                )
            },
            effect: Effect::Write,
            experimental: true,
            run: Run::Put {
                path: "/studio-kits/v1/project-phase",
                query: &["project_id"],
            },
        },
        Tool {
            name: "project_phases",
            description: "Every project of an organization that has a phase (Project \
                lifecycle), by project id, with its owner and since when.",
            input_schema: || {
                object(
                    json!({
                        "organization_id": organization_id(),
                        "limit": { "type": "integer" },
                        "offset": { "type": "integer" }
                    }),
                    &[],
                )
            },
            effect: Effect::Read,
            experimental: false,
            run: Run::Get("/studio-kits/v1/project-phases"),
        },
    ]
}

fn shelf_source_schema() -> Value {
    object(
        json!({
            "organization_id": organization_id(),
            "connection_id": { "type": "string",
                "description": "A connection of the organization's own (not personal) that reaches the repository." },
            "repository": { "type": "string", "description": "`owner/name`." },
            "path": { "type": "string", "description": "The kit's directory; the root when absent." },
            "ref": { "type": "string", "description": "A branch, tag or commit; the default branch when absent." },
            "slug": { "type": "string", "description": "Which kit of a `.cf-studio-kit.toml` that lists several." }
        }),
        &["connection_id", "repository"],
    )
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::tools;
    use crate::mcp::sdk::{Method, request_of};

    #[test]
    fn each_tool_sends_the_route_a_person_would() {
        let all = tools();
        let r = request_of(&all, "kits_describe", json!({"kit_slug": "sdlc"}));
        assert_eq!(r.method, Method::Get);
        assert_eq!(r.path, "/studio-kits/v1/catalog/sdlc");
        assert!(r.query.is_empty());

        let r = request_of(&all, "kits_installed", json!({"organization_id": "o-1"}));
        assert_eq!(r.method, Method::Get);
        assert_eq!(r.path, "/studio-kits/v1/installed-kits");
        assert_eq!(
            r.query,
            vec![("organization_id".to_owned(), "o-1".to_owned())]
        );

        let r = request_of(
            &all,
            "kit_organization_install",
            json!({"organization_id": "o-1", "kit_slug": "sdlc", "version": "v1"}),
        );
        assert_eq!(r.method, Method::Put);
        assert_eq!(r.path, "/studio-kits/v1/organization-kits/sdlc");
        assert_eq!(
            r.query,
            vec![("organization_id".to_owned(), "o-1".to_owned())]
        );
        assert_eq!(r.body, json!({"version": "v1"}));

        let r = request_of(
            &all,
            "kit_base_install",
            json!({"kit_slug": "project-issues"}),
        );
        assert_eq!(r.path, "/studio-kits/v1/base-kits/project-issues");
        assert_eq!(r.body, json!({}));

        let r = request_of(
            &all,
            "kit_project_install",
            json!({"project_id": "p-1", "kit_slug": "sdlc", "version": "v2"}),
        );
        assert_eq!(r.method, Method::Put);
        assert_eq!(r.path, "/studio-kits/v1/project-kits/sdlc");
        assert_eq!(r.query, vec![("project_id".to_owned(), "p-1".to_owned())]);
        assert_eq!(r.body, json!({"version": "v2"}));

        let r = request_of(
            &all,
            "kit_project_uninstall",
            json!({"project_id": "p-1", "kit_slug": "sdlc"}),
        );
        assert_eq!(r.method, Method::Delete);
        assert_eq!(r.path, "/studio-kits/v1/project-kits/sdlc");
        assert_eq!(r.query, vec![("project_id".to_owned(), "p-1".to_owned())]);

        let r = request_of(
            &all,
            "kit_shelf_add",
            json!({"organization_id": "o-1", "connection_id": "c-1", "repository": "acme/kits",
                   "path": "ops", "ref": "main"}),
        );
        assert_eq!(r.method, Method::Post);
        assert_eq!(r.path, "/studio-kits/v1/organization-shelf");
        assert_eq!(
            r.query,
            vec![("organization_id".to_owned(), "o-1".to_owned())]
        );
        assert_eq!(
            r.body,
            json!({"connection_id": "c-1", "repository": "acme/kits", "path": "ops", "ref": "main"})
        );

        let r = request_of(&all, "kit_shelf_refresh", json!({"kit_slug": "ops"}));
        assert_eq!(r.path, "/studio-kits/v1/organization-shelf/ops/refresh");

        let r = request_of(&all, "kit_shelf_remove", json!({"kit_slug": "ops"}));
        assert_eq!(r.method, Method::Delete);
        assert_eq!(r.path, "/studio-kits/v1/organization-shelf/ops");

        let r = request_of(
            &all,
            "project_phase_set",
            json!({"project_id": "p-1", "phase": "build"}),
        );
        assert_eq!(r.method, Method::Put);
        assert_eq!(r.path, "/studio-kits/v1/project-phase");
        assert_eq!(r.body, json!({"phase": "build"}));
        assert_eq!(r.query, vec![("project_id".to_owned(), "p-1".to_owned())]);

        let r = request_of(&all, "kits_installed", json!({"project_id": "p-1"}));
        assert_eq!(r.path, "/studio-kits/v1/installed-kits");
        assert_eq!(r.query, vec![("project_id".to_owned(), "p-1".to_owned())]);

        let r = request_of(
            &all,
            "kit_organization_uninstall",
            json!({"organization_id": "o-1", "kit_slug": "sdlc"}),
        );
        assert_eq!(r.method, Method::Delete);
        assert_eq!(r.path, "/studio-kits/v1/organization-kits/sdlc");
        assert_eq!(
            r.query,
            vec![("organization_id".to_owned(), "o-1".to_owned())]
        );
    }
}
