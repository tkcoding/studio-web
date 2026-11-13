//! The requirements a project's documents define, and what each one states it
//! rests on (`docs/project-domain-model.md`, "Requirements and their basis").
//!
//! Read as written: a requirement is whatever a document defines with a label
//! (`**ID**: \`x\``), and its basis is inferred from its own block — what it
//! links to or cites, a stated reason, or the words that make it an
//! assumption or an open question. Nothing is asked of the documents, and
//! nothing here raises a finding: a requirement that states no basis is shown
//! as such, because the calibration dropped `requirement.orphan` as noise.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use super::index::{
    SourceDoc, adr_numbers, defined_id, is_id_shaped, labelled_ids, link_targets, prose_lines,
};

/// What a requirement states it rests on, strongest doubt first: a
/// requirement that cites a source but calls itself an assumption is an
/// assumption.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Basis {
    /// It says it is not decided: "TBD", "open question", a sentence that
    /// ends in a question mark.
    OpenQuestion,
    /// It says it is not confirmed: "assumption", "presumably", "hypothesis".
    Assumption,
    /// It cites something outside itself: a link, an ADR, an issue or pull
    /// request, an identifier another document defines, a labelled source.
    Cited,
    /// It gives a reason but cites nothing.
    Reasoned,
    /// It states the requirement and nothing about where it comes from.
    Stated,
}

impl Basis {
    pub fn as_str(self) -> &'static str {
        match self {
            Basis::OpenQuestion => "open_question",
            Basis::Assumption => "assumption",
            Basis::Cited => "cited",
            Basis::Reasoned => "reasoned",
            Basis::Stated => "stated",
        }
    }
}

/// One definition of a requirement (or of any labelled identifier: a
/// project decides what its families mean, so `kind` is only the segment
/// that usually says it).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Requirement {
    pub id: String,
    pub path: String,
    /// The line of the label, from 1.
    pub line: usize,
    /// The nearest heading above the label.
    pub title: Option<String>,
    /// The statement: the block's prose that is not a labelled list item.
    pub text: String,
    /// The segment after the identifier's family (`fr` in `cpt-studio-fr-x`).
    pub kind: Option<String>,
    /// A back-ticked `p1`…`p9` on the label's line.
    pub priority: Option<String>,
    /// The label line's checkbox: `[x]` true, `[ ]` false, none absent.
    pub done: Option<bool>,
    pub basis: Basis,
    /// What it cites, as written: link targets, `ADR-0010`, `#123`,
    /// identifiers defined in another document, a labelled source.
    pub cites: Vec<String>,
    /// The words that made it an assumption or an open question.
    pub because: Option<String>,
}

/// The longest statement kept: enough to recognise the requirement in a list.
const TEXT_MAX: usize = 600;

/// List labels that give a reason.
const REASON_LABELS: [&str; 6] = [
    "rationale",
    "reason",
    "why",
    "because",
    "justification",
    "motivation",
];

/// List labels that name where a requirement comes from.
const SOURCE_LABELS: [&str; 6] = [
    "source",
    "sources",
    "evidence",
    "origin",
    "based on",
    "derived from",
];

const OPEN_WORDS: [&str; 7] = [
    "tbd",
    "todo",
    "open question",
    "to be decided",
    "to be defined",
    "undecided",
    "not yet decided",
];

const ASSUMPTION_WORDS: [&str; 7] = [
    "assum",
    "presum",
    "hypothes",
    "we believe",
    "to be validated",
    "unvalidated",
    "unconfirmed",
];

