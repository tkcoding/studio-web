//! The project domain model (what a project's documents say; not the Studio
//! domain model), what the project has to decide before it builds from them,
//! and reviews of its documents, as MCP tools (`crate::mcp`).
//!
//! The same reads and writes the portal's Issues and Project domain model tabs
//! use: an agent sees the queue a person sees, and accepts or rejects a fact by
//! the `fact_key` the model returns, without hashing anything itself. The
//! review tools act on the requests the inbox (`user_profile/mcp.rs`) lists
//! beside everything else that waits.

use serde_json::json;

use crate::mcp::sdk::{Effect, Run, Tool, object, project_id};

pub fn tools() -> Vec<Tool> {
    vec![
        Tool {
            name: "project_domain_model_issues",
            description: "What a project has to decide before it builds from its documents \
                (its project domain model, not the Studio domain model), most blocking first: problems in the documents (dangling references, \
                contradictions), requirements left as open questions, assumptions, and buildable \
                requirements with no stated basis. Each row has its `group` (`blocks`, `look`, \
                `decided`), the passages it rests on, and the `actions` it offers: `confirm` / \
                `dismiss` are `project_domain_model_finding_decide` with the row's `fingerprint`.",
            input_schema: || {
                object(
                    json!({
                        "project_id": project_id(),
                        "group": { "type": "string", "enum": ["blocks", "look", "decided"],
                            "description": "Only that group." },
                        "offset": { "type": "integer", "minimum": 0 },
                        "limit": { "type": "integer", "minimum": 1, "maximum": 200,
                            "description": "Rows per page. Default 50." }
                    }),
                    &["project_id"],
                )
            },
            effect: Effect::Read,
            experimental: false,
            run: Run::Get("/studio-documents/v1/project-domain-model/issues"),
        },
        Tool {
            name: "project_domain_model_readiness",
            description: "Whether anything stops a build from a project's documents: how many \
                things wait for somebody (`open`), how many of them stop a build (`blocking`), \
                `ready` when none do, and how many requirements cite a source.",
            input_schema: || object(json!({ "project_id": project_id() }), &["project_id"]),
            effect: Effect::Read,
            experimental: false,
            run: Run::Get("/studio-documents/v1/project-domain-model/readiness"),
        },
        Tool {
            name: "project_domain_model_doc_quality",
            description: "What would make a project's documentation better, each change ready \
                to make: things only an ADR or a feature describes (`onlyadr`), things described \
                but never defined (`nodefinition`), relations only one side writes down \
                (`onesided`), things related to nothing their name implies (`norelation`), and \
                two glossary names that are probably one thing (`twonames`). A row's `edit` is \
                the entity section to save, its `sentence` the sentence to propose after a \
                passage, its `pair` the two names; `actions` says which. None stops a build.",
            input_schema: || {
                object(
                    json!({
                        "project_id": project_id(),
                        "kind": { "type": "string",
                            "enum": ["onlyadr", "nodefinition", "onesided", "norelation", "twonames"],
                            "description": "Only that kind." },
                        "offset": { "type": "integer", "minimum": 0 },
                        "limit": { "type": "integer", "minimum": 1, "maximum": 200,
                            "description": "Rows per page. Default 50." }
                    }),
                    &["project_id"],
                )
            },
            effect: Effect::Read,
            experimental: false,
            run: Run::Get("/studio-documents/v1/project-domain-model/doc-quality"),
        },
        Tool {
            name: "project_domain_model_entity_save",
            description: "Write one entity's section of the project's docs/domain-model.md: \
                what it is, what it holds, how it relates. Takes a `doc_quality` row's `edit` \
                as it is or corrected. The model reads it on its next build. Changes the \
                project's repository: say what you write first.",
            input_schema: || {
                object(
                    json!({
                        "project_id": project_id(),
                        "name": { "type": "string" },
                        "definition": { "type": "string" },
                        "fields": { "type": "array", "items": { "type": "object",
                            "properties": { "name": { "type": "string" },
                                "meaning": { "type": "string" } },
                            "required": ["name"] } },
                        "relations": { "type": "array", "items": { "type": "object",
                            "properties": { "verb": { "type": "string" },
                                "target": { "type": "string" } },
                            "required": ["verb", "target"] } }
                    }),
                    &["project_id", "name"],
                )
            },
            effect: Effect::Write,
            experimental: true,
            run: Run::Post {
                path: "/studio-documents/v1/project-domain-model/entities",
                query: &["project_id"],
            },
        },
        Tool {
            name: "project_domain_model_sentence_propose",
            description: "Propose a sentence for one of the project's documents, after the \
                passage at `line` of the revision the model read, as a pull request: a \
                `doc_quality` row's `sentence` (its verb may be changed). Changes the project's \
                repository: say what you propose first.",
            input_schema: || {
                object(
                    json!({
                        "project_id": project_id(),
                        "path": { "type": "string" },
                        "revision": { "type": "string" },
                        "line": { "type": "integer", "minimum": 1 },
                        "sentence": { "type": "string" },
                        "why": { "type": "string" }
                    }),
                    &["project_id", "path", "revision", "line", "sentence"],
                )
            },
            effect: Effect::Write,
            experimental: true,
            run: Run::Post {
                path: "/studio-documents/v1/project-domain-model/sentences/proposals",
                query: &["project_id"],
            },
        },
        Tool {
            name: "project_domain_model_facts",
            description: "The project domain model (what its documents say; not the Studio \
                domain model), as read from the documents so far: every fact (entity, \
                attribute, relation, requirement, constraint, lifecycle, decision) with the \
                passage it rests on and its `fact_key`, and where each document stands. The \
                `fact_key` is what `project_domain_model_fact_review` takes.",
            input_schema: || object(json!({ "project_id": project_id() }), &["project_id"]),
            effect: Effect::Read,
            experimental: false,
            run: Run::Get("/studio-documents/v1/project-domain-model"),
        },
        Tool {
            name: "project_domain_model_build",
            description: "Start reading a project's documents into its project domain model, on \
                your own model key (a build calls a model and costs tokens): every document not \
                read at its revision, or only the documents `path`, `paths` or `glob` select, \
                which are read again whatever their state and whose facts replace only theirs; \
                a path that is not a document of the model, or a glob matching none, refuses \
                the build and is named. Answers at once with the build's state; follow it with \
                `project_domain_model_build_status`. A build already running is answered, not \
                started twice. Say what you will read first.",
            input_schema: || {
                object(
                    json!({
                        "project_id": project_id(),
                        "path": { "type": "string",
                            "description": "One document to read again, as `project_domain_model_coverage` lists it." },
                        "paths": { "type": "array", "items": { "type": "string" }, "maxItems": 500,
                            "description": "Documents to read again, as `project_domain_model_coverage` lists them." },
                        "glob": { "type": "string",
                            "description": "Documents to read again by pattern: `*` within a directory, `**` across, `?` one character (`docs/prd/**`)." }
                    }),
                    &["project_id"],
                )
            },
            effect: Effect::Write,
            experimental: true,
            run: Run::Post {
                path: "/studio-documents/v1/project-domain-model/builds",
                query: &[],
            },
        },
        Tool {
            name: "project_domain_model_build_status",
            description: "Where a project's running or last build of its project domain model \
                stands: `running`, the `documents` it reads and how many are `done`, the one \
                being read (`current`), why it stopped (`error`, most often no model key), and \
                when it started and finished.",
            input_schema: || object(json!({ "project_id": project_id() }), &["project_id"]),
            effect: Effect::Read,
            experimental: false,
            run: Run::Get("/studio-documents/v1/project-domain-model/build"),
        },
        Tool {
            name: "project_domain_model_coverage",
            description: "What a project's domain model has read and what is missing to \
                interpret it: every document with its `state` (`extracted`, `failed` with its \
                `error`, `stale`, `pending`, `kept`), its facts and the facts `dropped` because \
                the text did not bear them out; the typed documents this server could not read \
                (`unread_paths`) and why (`unread_because`); and the requirements the documents \
                leave as `open_questions`.",
            input_schema: || object(json!({ "project_id": project_id() }), &["project_id"]),
            effect: Effect::Read,
            experimental: false,
            run: Run::Get("/studio-documents/v1/project-domain-model/coverage"),
        },
        Tool {
            name: "project_domain_model_uploads",
            description: "The CSV, JSON and plain-text sources uploaded to a project's domain \
                model, kept out of its repository: each with the `path` the model reads it under \
                (`upload:<name>`, what `project_domain_model_build` takes in `paths`), its \
                `kind`, and its `revision` (the hash of its content).",
            input_schema: || object(json!({ "project_id": project_id() }), &["project_id"]),
            effect: Effect::Read,
            experimental: false,
            run: Run::Get("/studio-documents/v1/project-domain-model/uploads"),
        },
        Tool {
            name: "project_domain_model_upload",
            description: "Upload a CSV, JSON or plain-text source (a survey export, an \
                interview transcript, a list of requests) for a project's domain model to read, \
                without committing it to the repository. `name` ends in .csv, .tsv, .json, .txt \
                or .text; `content` is the text, at most 512 KiB. The same name replaces the \
                earlier upload. It is read on the next `project_domain_model_build`. Shared by \
                the whole project: say what you upload first.",
            input_schema: || {
                object(
                    json!({
                        "project_id": project_id(),
                        "name": { "type": "string", "maxLength": 120 },
                        "content": { "type": "string" }
                    }),
                    &["project_id", "name", "content"],
                )
            },
            effect: Effect::Write,
            experimental: true,
            run: Run::Post {
                path: "/studio-documents/v1/project-domain-model/uploads",
                query: &[],
            },
        },
        Tool {
            name: "project_domain_model_upload_remove",
            description: "Remove a source uploaded to a project's domain model, by the `id` \
                `project_domain_model_uploads` lists: its file is deleted and its facts leave the \
                model. Ask your person first.",
            input_schema: || {
                object(
                    json!({
                        "project_id": project_id(),
                        "upload_id": { "type": "string" }
                    }),
                    &["project_id", "upload_id"],
                )
            },
            effect: Effect::Destructive,
            experimental: true,
            run: Run::Delete("/studio-documents/v1/project-domain-model/uploads/{upload_id}"),
        },
        Tool {
            name: "project_domain_model_fact_review",
            description: "Accept, reject or correct facts the model read, or put them back as \
                proposed: an accepted fact is the project's reading, a rejected one leaves the \
                model and is not proposed again while its passage says the same, and a \
                `corrected` one (with the new `value`) is shown with your value in place of the \
                one read, which `project_domain_model_facts` keeps as `extracted_value`. Each \
                item is a `fact_key` from `project_domain_model_facts`, a `state`, and the fact's \
                `path` and document `revision`. Shared by the whole project: say what you decide \
                first.",
            input_schema: || {
                object(
                    json!({
                        "project_id": project_id(),
                        "items": { "type": "array", "minItems": 1, "maxItems": 500,
                            "items": { "type": "object",
                                "properties": {
                                    "fact_key": { "type": "string" },
                                    "state": { "type": "string",
                                        "enum": ["accepted", "rejected", "corrected", "proposed"] },
                                    "path": { "type": "string" },
                                    "revision": { "type": "string" },
                                    "note": { "type": "string" },
                                    "value": { "type": "string", "maxLength": 2000,
                                        "description": "With `corrected`: the fact's value as it should read." }
                                },
                                "required": ["fact_key", "state"] } }
                    }),
                    &["project_id", "items"],
                )
            },
            effect: Effect::Write,
            experimental: true,
            run: Run::Post {
                path: "/studio-documents/v1/project-domain-model/reviews",
                query: &[],
            },
        },
        Tool {
            name: "project_domain_model_finding_decide",
            description: "Say whether a problem `project_domain_model_issues` lists is real: `confirmed` \
                keeps it as a real problem (a confirmed contradiction stops a build), \
                `dismissed` takes it off the list. Takes the row's `fingerprint`. Shared by \
                the whole project: say what you decide first.",
            input_schema: || {
                object(
                    json!({
                        "project_id": project_id(),
                        "fingerprint": { "type": "string" },
                        "decision": { "type": "string", "enum": ["confirmed", "dismissed"] },
                        "note": { "type": "string", "description": "Why, at most 2000 characters." }
                    }),
                    &["project_id", "fingerprint", "decision"],
                )
            },
            effect: Effect::Write,
            experimental: true,
            run: Run::Post {
                path: "/studio-documents/v1/project-domain-model/findings/{fingerprint}/decision",
                query: &[],
            },
        },
        Tool {
            name: "review_requests",
            description: "A project's or a workspace's review requests, newest first: each \
                with its document (`title`, `version`), its reviewers and where each stands, \
                the required reviewers still awaited (`outstanding`) and whether it is past \
                its due date (`overdue`). `waiting_on: \"me\"` keeps the open requests that \
                still wait for your verdict. Give `project_id` or `workspace_id`.",
            input_schema: || {
                object(
                    json!({
                        "project_id": project_id(),
                        "workspace_id": { "type": "string", "description": "Every project of this workspace instead of one project." },
                        "subject_id": { "type": "string", "description": "Only this document's requests." },
                        "waiting_on": { "type": "string", "enum": ["me"] }
                    }),
                    &[],
                )
            },
            effect: Effect::Read,
            experimental: false,
            run: Run::Get("/studio-documents/v1/review-requests"),
        },
        Tool {
            name: "review_verdict",
            description: "Give your verdict on a review request you were asked to review: \
                `approved` or `changes_requested`, with an optional `note`; `security: true` \
                marks the changes asked for as a security concern, which holds the stage at \
                any maturity. A verdict is never edited: a later one is another record and the \
                latest counts. You must be one of the request's reviewers. Ask your person \
                first: the verdict is theirs and is kept on the record.",
            input_schema: || {
                object(
                    json!({
                        "request_id": { "type": "string", "description": "The review request's id (an `inbox` item's `act`, or `review_requests`)." },
                        "project_id": project_id(),
                        "verdict": { "type": "string", "enum": ["approved", "changes_requested"] },
                        "security": { "type": "boolean" },
                        "note": { "type": "string" }
                    }),
                    &["request_id", "project_id", "verdict"],
                )
            },
            effect: Effect::Write,
            experimental: true,
            run: Run::Post {
                path: "/studio-documents/v1/review-requests/{request_id}/approvals",
                query: &[],
            },
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::sdk::{Method, request_of};

    #[test]
    fn the_issues_tab_and_its_actions_are_tools() {
        let all = tools();
        let all: Vec<_> = all
            .into_iter()
            .filter(|t| t.name.starts_with("project_domain_model_"))
            .collect();
        let names: Vec<&str> = all.iter().map(|t| t.name).collect();
        assert_eq!(
            names,
            [
                "project_domain_model_issues",
                "project_domain_model_readiness",
                "project_domain_model_doc_quality",
                "project_domain_model_entity_save",
                "project_domain_model_sentence_propose",
                "project_domain_model_facts",
                "project_domain_model_build",
                "project_domain_model_build_status",
                "project_domain_model_coverage",
                "project_domain_model_uploads",
                "project_domain_model_upload",
                "project_domain_model_upload_remove",
                "project_domain_model_fact_review",
                "project_domain_model_finding_decide"
            ]
        );
        for t in &all {
            let schema = (t.input_schema)();
            assert_eq!(schema["required"][0], "project_id", "{}", t.name);
        }
    }

    #[test]
    fn a_build_is_the_route_the_portal_starts_and_marked_as_changing() {
        let all = tools();
        let build = all
            .iter()
            .find(|t| t.name == "project_domain_model_build")
            .expect("the build tool");
        assert_eq!(build.effect, Effect::Write, "a build costs tokens");
        assert!(build.experimental);
        let r = request_of(
            &all,
            "project_domain_model_build",
            json!({ "project_id": "p", "path": "docs/a.md" }),
        );
        assert_eq!(r.method, Method::Post);
        assert_eq!(r.path, "/studio-documents/v1/project-domain-model/builds");
        assert_eq!(r.body, json!({ "project_id": "p", "path": "docs/a.md" }));
        let r = request_of(
            &all,
            "project_domain_model_build",
            json!({ "project_id": "p", "paths": ["docs/a.md"], "glob": "docs/prd/**" }),
        );
        assert_eq!(
            r.body,
            json!({ "project_id": "p", "paths": ["docs/a.md"], "glob": "docs/prd/**" }),
            "a selection travels in the body"
        );
    }

    #[test]
    fn a_correction_is_a_review_with_the_new_value() {
        let all = tools();
        let review = all
            .iter()
            .find(|t| t.name == "project_domain_model_fact_review")
            .expect("the review tool");
        let schema = (review.input_schema)();
        let item = &schema["properties"]["items"]["items"]["properties"];
        assert!(
            item["state"]["enum"]
                .as_array()
                .is_some_and(|e| e.contains(&json!("corrected")))
        );
        assert_eq!(item["value"]["type"], "string");
        let r = request_of(
            &all,
            "project_domain_model_fact_review",
            json!({ "project_id": "p", "items": [
                { "fact_key": "k", "state": "corrected", "value": "90 days" }
            ] }),
        );
        assert_eq!(r.path, "/studio-documents/v1/project-domain-model/reviews");
        assert_eq!(r.body["items"][0]["value"], "90 days");
    }

    #[test]
    fn an_upload_is_written_and_removed_through_the_routes() {
        let all = tools();
        let r = request_of(
            &all,
            "project_domain_model_upload",
            json!({ "project_id": "p", "name": "a.csv", "content": "a,b" }),
        );
        assert_eq!(r.method, Method::Post);
        assert_eq!(r.path, "/studio-documents/v1/project-domain-model/uploads");
        assert_eq!(r.body["name"], "a.csv");
        let r = request_of(
            &all,
            "project_domain_model_upload_remove",
            json!({ "project_id": "p", "upload_id": "u1" }),
        );
        assert_eq!(r.method, Method::Delete);
        assert_eq!(
            r.path,
            "/studio-documents/v1/project-domain-model/uploads/u1"
        );
        assert_eq!(r.query, vec![("project_id".to_owned(), "p".to_owned())]);
        let remove = all
            .iter()
            .find(|t| t.name == "project_domain_model_upload_remove")
            .expect("remove");
        assert_eq!(remove.effect, Effect::Destructive);
    }

    #[test]
    fn status_and_coverage_are_reads_of_the_project() {
        for (tool, path) in [
            (
                "project_domain_model_build_status",
                "/studio-documents/v1/project-domain-model/build",
            ),
            (
                "project_domain_model_coverage",
                "/studio-documents/v1/project-domain-model/coverage",
            ),
        ] {
            let all = tools();
            let t = all.iter().find(|t| t.name == tool).expect(tool);
            assert_eq!(t.effect, Effect::Read, "{tool}");
            let r = request_of(&all, tool, json!({ "project_id": "p" }));
            assert_eq!(r.method, Method::Get, "{tool}");
            assert_eq!(r.path, path);
            assert_eq!(r.query, vec![("project_id".to_owned(), "p".to_owned())]);
        }
    }

    #[test]
    fn the_requests_waiting_on_the_caller_are_read_with_the_query() {
        let r = request_of(
            &tools(),
            "review_requests",
            json!({ "workspace_id": "w", "waiting_on": "me" }),
        );
        assert_eq!(r.method, Method::Get);
        assert_eq!(r.path, "/studio-documents/v1/review-requests");
        assert_eq!(
            r.query,
            vec![
                ("waiting_on".to_owned(), "me".to_owned()),
                ("workspace_id".to_owned(), "w".to_owned()),
            ]
        );
    }

    #[test]
    fn a_verdict_names_the_request_in_the_path_and_the_rest_in_the_body() {
        let r = request_of(
            &tools(),
            "review_verdict",
            json!({ "request_id": "r1", "project_id": "p", "verdict": "approved" }),
        );
        assert_eq!(r.method, Method::Post);
        assert_eq!(r.path, "/studio-documents/v1/review-requests/r1/approvals");
        assert_eq!(r.body, json!({ "project_id": "p", "verdict": "approved" }));
    }
}
