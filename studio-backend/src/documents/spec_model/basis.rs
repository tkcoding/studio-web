//! Whether a fact is what its passage says or what the model made of it
//! (`docs/project-domain-model.md`, "Stated or interpreted").
//!
//! WHY DERIVED, NOT ASKED. The extractor could be asked to mark each fact,
//! but that is the model's word about itself, it would need a new extractor
//! version (every document read again, on people's keys), and readings kept
//! before would have no mark at all. The quote is already checked
//! mechanically against the text (`extract::read_answer`); this checks the
//! fact against its quote the same way: a fact is `stated` when every word
//! that carries its subject and its value is in the quote, and `interpreted`
//! when the model had to bring a word the passage does not have — an
//! implicit entity, a value inferred from context, a paraphrase. Pure and
//! deterministic, so the same reading always gets the same mark.
//!
//! It is not readiness's `cited`/`reasoned`: that is about where a
//! requirement says it comes from, not whether a fact is in its passage.

use std::collections::BTreeSet;

use super::extract::Fact;

/// The fact's words are in its passage.
pub const STATED: &str = "stated";
/// The model brought words the passage does not have.
pub const INTERPRETED: &str = "interpreted";

/// Words too common to carry a fact.
const STOP: [&str; 24] = [
    "the", "and", "for", "with", "per", "any", "all", "are", "its", "has", "have", "from", "that",
    "this", "into", "each", "can", "may", "will", "was", "were", "been", "via", "own",
];

/// `stated` or `interpreted`.
pub fn basis(fact: &Fact) -> &'static str {
    let quote = words(&fact.quote);
    // A fact with no word of its own to check rests on the passage alone.
    let stated = words(&fact.subject)
        .into_iter()
        .chain(words(&fact.value))
        .all(|w| quote.contains(&w));
    if stated { STATED } else { INTERPRETED }
}

/// The words of `text` that carry meaning: letters and digits, lowercased,
/// a plural `s` folded, short and common words left out (a number counts
/// whatever its length).
fn words(text: &str) -> BTreeSet<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_lowercase)
        .filter(|w| w.chars().all(|c| c.is_ascii_digit()) || w.chars().count() >= 3)
        .filter(|w| !STOP.contains(&w.as_str()))
        .map(|w| fold(&w))
        .collect()
}

fn fold(w: &str) -> String {
    if w.chars().count() > 3 && w.ends_with('s') && !w.ends_with("ss") {
        w[..w.len() - 1].to_owned()
    } else {
        w.to_owned()
    }
}

#[cfg(test)]
#[path = "basis_tests.rs"]
mod tests;
