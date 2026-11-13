//! What one document leaves out of the domain the rest of the project
//! describes, and the words it uses where the project agreed on others
//! (`docs/project-domain-model.md`, "Questions while writing"; issue #737).
//!
//! Interview problem 1.3: two or three people per company know a domain, and
//! a PRD written without them misses a key entity — the ledger in billing —
//! which is then absent from the design and the code. The project's own
//! model already knows the entities its other documents describe. A document
//! that speaks of an entity the model relates to another one it never
//! mentions is asked about that other one. Deterministic, from the facts
//! already extracted; nothing is asked of a model here.

use std::collections::{BTreeMap, BTreeSet};

use super::extract::Fact;
use super::glossary::Entry;
use super::rules::subject_key;

/// One question for the document's author.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Question {
    /// The entity the document does not mention, by the project's name.
    pub entity: String,
    /// The entities the document does mention that the model relates it to.
    pub because_of: Vec<String>,
    /// How much the project's other documents say about it.
    pub facts: usize,
    /// The documents that speak of it, most facts first.
    pub documents: Vec<String>,
    /// One passage that relates it, for the reader to see why.
    pub example: Option<(String, usize, String)>,
}

/// A word the document uses for a thing the project calls otherwise.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Drift {
    pub used: String,
    pub project_name: String,
    pub line: usize,
}

/// The most questions one document gets: the strongest first.
pub const MAX_QUESTIONS: usize = 15;

/// Whether `text` (lower-cased) names `phrase` as whole words.
fn mentions(text: &str, phrase: &str) -> Option<usize> {
    let phrase = phrase.trim().to_lowercase();
    if phrase.len() < 3 {
        return None;
    }
    let word = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric() || c == '_');
    let mut from = 0;
    while let Some(at) = text[from..].find(&phrase) {
        let start = from + at;
        let end = start + phrase.len();
        if !word(text[..start].chars().next_back()) && !word(text[end..].chars().next()) {
            return Some(start);
        }
        from = start + phrase.len().max(1);
        while from < text.len() && !text.is_char_boundary(from) {
            from += 1;
        }
    }
    None
}

fn line_of(text: &str, byte: usize) -> usize {
    text[..byte].matches('\n').count() + 1
}

/// The entry a fact's subject belongs to, by key.
fn owners(entries: &[Entry]) -> BTreeMap<String, usize> {
    let mut out = BTreeMap::new();
    for (i, e) in entries.iter().enumerate() {
        out.insert(e.key.clone(), i);
        for a in &e.aliases {
            out.insert(a.key.clone(), i);
        }
    }
    out
}

/// The questions and the drifts for one document.
pub fn questions(
    doc_path: &str,
    doc_text: &str,
    entries: &[Entry],
    facts: &[Fact],
) -> (Vec<Question>, Vec<Drift>) {
    let text = doc_text.to_lowercase();
    let owner = owners(entries);
    let entry_of = |subject: &str| owner.get(&subject_key(subject)).copied();
    let mentioned: BTreeSet<usize> = entries
        .iter()
        .enumerate()
        .filter(|(_, e)| e.spellings.iter().any(|s| mentions(&text, s).is_some()))
        .map(|(i, _)| i)
        .collect();

    // Which entries the facts of the other documents relate to which: a fact
    // about one entry whose value or passage names another.
    let mut links: BTreeMap<usize, BTreeMap<usize, (String, usize, String)>> = BTreeMap::new();
    let mut fact_count: BTreeMap<usize, usize> = BTreeMap::new();
    let mut docs_of: BTreeMap<usize, BTreeMap<String, usize>> = BTreeMap::new();
    for f in facts.iter().filter(|f| f.path != doc_path) {
        let Some(a) = entry_of(&f.subject) else {
            continue;
        };
        *fact_count.entry(a).or_default() += 1;
        *docs_of
            .entry(a)
            .or_default()
            .entry(f.path.clone())
            .or_default() += 1;
        let said = format!("{} {}", f.value, f.text).to_lowercase();
        for (b, e) in entries.iter().enumerate() {
            if b == a || !e.spellings.iter().any(|s| mentions(&said, s).is_some()) {
                continue;
            }
            let example = (f.path.clone(), f.line_start, f.quote.clone());
            links
                .entry(a)
                .or_default()
                .entry(b)
                .or_insert(example.clone());
            links.entry(b).or_default().entry(a).or_insert(example);
        }
    }

    let mut out: Vec<Question> = entries
        .iter()
        .enumerate()
        .filter(|(i, _)| !mentioned.contains(i))
        .filter_map(|(i, e)| {
            let related = links.get(&i)?;
            let because: Vec<(&usize, &(String, usize, String))> = related
                .iter()
                .filter(|(m, _)| mentioned.contains(m))
                .collect();
            if because.is_empty() {
                return None;
            }
            let mut documents: Vec<(String, usize)> = docs_of
                .get(&i)
                .map(|d| d.iter().map(|(p, n)| (p.clone(), *n)).collect())
                .unwrap_or_default();
            documents.sort_by(|x, y| y.1.cmp(&x.1).then(x.0.cmp(&y.0)));
            Some(Question {
                entity: e.name.clone(),
                because_of: because
                    .iter()
                    .map(|(m, _)| entries[**m].name.clone())
                    .collect(),
                facts: fact_count.get(&i).copied().unwrap_or(0),
                documents: documents.into_iter().map(|(p, _)| p).collect(),
                example: because.first().map(|(_, ex)| (*ex).clone()),
            })
        })
        .collect();
    out.sort_by(|a, b| {
        b.because_of
            .len()
            .cmp(&a.because_of.len())
            .then(b.facts.cmp(&a.facts))
            .then(a.entity.cmp(&b.entity))
    });
    out.truncate(MAX_QUESTIONS);

    // A merged alias used in the document, where the project chose a name.
    let mut drifts = Vec::new();
    for e in entries.iter().filter(|e| !e.aliases.is_empty()) {
        if e.aliases
            .iter()
            .any(|a| a.name.eq_ignore_ascii_case(&e.name))
        {
            continue;
        }
        for a in &e.aliases {
            if let Some(at) = mentions(&text, &a.name) {
                drifts.push(Drift {
                    used: a.name.clone(),
                    project_name: e.name.clone(),
                    line: line_of(&text, at),
                });
            }
        }
    }
    drifts.sort_by_key(|d| d.line);
    (out, drifts)
}

#[cfg(test)]
#[path = "questions_tests.rs"]
mod tests;
