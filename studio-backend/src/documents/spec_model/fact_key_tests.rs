// The expected keys were computed by the portal's own code
// (the old prototype's src/review-state.ts `factKey` and spec-model.ts
// `subjectKey` at 00828880, now archived in studio-frontend-poc/, run under Node 24): the reviews members already
// stored carry those keys, so these must not move.

use super::*;

fn fact(kind: &str, subject: &str, aspect: &str, text: &str, quote: &str) -> Fact {
    Fact {
        kind: kind.into(),
        subject: subject.into(),
        aspect: aspect.into(),
        value: String::new(),
        text: text.into(),
        status: "active".into(),
        status_because: String::new(),
        path: "docs/prd/x.md".into(),
        line_start: 3,
        line_end: 3,
        quote: quote.into(),
        layer: None,
    }
}

#[test]
fn the_hash_is_the_portal_s() {
    assert_eq!(fnv64(""), "811c9dc5050c5d1f");
    assert_eq!(fnv64("a"), "e40c292c723f45ac");
}

#[test]
fn a_key_is_the_one_the_portal_stored() {
    let cases = [
        (
            fact(
                "attribute",
                "Invoice",
                "number",
                "An invoice has a **number**.",
                "An invoice has a **number**.",
            ),
            "28d393bc09e65fe9",
        ),
        (
            fact(
                "entity",
                "The Project's Workspace",
                "",
                "A project belongs to a workspace.",
                "",
            ),
            "9e1d713baf9073d3",
        ),
        (
            fact(
                "relation",
                "Status",
                "Belongs_To",
                "x",
                "  \u{dc}n\u{ef}code \u{2014} \u{41f}\u{440}\u{43e}\u{435}\u{43a}\u{442}\u{44b}\u{a0}\u{438}\u{2003}\u{437}\u{430}\u{434}\u{430}\u{447}\u{438}\t\u{442}\u{435}\u{441}\u{442}\u{feff} ",
            ),
            "b95d4db68ea4c1f2",
        ),
        (
            fact(
                "constraint",
                "Classes of Bus",
                "",
                "",
                "emoji \u{1F600} `code` | pipe",
            ),
            "29045ded708f7337",
        ),
        (
            fact("requirement", "cafe\u{301}s", "", "", "line\u{85}next"),
            "78c743990168d40d",
        ),
    ];
    for (f, key) in cases {
        assert_eq!(fact_key(&f), key, "{f:?}");
    }
}

#[test]
fn a_key_stays_when_the_passage_moves_or_is_rewrapped_and_the_subject_is_spelt_otherwise() {
    let a = fact(
        "attribute",
        "Invoice",
        "number",
        "An invoice has a **number**.",
        "An invoice has a **number**.",
    );
    let mut moved = fact(
        "attribute",
        "invoices",
        "number",
        "An  invoice has a number.",
        "An  invoice has a number.",
    );
    moved.line_start = 40;
    moved.line_end = 40;
    assert_eq!(fact_key(&moved), fact_key(&a));
    let key = fact_key(&a);
    assert_eq!(key.len(), 16);
    assert!(
        key.chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    );
}

#[test]
fn a_key_changes_when_the_words_do() {
    let one = fact(
        "attribute",
        "Invoice",
        "number",
        "",
        "An invoice has a number.",
    );
    let two = fact(
        "attribute",
        "Invoice",
        "number",
        "",
        "An invoice has two numbers.",
    );
    assert_ne!(fact_key(&one), fact_key(&two));
}

#[test]
fn the_subject_folds_as_the_portal_folded_it() {
    assert_eq!(
        subject_key("The Project's Workspace"),
        "project s workspace"
    );
    assert_eq!(subject_key("Classes of Bus"), "classe of bus");
    // A combining mark is not a letter: the browser split there.
    assert_eq!(subject_key("cafe\u{301}s"), "cafe s");
    assert_eq!(subject_key("Status"), "status");
    assert_eq!(subject_key("Analysis"), "analysis");
}
