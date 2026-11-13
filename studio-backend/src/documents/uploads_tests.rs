use super::*;

#[test]
fn csv_json_and_plain_text_are_read_and_nothing_else() {
    assert_eq!(
        accept("survey.csv", "a,b\n1,2\n").map(|a| a.kind),
        Ok("csv")
    );
    assert_eq!(accept("Survey.TSV", "a\tb\n").map(|a| a.kind), Ok("csv"));
    assert_eq!(accept("notes.txt", "Hello").map(|a| a.kind), Ok("text"));
    assert_eq!(accept("events.json", "[1]").map(|a| a.kind), Ok("json"));
    assert!(accept("deck.pdf", "%PDF").is_err());
    assert!(accept("README", "text").is_err());
}

#[test]
fn a_json_file_is_laid_out_one_value_per_line_so_it_can_be_quoted() {
    let got = accept("e.json", r#"{"invoice":{"days":30}}"#).expect("json");
    assert!(got.content.lines().count() > 1);
    assert!(got.content.contains("\"days\": 30"));
    assert!(accept("e.json", "{not json").is_err());
}

#[test]
fn a_name_cannot_leave_its_project_or_hide() {
    assert!(accept("../x.csv", "a").is_err());
    assert!(accept("dir/x.csv", "a").is_err());
    assert!(accept(".x.csv", "a").is_err());
    assert!(accept("  interviews (march).csv ", "a").is_ok());
    assert_eq!(
        accept(" a.csv ", "a").map(|a| a.name),
        Ok("a.csv".to_owned())
    );
}

#[test]
fn empty_binary_or_too_large_is_refused() {
    assert!(accept("a.txt", "  \n").is_err());
    assert!(accept("a.txt", "a\0b").is_err());
    assert!(accept("a.txt", &"x".repeat(MAX_BYTES + 1)).is_err());
}

#[test]
fn an_upload_is_read_under_its_own_prefix() {
    assert_eq!(path_of("a.csv"), "upload:a.csv");
    assert_eq!(mime("json"), "application/json");
}
