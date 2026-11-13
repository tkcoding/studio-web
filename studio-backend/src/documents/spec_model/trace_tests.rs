use super::*;
use crate::documents::spec_model::requirements::requirements;

const PRD: &str = "\
# PRD

- **ID**: `cpt-app-fr-export`

The system exports reports.

- **ID**: `cpt-app-fr-import`

The system imports reports; see also `cpt-app-fr-export`.
";

const DESIGN: &str = "\
# Design

Implements `cpt-app-fr-export`.
";

fn doc<'a>(path: &'a str, text: &'a str) -> SourceDoc<'a> {
    SourceDoc {
        path,
        text,
        doc_type: None,
    }
}

#[test]
fn a_requirement_is_traced_to_documents_code_and_tests_by_its_id() {
    let docs = [doc("prd.md", PRD), doc("design.md", DESIGN)];
    let reqs = requirements(&docs);
    let files = vec![
        (
            "src/export.rs".to_string(),
            "// cpt-app-fr-export\nfn export() {}\n".to_string(),
        ),
        (
            "src/export_tests.rs".to_string(),
            "#[test]\n// covers cpt-app-fr-export\nfn t() {}\n".to_string(),
        ),
        (
            "web/export.test.ts".to_string(),
            "it('cpt-app-fr-export-draft is another id', () => {})".to_string(),
        ),
        ("README.md".to_string(), "cpt-app-fr-export".to_string()),
    ];
    let traced = trace(&reqs, &docs, &files);
    let export = traced
        .iter()
        .find(|t| t.requirement.id == "cpt-app-fr-export")
        .expect("export");
    let paths = |c: &[Cited]| c.iter().map(|x| x.path.clone()).collect::<Vec<_>>();
    assert_eq!(paths(&export.documents), ["prd.md", "design.md"]);
    assert_eq!(
        export.documents[0].line, 9,
        "the mention, not the definition"
    );
    assert_eq!(paths(&export.code), ["src/export.rs"]);
    assert_eq!(paths(&export.tests), ["src/export_tests.rs"]);
    assert_eq!(export.tests[0].line, 2);
    let import = traced
        .iter()
        .find(|t| t.requirement.id == "cpt-app-fr-import")
        .expect("import");
    assert!(import.documents.is_empty() && import.code.is_empty() && import.tests.is_empty());
}

#[test]
fn tests_are_told_from_code_by_their_path() {
    for p in [
        "src/a_test.rs",
        "pkg/x_test.go",
        "tests/api.rs",
        "web/__tests__/a.tsx",
        "web/a.spec.ts",
        "py/test_x.py",
        "src/test/java/FooTest.java",
    ] {
        assert!(is_test_path(p), "{p}");
    }
    for p in ["src/lib.rs", "web/latest.ts", "contest/main.go"] {
        assert!(!is_test_path(p), "{p}");
    }
}

#[test]
fn one_pass_finds_the_same_places_as_reading_each_requirement_alone() {
    let docs = [doc("prd.md", PRD), doc("design.md", DESIGN)];
    let reqs = requirements(&docs);
    let files: Vec<(String, String)> = (0..50)
        .map(|i| {
            (
                format!("src/m{i}.rs"),
                format!(
                    "fn f() {{}}\n// CPT-APP-FR-EXPORT{}\n",
                    if i == 7 { "" } else { "-x" }
                ),
            )
        })
        .collect();
    let traced = trace(&reqs, &docs, &files);
    let export = traced
        .iter()
        .find(|t| t.requirement.id == "cpt-app-fr-export")
        .expect("export");
    assert_eq!(
        export.code,
        [Cited {
            path: "src/m7.rs".into(),
            line: 2
        }],
        "case aside, a whole token only"
    );
    assert_eq!(
        export.documents[0].line, 9,
        "the mention after its own definition"
    );
}

#[test]
fn generated_and_vendored_files_are_not_traced() {
    for p in [
        "src/export.rs",
        "web/src/export.test.ts",
        "build.rs",
        "src/output.ts",
        "tests/api.rs",
    ] {
        assert!(is_traced_path(p), "{p}");
    }
    for p in [
        "theia/plugins/x/extension/dist/extension.js",
        "web/build/app.js",
        "out/main.js",
        "target/debug/build/x.rs",
        "web/node_modules/lib/index.js",
        "vendor/github.com/x/y.go",
        "web/.next/server/page.js",
        "coverage/lcov-report/prettify.js",
        "web/public/app.min.js",
        "web/App.JS.map",
        "Dist/Bundle.js",
        "README.md",
    ] {
        assert!(!is_traced_path(p), "{p}");
    }
}

