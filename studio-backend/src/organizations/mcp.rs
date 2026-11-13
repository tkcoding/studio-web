//! A project's status, and a project's creation, as MCP tools (`crate::mcp`).

use serde_json::json;

use crate::mcp::sdk::{Effect, Run, Tool, object, project_id};

pub fn tools() -> Vec<Tool> {
    vec![
        Tool {
            name: "project_status",
            description: "Where a project stands, as its Overview says: a verdict (`blocked`, \
                `at_risk`, `on_track`) with its reason, the signals behind it worst first (a \
                refused repository connection, a failed build or deploy, a product that does \
                not resolve, high findings, failing specs, stuck pull requests), each with \
                where to act on it, and the path from connecting a repository to a build with \
                the step to do next. `unread` names the sources that could not be read.",
            input_schema: || object(json!({ "project_id": project_id() }), &["project_id"]),
            effect: Effect::Read,
            experimental: false,
            run: Run::Get("/studio-organizations/v1/project-status"),
        },
        Tool {
            name: "project_create",
            description: "Create a project in a workspace, as one background run: the project \
                tenant, its configuration (mode, brief, owner, the workspace's required \
                stages), the repositories taken as its sources, a repository made or attached \
                for its gears with an optional starter gear, a PRD from the brief, and the kits \
                it asks for. What you ask for is checked as you now (the connections must be \
                the organization's own, not personal); the run then acts as Studio. Answers the \
                `run_id` and the new `project_id`; follow it with `project_create_status`. \
                Pass an `idempotency_key` so a resend does not make a second project. Creates \
                things in the organization and its repositories: say what you create first.",
            input_schema: || {
                object(
                    json!({
                        "workspace_id": { "type": "string", "format": "uuid" },
                        "name": { "type": "string", "maxLength": 200 },
                        "mode": { "type": "string", "enum": ["greenfield", "modernize"] },
                        "brief": { "type": "string",
                            "description": "What is being built; also the PRD's first answer." },
                        "type": { "type": "string", "description": "The project type." },
                        "owner_id": { "type": "string", "description": "You when absent." },
                        "sources": { "type": "array", "maxItems": 100, "items": { "type": "object",
                            "properties": {
                                "connection_id": { "type": "string", "format": "uuid" },
                                "full_path": { "type": "string", "description": "owner/name" },
                                "clone_url": { "type": "string" },
                                "default_branch": { "type": "string" }
                            },
                            "required": ["connection_id", "full_path", "clone_url"] } },
                        "repository": { "type": "object",
                            "properties": {
                                "mode": { "type": "string", "enum": ["new", "existing"] },
                                "connection_id": { "type": "string", "format": "uuid" },
                                "name": { "type": "string" },
                                "owner": { "type": "string" },
                                "is_org": { "type": "boolean" },
                                "private": { "type": "boolean" },
                                "full_path": { "type": "string" },
                                "clone_url": { "type": "string" },
                                "default_branch": { "type": "string" }
                            },
                            "required": ["mode", "connection_id"] },
                        "starter_gear": { "type": "object",
                            "properties": {
                                "slug": { "type": "string" },
                                "gear_kind": { "type": "string",
                                    "enum": ["service", "minimal", "plugin"] },
                                "parent_dir": { "type": "string" },
                                "plugin_host": { "type": "string" },
                                "plugin_spec": { "type": "string" },
                                "open_pr": { "type": "boolean" }
                            },
                            "required": ["slug"] },
                        "prd": { "type": "boolean",
                            "description": "Write a PRD from the brief (default: yes, unless a starter gear writes its own)." },
                        "kits": { "type": "array", "items": { "type": "object",
                            "properties": { "slug": { "type": "string" },
                                "version": { "type": "string" } },
                            "required": ["slug"] } },
                        "idempotency_key": { "type": "string" }
                    }),
                    &["workspace_id", "name"],
                )
            },
            effect: Effect::Write,
            experimental: true,
            run: Run::Post {
                path: "/studio-organizations/v1/project-creations",
                query: &[],
            },
        },
        Tool {
            name: "project_create_status",
            description: "Where a project's creation stands: the run's state (`queued`, \
                `running`, `succeeded`, `failed`, `cancelled`), each step's with a line on what \
                it did, the project's id and why it stopped. A failed run is retried with \
                `task_retry`, and continues where it stopped.",
            input_schema: || {
                object(
                    json!({
                        "run_id": { "type": "string", "format": "uuid" },
                        "organization_id": { "type": "string", "format": "uuid" }
                    }),
                    &["run_id", "organization_id"],
                )
            },
            effect: Effect::Read,
            experimental: false,
            run: Run::Get("/studio-organizations/v1/project-creations/{run_id}"),
        },
    ]
}
