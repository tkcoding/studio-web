// Ported from the portal's domain-model-views.test.ts ("to resolve") at
// 00828880: the queue's order, what blocks a build, and the headline.

use super::*;
use crate::documents::spec_model::requirements::Basis;

fn req(id: &str, basis: Basis, kind: &str) -> Requirement {
    Requirement {
        id: id.into(),
        path: "docs/prd.md".into(),
        line: 3,
        title: Some(id.into()),
        text: String::new(),
        kind: Some(kind.into()),
        priority: Some("p1".into()),
        done: None,
        basis,
        cites: Vec::new(),
        because: None,
    }
}

fn finding(fingerprint: &str, rule: &str, severity: &str, decision: Option<&str>) -> Decided {
    Decided {
        finding: Finding {
            fingerprint: fingerprint.into(),
            rule: rule.into(),
            severity: severity.into(),
            message: "ADR-0040 is cited, but the project has no ADR numbered 40.".into(),
            sides: Vec::new(),
            decide: Vec::new(),
            edit: None,
            target: None,
        },
        decision: decision.map(str::to_string),
    }
}

fn keys(q: &[Item]) -> Vec<&str> {
    q.iter().map(|i| i.key.as_str()).collect()
}

#[test]
fn problems_first_then_questions_assumptions_and_buildable_requirements_with_no_basis() {
    let mut assumption = req("cpt-b", Basis::Assumption, "fr");
    assumption.because = Some("Postgres everywhere".into());
    let q = queue(
        vec![finding("f1", "reference.dangling", "high", None)],
        &[
            req("cpt-a", Basis::Stated, "fr"),
            assumption,
            req("cpt-c", Basis::OpenQuestion, "fr"),
            req("cpt-adr", Basis::Stated, "adr"),
        ],
    );
    assert_eq!(keys(&q), ["f:f1", "q:cpt-c", "a:cpt-b", "n:cpt-a"]);
    assert!(q[2].hint.contains("\u{201c}Postgres everywhere\u{201d}"));
}

#[test]
fn a_decided_finding_goes_to_the_end_and_only_what_is_open_counts() {
    let q = queue(
        vec![
            finding("f1", "reference.dangling", "high", Some("dismissed")),
            finding("f2", "reference.dangling", "low", None),
        ],
        &[],
    );
    let rows: Vec<(&str, bool)> = q.iter().map(|i| (i.key.as_str(), i.done)).collect();
    assert_eq!(rows, [("f:f2", false), ("f:f1", true)]);
    let by_basis = BTreeMap::from([("cited".to_string(), 3), ("reasoned".to_string(), 1)]);
    assert_eq!(
        readiness(&q, &by_basis, 5),
        Readiness {
            total: 5,
            cited: 3,
            reasoned: 1,
            open: 1,
            blocking: 1,
            ready: false
        }
    );
}

#[test]
fn assumptions_unsourced_requirements_and_unconfirmed_concerns_wait_without_stopping_a_build() {
    let q = queue(
        vec![finding("c1", "contradiction.value", "high", None)],
        &[
            req("cpt-a", Basis::Stated, "fr"),
            req("cpt-b", Basis::Assumption, "fr"),
        ],
    );
    assert!(q[0].concern);
    assert_eq!(q[0].tone, "warn");
    assert_eq!(q[0].label(), "Possible conflict");
    let r = readiness(&q, &BTreeMap::new(), 2);
    assert_eq!((r.open, r.blocking, r.ready), (3, 0, true));

    let confirmed = queue(
        vec![finding(
            "c1",
            "contradiction.value",
            "high",
            Some("confirmed"),
        )],
        &[],
    );
    let r = readiness(&confirmed, &BTreeMap::new(), 0);
    assert_eq!((r.blocking, r.ready), (1, false));
    assert_eq!(confirmed[0].group(), "blocks");

    let question = queue(Vec::new(), &[req("cpt-q", Basis::OpenQuestion, "fr")]);
    assert!(!readiness(&question, &BTreeMap::new(), 1).ready);
}

#[test]
fn a_dangling_reference_reads_as_what_is_missing() {
    assert_eq!(
        finding_title("ADR-0040 is cited, but the project has no ADR numbered 40."),
        "ADR-0040 is cited, but there is no ADR numbered 40"
    );
    assert_eq!(
        finding_title("Two values disagree."),
        "Two values disagree."
    );
}

#[test]
fn findings_are_worked_through_undecided_first_then_by_severity_then_rules_before_references() {
    let ordered = order_findings(vec![
        finding("ref", "reference.dangling", "high", None),
        finding(
            "dismissed",
            "contradiction.value",
            "high",
            Some("dismissed"),
        ),
        finding("low", "contradiction.access", "low", None),
        finding("rule", "contradiction.value", "high", None),
        finding(
            "confirmed",
            "contradiction.access",
            "high",
            Some("confirmed"),
        ),
        finding("rule2", "contradiction.access", "high", None),
    ]);
    let order: Vec<&str> = ordered
        .iter()
        .map(|d| d.finding.fingerprint.as_str())
        .collect();
    assert_eq!(
        order,
        ["rule2", "rule", "ref", "low", "confirmed", "dismissed"]
    );
}

#[test]
fn each_row_offers_what_the_portal_offered_and_sits_in_its_group() {
    let mut with_edit = finding("e", "reference.dangling", "high", None);
    with_edit.finding.edit = Some(crate::documents::spec_model::finding::Edit {
        path: "docs/a.md".into(),
        replace: "ADR-0040".into(),
        with: "ADR-0041".into(),
    });
    let q = queue(
        vec![
            with_edit,
            finding("d", "reference.dangling", "high", Some("dismissed")),
        ],
        &[req("cpt-b", Basis::Assumption, "fr")],
    );
    assert_eq!(
        q[0].actions(false),
        ["propose_fix", "confirm", "dismiss", "create_issue"]
    );
    assert_eq!(q[0].group(), "blocks");
    assert_eq!(q[1].key, "a:cpt-b");
    assert_eq!(q[1].actions(true), ["trace"]);
    assert_eq!(q[1].group(), "look");
    assert_eq!(q[1].label(), "Assumption");
    assert_eq!(q[2].actions(false), ["create_issue"]);
    assert_eq!(q[2].group(), "decided");
}
