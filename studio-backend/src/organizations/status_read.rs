//! What a project's status is read from ([`super::status`]).
//!
//! The organization's own counts come from this gear in process (the
//! project's rollup and its line of the organization's health). The rest is
//! the other gears' answers, read through their REST routes as the caller
//! (`crate::mcp::sdk::Api`), the reads the portal made: the same checks
//! apply, so the status shows a caller no more than those routes would. A
//! read that fails is `None`, which the status words as not known.

use serde_json::Value;

use super::status::{
    BuildFacts, Deploy, FindingFacts, ModelFacts, PathFacts, ProductFacts, Pull, SpecQueues,
};
use crate::mcp::sdk::Api;

/// CI runs read for the last build, newest first.
const RUNS: u32 = 50;

fn u32_of(v: &Value) -> u32 {
    v.as_u64()
        .map_or(0, |n| u32::try_from(n).unwrap_or(u32::MAX))
}

fn len_of(v: &Value) -> u32 {
    v.as_array()
        .map_or(0, |a| u32::try_from(a.len()).unwrap_or(u32::MAX))
}

fn text(v: &Value) -> Option<String> {
    v.as_str().filter(|s| !s.is_empty()).map(str::to_string)
}

/// `GET /studio-documents/v1/spec-rows`: its three queues.
pub fn spec_queues(rows: &Value) -> SpecQueues {
    let n = |q: &str| {
        rows["sources"]["counts"]
            .as_array()
            .and_then(|cs| cs.iter().find(|c| c["queue"] == q))
            .map_or(0, |c| u32_of(&c["count"]))
    };
    SpecQueues {
        bound: n("bound"),
        needs_review: n("needs-review"),
        not_scanned: n("not-scanned"),
    }
}

/// `GET /studio-documents/v1/project-domain-model`.
pub fn model_facts(model: &Value) -> ModelFacts {
    let documents = model["documents"].as_array();
    ModelFacts {
        documents: len_of(&model["documents"]),
        extracted: documents.map_or(0, |ds| {
            u32::try_from(ds.iter().filter(|d| d["state"] == "extracted").count())
                .unwrap_or(u32::MAX)
        }),
        facts: len_of(&model["facts"]),
        running: model["build"]["running"].as_bool().unwrap_or(false),
    }
}

/// `GET /studio-documents/v1/project-domain-model/findings`: those nobody decided.
pub fn finding_facts(findings: &Value) -> FindingFacts {
    let open: Vec<&Value> = findings["items"]
        .as_array()
        .map(|is| is.iter().filter(|f| f["decision"].is_null()).collect())
        .unwrap_or_default();
    FindingFacts {
        open: u32::try_from(open.len()).unwrap_or(u32::MAX),
        high: u32::try_from(open.iter().filter(|f| f["severity"] == "high").count())
            .unwrap_or(u32::MAX),
    }
}

/// `GET /studio-product/v1/projects/{project_id}/product`: its record, or
/// nothing picked yet.
pub fn product_facts(page: &Value) -> ProductFacts {
    let v = &page["nodes"][0]["value"];
    let preview = &v["last_preview"];
    ProductFacts {
        gears: len_of(&v["gears"]),
        resolves: preview["ok"].as_bool(),
        errors: u32_of(&preview["errors"]),
        written: v["written"].as_bool().unwrap_or(false)
            || v["description"].as_str().is_some_and(|d| !d.is_empty())
            || v["description"].is_object(),
    }
}

/// A CI run's status in a build's words, from the provider's `status` and
/// `conclusion` (the portal's `buildStatus`).
pub fn build_status(status: Option<&str>, conclusion: Option<&str>) -> &'static str {
    if let Some(s) = status.filter(|s| !s.is_empty() && *s != "completed") {
        return if s == "in_progress" {
            "running"
        } else {
            "queued"
        };
    }
    match conclusion.filter(|c| !c.is_empty()) {
        None => "unknown",
        Some("success") => "passed",
        Some("cancelled") => "cancelled",
        Some("skipped" | "neutral") => "skipped",
        Some(_) => "failed",
    }
}

