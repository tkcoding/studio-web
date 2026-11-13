//! Stage 5: a model shown both passages of a candidate, each in its section,
//! says whether they really cannot both hold (`docs/project-domain-model.md`,
//! "Rules propose, a model confirms, a person decides").
//!
//! Pure: the question and reading the answer. The answer is held to the text
//! as an extraction is: an edit is kept only when the passage it replaces is
//! in the document it names.

use serde::Deserialize;

use super::finding::{Edit, Finding};
use super::rules::Candidate;
use crate::llm_proxy::port::CompletionRequest;

/// Bumped whenever the question or the reading changes.
pub const JUDGE_VERSION: &str = "2";

/// Lines shown around each side.
const CONTEXT_LINES: usize = 25;

const SYSTEM: &str = "You review two passages from a software project's specification documents \
that an automatic check thinks disagree about the application being specified. Decide whether \
they really cannot both be true of the application as specified now.\n\n\
They do NOT conflict when: one is history, an example, a research note or the context of a \
decision; one is marked future, planned, proposed or out of scope while the other describes now; \
one refines the other (adds detail without denying it); they are about different things that \
share a name; or the difference is only wording. A document that says it was replaced, or a \
decision record marked superseded, is not in force.\n\n\
They DO conflict when a person building the application from both would have to choose one: \
different values, counts, owners, triggers, cardinalities, access rules or decisions for the same \
thing, both stated as in force.\n\n\
Answer with one JSON object and nothing else:\n\
{\"conflict\": true|false, \"rule\": \"contradiction.value\"|\"contradiction.cardinality\"|\
\"contradiction.lifecycle\"|\"contradiction.access\"|\"contradiction.decision\"|\
\"stale.superseded\"|\"reference.misattributed\", \"explanation\": \"one or two sentences: why both cannot hold\", \
\"fix\": {\"kind\": \"edit\", \"path\": \"…\", \"replace\": \"exact text from that document\", \
\"with\": \"…\"} or {\"kind\": \"decide\", \"options\": [\"…\", \"…\"]}, \
\"confidence\": \"high\"|\"medium\"|\"low\"}\n\n\
Propose an edit only when the documents themselves show which side is right (a later decision, \
the side the other documents agree with); otherwise name the decision a person has to take. An \
edit replaces as little as possible.\n\n\
When the question is whether a passage cites the right decision record, it conflicts only when \
what the passage says the record is for is not what the record decides (its title and its \
Decision section): a citation for background, or for one consequence of the decision, is right. \
The fix then names the record the passage means, when another one in view does.";

/// The question for one candidate. `text_of` gives a document's text by path.
pub fn request<'a>(
    candidate: &Candidate,
    text_of: impl Fn(&str) -> Option<&'a str>,
) -> CompletionRequest {
    let mut prompt = format!("The check's reason: {}\n", reason(candidate));
    for (i, (name, side)) in ["A", "B"].iter().zip(&candidate.sides).enumerate() {
        prompt.push_str(&format!(
            "\nPassage {name}: `{}` lines {}-{}, extracted as {} ({}): \"{}\"\n",
            side.path, side.line_start, side.line_end, side.status, side.value, side.quote
        ));
        if let Some(text) = text_of(&side.path) {
            // The record a citation names is judged by its decision, wherever
            // in the record that is, not by the lines around its title.
            if i == 1 && candidate.rule == "reference.misattributed" {
                prompt.push_str(&format!("The record `{}`:\n", side.path));
                prompt.push_str(&decision_of(text));
            } else {
                prompt.push_str(&format!("Around it in `{}`:\n", side.path));
                prompt.push_str(&context(text, side.line_start, side.line_end));
            }
        }
    }
    CompletionRequest {
        system: SYSTEM.to_string(),
        prompt,
        max_tokens: 1_500,
    }
}

/// What the check suspects, in the judge's words.
fn reason(candidate: &Candidate) -> String {
    match candidate.rule {
        "reference.misattributed" => format!(
            "passage A cites the decision record B (\"{}\") for something its words do not \
             share with the record's title; check whether B decides what A cites it for.",
            candidate.subject
        ),
        "contradiction.decision" => format!(
            "passage A says something about \"{}\" ({}) that the decision in B settles \
             differently, or treats as made a decision B only proposes.",
            candidate.subject, candidate.aspect
        ),
        "stale.superseded" => format!(
            "passage A, in force, describes \"{}\" ({}) the way B says was replaced.",
            candidate.subject, candidate.aspect
        ),
        _ => format!(
            "two statements about \"{}\" ({}) give different answers.",
            candidate.subject, candidate.aspect
        ),
    }
}

