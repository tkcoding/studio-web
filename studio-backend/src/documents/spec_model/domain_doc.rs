//! The domain model a person edits on the Project domain model tab, kept in the
//! project's repository as one document Studio writes: `docs/domain-model.md`,
//! one section per entity (what it is, what it holds, how it relates). It is
//! read back like any other document of the project once its type is
//! settled, so an edit becomes facts with a passage on the next build.
//!
//! And the other way an edit reaches the documents: a finding's smallest fix
//! (`finding::Edit`) applied to the passage it names, for a pull request.
//!
//! Pure: no I/O. The routes in `rest.rs` read and write the files.

/// Where the edited model is kept, from the repository's root.
pub const DOMAIN_DOC_PATH: &str = "docs/domain-model.md";

/// One entity as a person wrote it on the tab.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EntityEdit {
    pub name: String,
    /// What it is, in a sentence or two.
    pub definition: Option<String>,
    /// `(field, what it holds)`.
    pub fields: Vec<(String, String)>,
    /// `(verb, the entity it relates to)`: "belongs to", "Workspace".
    pub relations: Vec<(String, String)>,
}

const HEAD: &str = "---\ntype: design\n---\n\n# Domain model\n\n\
<!-- Kept by Constructor Studio from the Project domain model tab: one section per entity. \
Edit it here or there; Studio rewrites only the section of the entity it saves. -->\n";

/// A cell or a line that cannot break the table or the list it sits in.
fn inline(s: &str) -> String {
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .replace('|', "\\|")
}

/// The section for one entity.
pub fn section(edit: &EntityEdit) -> String {
    let mut out = format!("## {}\n\n", inline(&edit.name));
    if let Some(def) = edit
        .definition
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty())
    {
        out.push_str(def);
        out.push_str("\n\n");
    }
    if !edit.fields.is_empty() {
        out.push_str("| Field | What it holds |\n|---|---|\n");
        for (field, meaning) in &edit.fields {
            out.push_str(&format!("| {} | {} |\n", inline(field), inline(meaning)));
        }
        out.push('\n');
    }
    for (verb, target) in &edit.relations {
        out.push_str(&format!(
            "- {} {} **{}**.\n",
            inline(&edit.name),
            inline(verb),
            inline(target)
        ));
    }
    if !edit.relations.is_empty() {
        out.push('\n');
    }
    out
}

/// The heading a section starts with, folded so `## Project` and
/// `## project ` are one entity.
fn heading_key(line: &str) -> Option<String> {
    line.strip_prefix("## ").map(|h| h.trim().to_lowercase())
}

/// `doc` with the entity's section replaced, or added at the end; a new
/// document when there is none yet. Every other section, and anything a
/// person wrote outside the sections, is kept as it was.
pub fn upsert(doc: Option<&str>, edit: &EntityEdit) -> String {
    let fresh = section(edit);
    let Some(doc) = doc.filter(|d| !d.trim().is_empty()) else {
        return format!("{HEAD}\n{fresh}");
    };
    let key = edit.name.trim().to_lowercase();
    let lines: Vec<&str> = doc.lines().collect();
    let start = lines
        .iter()
        .position(|l| heading_key(l).as_deref() == Some(key.as_str()));
    let Some(start) = start else {
        let mut out = doc.trim_end().to_owned();
        out.push_str("\n\n");
        out.push_str(&fresh);
        return out;
    };
    let end = lines[start + 1..]
        .iter()
        .position(|l| l.starts_with("## ") || l.starts_with("# "))
        .map_or(lines.len(), |i| start + 1 + i);
    let mut out = lines[..start].join("\n");
    if !out.is_empty() {
        out.push('\n');
    }
    out.push_str(&fresh);
    if end < lines.len() {
        out.push_str(&lines[end..].join("\n"));
        out.push('\n');
    }
    out
}

