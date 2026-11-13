use super::*;

fn doc(path: &str) -> SourceText {
    SourceText {
        path: path.to_owned(),
        text: String::new(),
        doc_type: None,
        node: String::new(),
        binding: None,
        at: None,
    }
}

fn docs() -> Vec<SourceText> {
    [
        "docs/prd/billing.md",
        "docs/prd/search.md",
        "docs/design/billing.md",
        "README.md",
    ]
    .into_iter()
    .map(doc)
    .collect()
}

fn paths(got: &[SourceText]) -> Vec<&str> {
    got.iter().map(|d| d.path.as_str()).collect()
}

#[test]
fn nothing_named_is_an_empty_selection() {
    assert!(Selection::default().is_empty());
    let blank = [String::from("  ")];
    assert!(
        Selection {
            path: Some(""),
            paths: &blank,
            glob: Some(" "),
        }
        .is_empty()
    );
}

#[test]
fn paths_and_a_glob_together_read_each_document_once_in_the_model_s_order() {
    let named = [
        "docs/design/billing.md".to_owned(),
        "docs/prd/search.md".to_owned(),
    ];
    let got = select(
        &docs(),
        Selection {
            path: Some("README.md"),
            paths: &named,
            glob: Some("docs/prd/*.md"),
        },
    )
    .expect("all known");
    assert_eq!(
        paths(&got),
        [
            "docs/prd/billing.md",
            "docs/prd/search.md",
            "docs/design/billing.md",
            "README.md"
        ]
    );
}

#[test]
fn an_unknown_path_is_reported_and_nothing_is_read() {
    let named = ["docs/prd/billing.md".to_owned(), "docs/nope.md".to_owned()];
    let err = select(
        &docs(),
        Selection {
            paths: &named,
            glob: Some("specs/**"),
            ..Selection::default()
        },
    )
    .expect_err("one is unknown");
    assert_eq!(err.paths, ["docs/nope.md"]);
    assert_eq!(err.glob.as_deref(), Some("specs/**"));
    assert!(err.message().contains("docs/nope.md"));
    assert!(err.message().contains("specs/**"));
}

#[test]
fn a_glob_matches_by_segment() {
    assert!(glob_match("docs/**", "docs/prd/billing.md"));
    assert!(glob_match("docs/**/billing.md", "docs/billing.md"));
    assert!(glob_match("**/billing.md", "docs/design/billing.md"));
    assert!(glob_match("docs/*/b?lling.md", "docs/prd/billing.md"));
    assert!(
        !glob_match("docs/*.md", "docs/prd/billing.md"),
        "* stays in its segment"
    );
    assert!(glob_match("*.md", "README.md"));
    assert!(!glob_match("*.md", "docs/a.md"));
    assert!(glob_match("upload:*", "upload:notes.csv"));
}