/// A decision record's first lines (title, status) and its Decision
/// section, numbered: what it decides, without its Context. The first lines
/// only when it has no section of that name.
fn decision_of(text: &str) -> String {
    const HEAD: usize = 12;
    const SECTION: usize = 50;
    let lines: Vec<&str> = text.lines().collect();
    let mut shown: Vec<usize> = (1..=HEAD.min(lines.len())).collect();
    let decision = lines.iter().position(|l| {
        let t = l.trim_start();
        t.starts_with("##") && t.to_lowercase().contains("decision")
    });
    if let Some(at) = decision {
        let from = (at + 1).max(HEAD + 1);
        let to = (at + 1 + SECTION).min(lines.len());
        shown.extend(from..=to);
    }
    let mut out = String::new();
    let mut last = 0;
    for n in shown {
        if last != 0 && n != last + 1 {
            out.push_str("…\n");
        }
        out.push_str(&format!("{n}| {}\n", lines[n - 1]));
        last = n;
    }
    out
}

/// The lines around `start..=end`, numbered, plus the headings above them so
/// the section's name and status notes are seen.
fn context(text: &str, start: usize, end: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let from = start.saturating_sub(CONTEXT_LINES).max(1);
    let to = (end + CONTEXT_LINES).min(lines.len());
    let mut out = String::new();
    let headings: Vec<(usize, &str)> = lines[..from.saturating_sub(1)]
        .iter()
        .enumerate()
        .filter(|(_, l)| l.trim_start().starts_with('#'))
        .map(|(i, l)| (i + 1, *l))
        .collect();
    for (n, h) in headings.iter().rev().take(3).rev() {
        out.push_str(&format!("{n}| {h}\n"));
    }
    if !headings.is_empty() {
        out.push_str("…\n");
    }
    for n in from..=to {
        out.push_str(&format!("{n}| {}\n", lines[n - 1]));
    }
    out
}

#[derive(Deserialize)]
struct Answer {
    conflict: bool,
    #[serde(default)]
    rule: String,
    #[serde(default)]
    explanation: String,
    #[serde(default)]
    fix: Option<RawFix>,
    #[serde(default)]
    confidence: String,
}

#[derive(Deserialize)]
struct RawFix {
    #[serde(default)]
    kind: String,
    #[serde(default)]
    path: String,
    #[serde(default)]
    replace: String,
    #[serde(default)]
    with: String,
    #[serde(default)]
    options: Vec<String>,
}

const RULES: [&str; 7] = [
    "contradiction.value",
    "contradiction.cardinality",
    "contradiction.lifecycle",
    "contradiction.access",
    "contradiction.decision",
    "stale.superseded",
    "reference.misattributed",
];

/// What the judge said: `Ok(None)` when the passages do not conflict (or it
/// is not sure), `Ok(Some)` with the finding when they do, `Err` when the
/// answer is not what was asked for.
pub fn read_answer<'a>(
    candidate: &Candidate,
    answer: &str,
    text_of: impl Fn(&str) -> Option<&'a str>,
) -> Result<Option<Finding>, String> {
    let start = answer.find('{').ok_or("the answer holds no JSON object")?;
    let end = answer.rfind('}').ok_or("the answer holds no JSON object")?;
    let a: Answer = serde_json::from_str(&answer[start..=end])
        .map_err(|e| format!("the answer is not the JSON asked for: {e}"))?;
    let confidence = a.confidence.to_ascii_lowercase();
    if !a.conflict || confidence == "low" || a.explanation.trim().is_empty() {
        return Ok(None);
    }
    let rule = RULES
        .iter()
        .find(|r| **r == a.rule.trim())
        .copied()
        .unwrap_or(candidate.rule);
    // A wrong citation stays one, whatever else the judge calls it.
    let rule = if candidate.rule == "reference.misattributed" {
        candidate.rule
    } else {
        rule
    };
    let severity = if rule == "stale.superseded" || confidence != "high" {
        "medium"
    } else {
        "high"
    };
    let mut finding = Finding::new(
        rule,
        severity,
        a.explanation.trim().to_string(),
        candidate.side_refs(),
    )
    .keyed_by_sides();
    if let Some(fix) = a.fix {
        match fix.kind.as_str() {
            "edit" if holds(text_of(&fix.path), &fix.replace) && !fix.with.trim().is_empty() => {
                finding.edit = Some(Edit {
                    path: fix.path,
                    replace: fix.replace,
                    with: fix.with,
                });
            }
            _ => {
                let options: Vec<&str> = fix
                    .options
                    .iter()
                    .map(String::as_str)
                    .filter(|o| !o.trim().is_empty())
                    .collect();
                finding = finding.with_fix_decide(&options);
            }
        }
    }
    Ok(Some(finding))
}

/// Whether `text` holds `passage`, whitespace aside.
fn holds(text: Option<&str>, passage: &str) -> bool {
    let fold = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
    let passage = fold(passage);
    !passage.is_empty() && text.is_some_and(|t| fold(t).contains(&passage))
}

#[cfg(test)]
#[path = "judge_tests.rs"]
mod tests;