/// `text` with `replace` swapped for `with`, matching across any run of
/// whitespace the way the judge checked the edit (`judge::holds`); `None`
/// when the passage is no longer in the text, or appears more than once.
pub fn apply_edit(text: &str, replace: &str, with: &str) -> Option<String> {
    // The text folded to single spaces, with each folded byte's original
    // offset, so a match maps back onto the text as written.
    let mut folded = String::new();
    let mut origin: Vec<usize> = Vec::new();
    let mut in_space = false;
    for (i, c) in text.char_indices() {
        if c.is_whitespace() {
            if !in_space && !folded.is_empty() {
                folded.push(' ');
                origin.push(i);
            }
            in_space = true;
        } else {
            for _ in 0..c.len_utf8() {
                origin.push(i);
            }
            folded.push(c);
            in_space = false;
        }
    }
    let needle = replace.split_whitespace().collect::<Vec<_>>().join(" ");
    if needle.is_empty() {
        return None;
    }
    let at = folded.find(&needle)?;
    if folded[at + needle.len()..].contains(&needle) {
        return None;
    }
    let start = origin[at];
    let last = at + needle.len() - 1;
    let end = origin[last]
        + text[origin[last]..]
            .chars()
            .next()
            .map_or(1, char::len_utf8);
    Some(format!("{}{}{}", &text[..start], with, &text[end..]))
}

/// `text` with `sentence` as a paragraph of its own after the block that line
/// `line` (1-based) sits in: the paragraph, list or table ends at the next
/// blank line, so the sentence never breaks one. `None` when the line is not
/// in the text, the sentence is empty, or the block is fenced code, where a
/// sentence would be read as code. Line endings follow the text's own.
pub fn insert_after(text: &str, line: usize, sentence: &str) -> Option<String> {
    let sentence = sentence.split_whitespace().collect::<Vec<_>>().join(" ");
    if sentence.is_empty() || line == 0 {
        return None;
    }
    let lines: Vec<&str> = text.lines().collect();
    if line > lines.len() {
        return None;
    }
    let fence = |l: &str| l.trim_start().starts_with("```") || l.trim_start().starts_with("~~~");
    if lines[..line].iter().filter(|l| fence(l)).count() % 2 == 1 {
        return None;
    }
    let mut end = line - 1;
    if lines[end].trim().is_empty() {
        return None;
    }
    while end + 1 < lines.len() && !lines[end + 1].trim().is_empty() && !fence(lines[end + 1]) {
        end += 1;
    }
    let nl = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let mut out: Vec<&str> = lines[..=end].to_vec();
    out.push("");
    out.push(&sentence);
    if end + 1 < lines.len() && !lines[end + 1].trim().is_empty() {
        out.push("");
    }
    out.extend_from_slice(&lines[end + 1..]);
    let mut joined = out.join(nl);
    if text.ends_with('\n') {
        joined.push_str(nl);
    }
    Some(joined)
}

/// The type the model reads a project file as, or `None` when it is not
/// documentation: a file whose type is settled, as that type; and Studio's
/// own [`DOMAIN_DOC_PATH`] whatever its binding says, because Studio writes
/// it as a design document -- nobody has to bind it by hand for an edit on
/// the Project domain model tab to count.
pub fn read_as(path: &str, typed: bool, type_key: Option<&str>) -> Option<Option<String>> {
    if path == DOMAIN_DOC_PATH {
        let settled = type_key.filter(|_| typed).unwrap_or(DOMAIN_DOC_TYPE);
        return Some(Some(settled.to_owned()));
    }
    typed.then(|| type_key.map(str::to_owned))
}