/// Every requirement the documents define, in document order.
pub fn requirements(docs: &[SourceDoc<'_>]) -> Vec<Requirement> {
    let defined = labelled_ids(docs);
    let mut out = Vec::new();
    for doc in docs {
        let lines = prose_lines(doc.text);
        let mut title: Option<String> = None;
        let mut i = 0;
        while i < lines.len() {
            let line = &lines[i];
            if let Some(h) = heading(line.text) {
                title = Some(h.to_string());
                i += 1;
                continue;
            }
            let Some(id) = defined_id(line.text) else {
                i += 1;
                continue;
            };
            let mut end = i + 1;
            while end < lines.len()
                && heading(lines[end].text).is_none()
                && defined_id(lines[end].text).is_none()
            {
                end += 1;
            }
            let block: Vec<&str> = lines[i + 1..end].iter().map(|l| l.text).collect();
            out.push(read_block(
                &id,
                doc.path,
                line.number,
                line.text,
                title.clone(),
                &block,
                &defined,
            ));
            i = end;
        }
    }
    out
}

fn read_block(
    id: &str,
    path: &str,
    line: usize,
    label_line: &str,
    title: Option<String>,
    block: &[&str],
    defined: &BTreeMap<String, Vec<super::finding::Side>>,
) -> Requirement {
    let mut statement: Vec<&str> = Vec::new();
    let mut cites: BTreeSet<String> = BTreeSet::new();
    let mut reasoned = false;
    for raw in block {
        let text = raw.trim();
        if text.is_empty() {
            continue;
        }
        match list_label(text) {
            Some((label, value)) => {
                let label = label.to_lowercase();
                if SOURCE_LABELS.contains(&label.as_str()) && !value.trim().is_empty() {
                    cites.insert(value.trim().to_string());
                } else if REASON_LABELS.contains(&label.as_str()) && !value.trim().is_empty() {
                    reasoned = true;
                }
            }
            None => statement.push(text),
        }
        for target in link_targets(text) {
            cites.insert(target);
        }
        for (_, written) in adr_numbers(text) {
            cites.insert(written);
        }
        for issue in issue_refs(text) {
            cites.insert(issue);
        }
        for other in ticked_ids(text) {
            if other != id && defined_elsewhere(&other, path, defined) {
                cites.insert(other);
            }
        }
    }
    let text = clipped(&statement.join(" "));
    let whole = block.join("\n").to_lowercase();
    let (basis, because) = if let Some(w) = first_word(&whole, &OPEN_WORDS) {
        (Basis::OpenQuestion, Some(w))
    } else if statement.iter().any(|s| s.trim_end().ends_with('?')) {
        (Basis::OpenQuestion, Some("?".to_string()))
    } else if let Some(w) = first_word(&whole, &ASSUMPTION_WORDS) {
        (Basis::Assumption, Some(w))
    } else if !cites.is_empty() {
        (Basis::Cited, None)
    } else if reasoned {
        (Basis::Reasoned, None)
    } else {
        (Basis::Stated, None)
    };
    Requirement {
        id: id.to_string(),
        path: path.to_string(),
        line,
        title,
        text,
        kind: kind_of(id),
        priority: priority_of(label_line),
        done: checkbox_of(label_line),
        basis,
        cites: cites.into_iter().collect(),
        because,
    }
}

/// `## Title` → `Title`.
fn heading(text: &str) -> Option<&str> {
    let t = text.trim_start();
    let hashes = t.chars().take_while(|c| *c == '#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }
    let rest = &t[hashes..];
    rest.starts_with(' ').then(|| rest.trim())
}

/// `- **Label**: value` → `(Label, value)`.
fn list_label(text: &str) -> Option<(&str, &str)> {
    let t = text
        .strip_prefix("- ")
        .or_else(|| text.strip_prefix("* "))?;
    let t = t.trim_start().strip_prefix("**")?;
    let close = t.find("**")?;
    let label = t[..close].trim_end_matches(':').trim();
    let rest = t[close + 2..].trim_start();
    let value = rest.strip_prefix(':').unwrap_or(rest);
    (!label.is_empty()).then_some((label, value))
}

/// `#123` where it starts a word: an issue or pull request.
fn issue_refs(text: &str) -> Vec<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    for (at, _) in text.match_indices('#') {
        let starts_word = at == 0 || matches!(bytes[at - 1], b' ' | b'(' | b'[' | b',');
        let digits: String = text[at + 1..]
            .chars()
            .take_while(char::is_ascii_digit)
            .collect();
        let end = at + 1 + digits.len();
        let ends_word = bytes.get(end).is_none_or(|b| !b.is_ascii_alphanumeric());
        if starts_word && ends_word && !digits.is_empty() && digits.len() <= 7 {
            out.push(format!("#{digits}"));
        }
    }
    out
}

/// Every back-ticked identifier on a line.
fn ticked_ids(text: &str) -> Vec<String> {
    text.split('`')
        .skip(1)
        .step_by(2)
        .map(str::trim)
        .filter(|s| is_id_shaped(s))
        .map(str::to_string)
        .collect()
}

/// Whether `id` is defined in a document other than `path`: a reference
/// across documents is a trace; one inside the same document (the actors a
/// PRD lists above its requirements) is not a source.
fn defined_elsewhere(
    id: &str,
    path: &str,
    defined: &BTreeMap<String, Vec<super::finding::Side>>,
) -> bool {
    defined
        .get(id)
        .is_some_and(|sides| sides.iter().any(|s| s.path != path))
}

/// The first of `words` in `text` (lower-cased), as a whole word start.
fn first_word(text: &str, words: &[&str]) -> Option<String> {
    words
        .iter()
        .filter_map(|w| {
            text.match_indices(w)
                .find(|(at, _)| *at == 0 || !text.as_bytes()[at - 1].is_ascii_alphanumeric())
                .map(|(at, _)| (at, *w))
        })
        .min_by_key(|(at, _)| *at)
        .map(|(at, w)| {
            // The whole word the stem starts: "assum" → "assumption".
            let from = at + w.len();
            let end = text[from..]
                .find(|c: char| !c.is_alphanumeric())
                .map_or(text.len(), |e| from + e);
            text[at..end].to_string()
        })
}

fn kind_of(id: &str) -> Option<String> {
    let segments: Vec<&str> = id.split('-').collect();
    (segments.len() >= 4).then(|| segments[2].to_string())
}

fn priority_of(line: &str) -> Option<String> {
    line.split('`').skip(1).step_by(2).find_map(|s| {
        let s = s.trim();
        let digit = s.strip_prefix('p')?;
        (digit.len() == 1 && digit.chars().all(|c| c.is_ascii_digit())).then(|| s.to_string())
    })
}

fn checkbox_of(line: &str) -> Option<bool> {
    let t = line.trim_start();
    let t = t.strip_prefix("- ").or_else(|| t.strip_prefix("* "))?;
    if t.starts_with("[x]") || t.starts_with("[X]") {
        Some(true)
    } else if t.starts_with("[ ]") {
        Some(false)
    } else {
        None
    }
}

fn clipped(text: &str) -> String {
    if text.chars().count() <= TEXT_MAX {
        return text.to_string();
    }
    let mut out: String = text.chars().take(TEXT_MAX).collect();
    out.push('…');
    out
}

#[cfg(test)]
#[path = "requirements_tests.rs"]
mod tests;