/// The newest finished run on the branch a product is built from — `main`
/// or `master` when the runs have one, else the branch with most runs —
/// from the `workflow_run` nodes (`buildsOf`, `mainBranch`,
/// `latestFinished`).
pub fn build_facts(page: &Value) -> BuildFacts {
    struct Run {
        branch: Option<String>,
        status: &'static str,
        short_sha: String,
        created_at: String,
    }
    let mut runs: Vec<Run> = page["nodes"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|n| {
            let v = &n["value"];
            let sha = text(&v["sha"]).unwrap_or_default();
            Run {
                branch: text(&v["branch"]),
                status: build_status(v["status"].as_str(), v["conclusion"].as_str()),
                short_sha: text(&v["short_sha"]).unwrap_or_else(|| sha.chars().take(7).collect()),
                created_at: text(&v["created_at"]).unwrap_or_default(),
            }
        })
        .collect();
    runs.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    let branches: Vec<&str> = runs.iter().filter_map(|r| r.branch.as_deref()).collect();
    let main = ["main", "master"]
        .into_iter()
        .find(|b| branches.contains(b))
        .map(str::to_string)
        .or_else(|| {
            // The branch with most runs; the first seen wins a tie.
            let mut counts: Vec<(&str, usize)> = Vec::new();
            for b in &branches {
                match counts.iter_mut().find(|(n, _)| n == b) {
                    Some((_, c)) => *c += 1,
                    None => counts.push((b, 1)),
                }
            }
            let mut best: Option<(&str, usize)> = None;
            for (b, c) in counts {
                if best.is_none_or(|(_, bc)| c > bc) {
                    best = Some((b, c));
                }
            }
            best.map(|(b, _)| b.to_string())
        });
    let last = runs
        .iter()
        .find(|r| r.branch == main && !matches!(r.status, "queued" | "running" | "unknown"));
    match last {
        Some(r) => BuildFacts::Last {
            status: r.status.to_string(),
            sha: r.short_sha.clone(),
        },
        None => BuildFacts::Never,
    }
}

/// `GET /studio-environments/v1/deployments`.
pub fn deploys(page: &Value) -> Vec<Deploy> {
    page["items"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|d| Deploy {
            action: text(&d["action"]),
            preview: d["preview"].as_bool().unwrap_or(false),
            state: text(&d["state"]).unwrap_or_default(),
            environment_name: text(&d["environment_name"]).unwrap_or_default(),
            reason: text(&d["reason"]),
            outcome: text(&d["outcome"]),
            at: text(&d["decided_at"])
                .or_else(|| text(&d["requested_at"]))
                .unwrap_or_default(),
        })
        .collect()
}

/// `GET /studio-artifact-ingest/v1/open-pull-requests`.
pub fn pulls(page: &Value) -> Vec<Pull> {
    page["items"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|p| Pull {
            draft: p["draft"].as_bool().unwrap_or(false),
            waiting: text(&p["waiting"]).unwrap_or_default(),
            waiting_on: p["waiting_on"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|w| {
                    w["display_name"]
                        .as_str()
                        .map(str::trim)
                        .filter(|n| !n.is_empty())
                        .map(str::to_string)
                        .or_else(|| text(&w["login"]))
                })
                .collect(),
            days_since_update: p["days_since_update"]
                .as_u64()
                .map(|d| u32::try_from(d).unwrap_or(u32::MAX)),
        })
        .collect()
}

/// The reads of the path and the other gears' signals, side by side.
pub struct Read {
    pub path: PathFacts,
    pub pulls: Option<Vec<Pull>>,
    pub deployments: Option<Vec<Deploy>>,
}

/// Every page of open pull requests is not needed: the first 200 hold what
/// a status counts on any project a person can read in one sitting.
const PULLS_PAGE: u32 = 200;