/// The type [`DOMAIN_DOC_PATH`]'s front matter declares.
pub const DOMAIN_DOC_TYPE: &str = "design";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_domain_doc_is_documentation_without_a_binding_decision() {
        assert_eq!(
            read_as(DOMAIN_DOC_PATH, false, None),
            Some(Some("design".to_owned()))
        );
        assert_eq!(
            read_as(DOMAIN_DOC_PATH, false, Some("prd")),
            Some(Some("design".to_owned())),
            "a detector's guess does not retype it"
        );
        assert_eq!(
            read_as(DOMAIN_DOC_PATH, true, Some("adr")),
            Some(Some("adr".to_owned())),
            "a person's type stands"
        );
        assert!(HEAD.contains(&format!("type: {DOMAIN_DOC_TYPE}")));
    }

    #[test]
    fn other_files_count_once_their_type_is_settled() {
        assert_eq!(read_as("docs/prd.md", false, Some("prd")), None);
        assert_eq!(
            read_as("docs/prd.md", true, Some("prd")),
            Some(Some("prd".to_owned()))
        );
        assert_eq!(read_as("docs/other/domain-model.md", false, None), None);
    }

    fn project() -> EntityEdit {
        EntityEdit {
            name: "Project".into(),
            definition: Some("A project is a unit of work inside a workspace.".into()),
            fields: vec![("type".into(), "product or library".into())],
            relations: vec![("belongs to".into(), "Workspace".into())],
        }
    }

    #[test]
    fn a_first_edit_starts_the_document_with_its_type_and_one_section() {
        let doc = upsert(None, &project());
        assert!(doc.starts_with("---\ntype: design\n---\n\n# Domain model"));
        assert!(doc.contains("## Project\n\nA project is a unit of work inside a workspace.\n"));
        assert!(doc.contains("| type | product or library |"));
        assert!(doc.contains("- Project belongs to **Workspace**."));
    }

    #[test]
    fn an_edit_replaces_its_own_section_and_keeps_the_rest() {
        let doc = upsert(None, &project());
        let doc = upsert(
            Some(&doc),
            &EntityEdit {
                name: "Workspace".into(),
                definition: Some("Holds projects.".into()),
                fields: vec![],
                relations: vec![],
            },
        );
        let mut changed = project();
        changed.definition = Some("A project makes one product.".into());
        let doc = upsert(Some(&doc), &changed);
        assert!(doc.contains("A project makes one product."));
        assert!(!doc.contains("unit of work"));
        assert!(doc.contains("## Workspace\n\nHolds projects."));
        assert_eq!(doc.matches("## Project").count(), 1);
    }

    #[test]
    fn a_cell_cannot_break_the_table() {
        assert!(
            section(&EntityEdit {
                name: "X".into(),
                definition: None,
                fields: vec![("a|b".into(), "one\ntwo".into())],
                relations: vec![],
            })
            .contains("| a\\|b | one two |")
        );
    }

    #[test]
    fn a_findings_edit_applies_across_the_line_breaks_it_was_checked_through() {
        let text = "Intro.\nA project belongs to\n  an organization directly.\nEnd.";
        let out = apply_edit(text, "belongs to an organization", "belongs to a workspace").unwrap();
        assert_eq!(
            out,
            "Intro.\nA project belongs to a workspace directly.\nEnd."
        );
    }

    #[test]
    fn a_passage_that_is_gone_or_ambiguous_is_not_edited() {
        assert_eq!(apply_edit("nothing here", "belongs to", "x"), None);
        assert_eq!(apply_edit("a b and a b", "a b", "x"), None);
        assert_eq!(apply_edit("text", "   ", "x"), None);
    }

    #[test]
    fn a_sentence_goes_after_the_block_its_line_is_in() {
        let doc = "# Title\n\nA connection health is read\nfrom the host.\n\n## Next\n";
        assert_eq!(
            insert_after(doc, 3, "Connection health describes **Connection**.").as_deref(),
            Some(
                "# Title\n\nA connection health is read\nfrom the host.\n\nConnection health describes **Connection**.\n\n## Next\n"
            ),
            "after the whole paragraph, not inside it"
        );
        let table = "| a | b |\n|---|---|\n| x | y |\n";
        assert_eq!(
            insert_after(table, 1, "S.").as_deref(),
            Some("| a | b |\n|---|---|\n| x | y |\n\nS.\n"),
            "a table is not broken"
        );
        assert_eq!(
            insert_after("a\r\nb\r\n", 1, "S.").as_deref(),
            Some("a\r\nb\r\n\r\nS.\r\n"),
            "the text's own line endings"
        );
    }

    #[test]
    fn no_sentence_where_it_cannot_go() {
        assert_eq!(insert_after("a\n", 2, "S."), None, "past the end");
        assert_eq!(insert_after("a\n", 0, "S."), None);
        assert_eq!(insert_after("a\n", 1, "  "), None, "nothing to say");
        assert_eq!(
            insert_after("a\n\nb\n", 2, "S."),
            None,
            "a blank line is no passage"
        );
        assert_eq!(
            insert_after("```\ncode\n```\n", 2, "S."),
            None,
            "inside a fence"
        );
    }
}