#[test]
fn a_file_over_the_size_limit_is_not_traced() {
    let docs = [doc("prd.md", PRD)];
    let reqs = requirements(&docs);
    let mut big = "// cpt-app-fr-export\n".to_string();
    big.push_str(&"x".repeat(TRACED_BYTES_MAX));
    let files = vec![
        ("src/big.rs".to_string(), big),
        (
            "src/small.rs".to_string(),
            "// cpt-app-fr-export\n".to_string(),
        ),
    ];
    let traced = trace(&reqs, &docs, &files);
    let export = traced
        .iter()
        .find(|t| t.requirement.id == "cpt-app-fr-export")
        .expect("export");
    assert_eq!(export.code.len(), 1);
    assert_eq!(export.code[0].path, "src/small.rs");
}

/// [`lines_naming`] as it was first written: a string per token.
fn lines_naming_by_token(
    text: &str,
    wanted: &HashSet<String>,
    keep: usize,
) -> HashMap<String, Vec<usize>> {
    let mut out: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, line) in text.lines().enumerate() {
        for token in line.split(|c: char| !is_part(c)) {
            if token.is_empty() {
                continue;
            }
            let token = token.to_ascii_lowercase();
            if !wanted.contains(&token) {
                continue;
            }
            let at = out.entry(token).or_default();
            if at.len() < keep && at.last() != Some(&(i + 1)) {
                at.push(i + 1);
            }
        }
    }
    out
}

const MIXED: &str = "\
fn a() {} // CPT-APP-FR-1 and cpt-app-fr-1 twice\r\n\
let x = \"cpt-app-fr-12\"; // fr-1.2 é cpt-app-fr-2é\n\
\n\
cpt-app-fr-2_cpt-app-fr-1 x-y\n\
FR-1.2 fr-1.2.3 X-Y\n\
cpt-app-fr-2";

#[test]
fn reusing_one_buffer_finds_the_same_lines_as_a_string_per_token() {
    let sets: [&[&str]; 4] = [
        &["cpt-app-fr-1", "cpt-app-fr-2", "x-y"],
        &["cpt-app-fr-12"],
        &["x"],
        &[],
    ];
    for set in sets {
        let wanted: HashSet<String> = set.iter().map(|s| s.to_string()).collect();
        for keep in [1, 2, 5] {
            assert_eq!(
                lines_naming(MIXED, &wanted, keep),
                lines_naming_by_token(MIXED, &wanted, keep),
                "{set:?} keep {keep}"
            );
        }
    }
}

#[test]
fn a_text_lowered_once_names_an_id_on_the_same_line() {
    let lower = MIXED.to_ascii_lowercase();
    for id in [
        "fr-1.2",
        "FR-1.2",
        "fr-1.2.3",
        "cpt-app-fr-2é",
        "x-y",
        "twice",
        "\"cpt-app-fr-12\"",
        "fr-9.9",
        "",
        "1\r",
        "a\nb",
    ] {
        let key = id.to_ascii_lowercase();
        assert_eq!(
            first_line_naming_lower(MIXED, &lower, &key),
            first_line_naming(MIXED, id),
            "{id:?}"
        );
    }
}

#[test]
fn a_kept_trace_answers_only_its_own_project_and_fingerprint() {
    let cache = TraceCache::default();
    let a = (Uuid::from_u128(1), Uuid::from_u128(2));
    let b = (Uuid::from_u128(1), Uuid::from_u128(3));
    let traced = Arc::new(Traced {
        traces: Vec::new(),
        files: 7,
    });
    cache.put(a, 42, Arc::clone(&traced));
    assert_eq!(cache.get(a, 42).map(|t| t.files), Some(7));
    assert!(cache.get(a, 43).is_none(), "another fingerprint");
    assert!(cache.get(b, 42).is_none(), "another project");
}

#[test]
fn the_fingerprint_moves_with_a_document_or_a_path() {
    let source = |text: &str| SourceText {
        path: "prd.md".into(),
        text: text.into(),
        doc_type: None,
        node: String::new(),
        binding: None,
        at: None,
    };
    let tree: BTreeSet<String> = ["prd.md".to_string(), "src/a.rs".to_string()].into();
    let base = fingerprint(&[source("one")], &tree);
    assert_eq!(base, fingerprint(&[source("one")], &tree));
    assert_ne!(base, fingerprint(&[source("two")], &tree));
    let mut more = tree.clone();
    more.insert("src/b.rs".into());
    assert_ne!(base, fingerprint(&[source("one")], &more));
}