pub async fn read(api: &Api, project: &str, repositories: Option<u32>) -> Read {
    let q = |pairs: &[(&str, String)]| -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), v.clone()))
            .collect()
    };
    let p = project.to_string();
    let by_project = q(&[("project_id", p.clone())]);
    let product_path = format!("/studio-product/v1/projects/{project}/product");
    let runs_query = q(&[
        ("type", "workflow_run".into()),
        ("scope", p.clone()),
        ("sort", "updated".into()),
        ("limit", RUNS.to_string()),
    ]);
    let deploys_query = q(&[("project", p.clone())]);
    let pulls_query = q(&[("project_id", p.clone()), ("limit", PULLS_PAGE.to_string())]);
    let (rows, model, findings, product, runs, deployments, open) = tokio::join!(
        api.get("/studio-documents/v1/spec-rows", &by_project),
        api.get("/studio-documents/v1/project-domain-model", &by_project),
        api.get(
            "/studio-documents/v1/project-domain-model/findings",
            &by_project
        ),
        api.get(&product_path, &[]),
        api.get("/studio-artifact-ingest/v1/nodes", &runs_query),
        api.get("/studio-environments/v1/deployments", &deploys_query),
        api.get(
            "/studio-artifact-ingest/v1/open-pull-requests",
            &pulls_query
        ),
    );
    Read {
        path: PathFacts {
            repositories,
            // Which repositories a sync read needs their graph nodes matched
            // to the config by connection and path; not read here.
            synced: None,
            specs: rows.ok().as_ref().map(spec_queues),
            model: model.ok().as_ref().map(model_facts),
            findings: findings.ok().as_ref().map(finding_facts),
            // What the product is, proposed from the facts, is still the
            // portal's (product-kind.ts): the path leaves that step out.
            kind: None,
            product: product.ok().as_ref().map(product_facts),
            build: runs.ok().as_ref().map(build_facts),
        },
        deployments: deployments.ok().as_ref().map(deploys),
        pulls: open.ok().as_ref().map(pulls),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn the_path_reads_what_each_route_answers() {
        let rows = json!({"sources": {"counts": [
            {"queue": "bound", "count": 74}, {"queue": "needs-review", "count": 1},
            {"queue": "all", "count": 90}]}});
        assert_eq!(
            spec_queues(&rows),
            SpecQueues {
                bound: 74,
                needs_review: 1,
                not_scanned: 0
            }
        );
        let model = json!({"build": {"running": true},
            "documents": [{"state": "extracted"}, {"state": "pending"}], "facts": [{}, {}, {}]});
        assert_eq!(
            model_facts(&model),
            ModelFacts {
                documents: 2,
                extracted: 1,
                facts: 3,
                running: true
            }
        );
        let findings = json!({"items": [
            {"severity": "high", "decision": null}, {"severity": "low", "decision": null},
            {"severity": "high", "decision": "dismissed"}]});
        assert_eq!(finding_facts(&findings), FindingFacts { open: 2, high: 1 });
        assert_eq!(
            product_facts(&json!({"nodes": []})),
            ProductFacts::default()
        );
        let product = json!({"nodes": [{"value": {"gears": ["a", "b"],
            "last_preview": {"ok": false, "errors": 2}, "written": true}}]});
        assert_eq!(
            product_facts(&product),
            ProductFacts {
                gears: 2,
                resolves: Some(false),
                errors: 2,
                written: true
            }
        );
    }

    #[test]
    fn the_last_build_is_the_newest_finished_run_on_the_main_branch() {
        let page = json!({"nodes": [
            {"value": {"branch": "feature", "status": "completed", "conclusion": "failure",
                "sha": "ffffffffff", "created_at": "2026-11-05T00:00:00Z"}},
            {"value": {"branch": "main", "status": "in_progress",
                "sha": "eeeeeeeeee", "created_at": "2026-11-04T00:00:00Z"}},
            {"value": {"branch": "main", "status": "completed", "conclusion": "success",
                "sha": "abcdef1234", "created_at": "2026-11-03T00:00:00Z"}}]});
        assert_eq!(
            build_facts(&page),
            BuildFacts::Last {
                status: "passed".into(),
                sha: "abcdef1".into()
            }
        );
        assert_eq!(build_facts(&json!({"nodes": []})), BuildFacts::Never);
        assert_eq!(build_status(Some("queued"), None), "queued");
        assert_eq!(build_status(Some("completed"), Some("timed_out")), "failed");
        assert_eq!(build_status(None, None), "unknown");
    }

    #[test]
    fn pulls_and_deployments_read_as_the_signals_need() {
        let page = json!({"items": [{"draft": false, "waiting": "review",
            "waiting_on": [{"login": "ann", "display_name": " Ann "}, {"login": "bob", "display_name": null}],
            "days_since_update": 9}]});
        let p = &pulls(&page)[0];
        assert_eq!(p.waiting_on, ["Ann", "bob"]);
        assert_eq!(p.days_since_update, Some(9));
        let page = json!({"items": [{"state": "failed", "environment_name": "dev",
            "requested_at": "2026-11-01T00:00:00Z", "decided_at": null, "reason": ""}]});
        let d = &deploys(&page)[0];
        assert_eq!(
            (d.at.as_str(), d.reason.as_deref()),
            ("2026-11-01T00:00:00Z", None)
        );
    }
}
