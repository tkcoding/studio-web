//! Stage 6: the findings as `spec_finding` verdicts, one per document, so the
//! Specs list counts them and the IDE's Quality rail places them in the text
//! (`docs/project-domain-model.md`, "A build"; the shape is
//! `docs/spec-findings.md`, "The finding").
//!
//! Pure: what each document's verdict says. The caller writes them through
//! `artifact_ingest::port::SpecFindingWriter`.

use std::collections::BTreeSet;

use serde_json::{Value, json};

use super::finding::{Finding, Side};

/// The detector the verdicts are recorded under.
pub const DETECTOR: &str = "spec_model";

/// One document's verdict.
#[derive(Clone, Debug, PartialEq)]
pub struct Verdict {
    pub path: String,
    /// `high` when it has a finding, `clean` when it has none: the words the
    /// Specs list already colours a row by.
    pub severity: &'static str,
    pub summary: String,
    pub details: Value,
}

/// A verdict for every document in `paths`, each holding the findings placed
/// in it: a finding is placed at its first side, its other sides `related`.
/// A document with none gets a `clean` verdict, which replaces whatever an
/// earlier build recorded on it. A finding a member dismissed is left out.
pub fn verdicts(
    paths: &[&str],
    findings: &[Finding],
    dismissed: &BTreeSet<String>,
) -> Vec<Verdict> {
    paths
        .iter()
        .map(|path| {
            let placed: Vec<Value> = findings
                .iter()
                .filter(|f| !dismissed.contains(&f.fingerprint))
                .filter(|f| f.sides.first().is_some_and(|s| s.path == *path))
                .map(finding_json)
                .collect();
            let n = placed.len();
            Verdict {
                path: (*path).to_string(),
                severity: if n == 0 { "clean" } else { "high" },
                summary: match n {
                    0 => "project domain model: no problems".to_string(),
                    1 => "project domain model: 1 problem".to_string(),
                    n => format!("project domain model: {n} problems"),
                },
                details: json!({ "findings": placed }),
            }
        })
        .collect()
}

fn anchor(side: &Side) -> Value {
    json!({
        "section": Value::Null,
        "line_start": side.line_start,
        "line_end": side.line_end,
        "quote": side.quote,
    })
}

/// One finding in the shape `/verdicts` answers (`FindingDto`).
fn finding_json(f: &Finding) -> Value {
    let first = &f.sides[0];
    let mut evidence: Vec<String> = f.decide.iter().map(|d| format!("decide: {d}")).collect();
    if let Some(edit) = &f.edit {
        evidence.push(format!(
            "edit {}: replace \"{}\" with \"{}\"",
            edit.path, edit.replace, edit.with
        ));
    }
    json!({
        "id": f.fingerprint,
        "rule": f.rule,
        "path": first.path,
        "severity": f.severity,
        "message": f.message,
        "anchor": first.line_start.map(|_| anchor(first)),
        "related": f.sides[1..]
            .iter()
            .map(|s| json!({ "path": s.path, "anchor": anchor(s) }))
            .collect::<Vec<_>>(),
        "evidence": evidence,
        "confidence": Value::Null,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn finding(rule: &str, sides: &[(&str, usize)]) -> Finding {
        Finding::new(
            rule,
            "high",
            format!("{rule} message"),
            sides
                .iter()
                .map(|(p, l)| Side::at(p, *l, "quoted"))
                .collect(),
        )
    }

    #[test]
    fn a_finding_is_placed_at_its_first_side_with_the_others_related() {
        let f = finding("contradiction.value", &[("a.md", 3), ("b.md", 9)]);
        let out = verdicts(
            &["a.md", "b.md"],
            std::slice::from_ref(&f),
            &BTreeSet::new(),
        );
        assert_eq!(out[0].severity, "high");
        assert_eq!(out[0].summary, "project domain model: 1 problem");
        let placed = &out[0].details["findings"][0];
        assert_eq!(placed["id"], f.fingerprint.as_str());
        assert_eq!(placed["anchor"]["line_start"], 3);
        assert_eq!(placed["related"][0]["path"], "b.md");
        assert_eq!(placed["related"][0]["anchor"]["line_start"], 9);
        // The other document is clean of it: one finding, counted once.
        assert_eq!(out[1].severity, "clean");
        assert!(out[1].details["findings"].as_array().unwrap().is_empty());
    }

    #[test]
    fn a_dismissed_finding_is_not_recorded() {
        let f = finding("reference.dangling", &[("a.md", 3)]);
        let dismissed: BTreeSet<String> = [f.fingerprint.clone()].into();
        let out = verdicts(&["a.md"], &[f], &dismissed);
        assert_eq!(out[0].severity, "clean");
    }

    #[test]
    fn a_whole_document_side_has_no_anchor() {
        let f = Finding::new(
            "reference.ambiguous",
            "medium",
            "m".into(),
            vec![Side::file("a.md", Some("Title"))],
        );
        let out = verdicts(&["a.md"], &[f], &BTreeSet::new());
        assert!(out[0].details["findings"][0]["anchor"].is_null());
    }
}
