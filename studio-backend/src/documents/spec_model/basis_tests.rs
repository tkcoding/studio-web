use super::*;

fn fact(subject: &str, value: &str, quote: &str) -> Fact {
    Fact {
        kind: "attribute".into(),
        subject: subject.into(),
        aspect: "retention".into(),
        value: value.into(),
        text: String::new(),
        status: "active".into(),
        status_because: String::new(),
        path: "docs/a.md".into(),
        line_start: 1,
        line_end: 1,
        quote: quote.into(),
        layer: None,
    }
}

#[test]
fn a_fact_whose_words_are_in_its_quote_is_stated() {
    let f = fact(
        "Invoices",
        "kept for 30 days",
        "Every **invoice** is kept for 30 days after it is paid.",
    );
    assert_eq!(basis(&f), STATED);
}

#[test]
fn a_value_the_passage_does_not_have_is_interpreted() {
    let f = fact(
        "Invoice",
        "one month",
        "Every invoice is kept for 30 days after it is paid.",
    );
    assert_eq!(basis(&f), INTERPRETED);
}

#[test]
fn an_implicit_subject_is_interpreted() {
    let f = fact(
        "billing ledger",
        "",
        "Every invoice is kept for 30 days after it is paid.",
    );
    assert_eq!(basis(&f), INTERPRETED);
}

#[test]
fn the_aspect_the_model_names_does_not_count() {
    // `retention` is the model's name for the slot, not the passage's word.
    let f = fact("invoice", "30", "An invoice is kept 30 days.");
    assert_eq!(basis(&f), STATED);
}

#[test]
fn case_markup_plurals_and_common_words_do_not_count() {
    let f = fact(
        "the Connector instances",
        "",
        "One row per `connector instance`.",
    );
    assert_eq!(basis(&f), STATED);
}
