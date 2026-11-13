//! Requirements of other projects that say the same thing, or its opposite
//! (`docs/project-domain-model.md`, "Across projects"; issue #733).
//!
//! The project domain model finds disagreements inside one project. Interviews asked
//! for the other half: "does another team already require this, or the
//! opposite?" (problem 1.2, eighteen people in six companies). This is the
//! deterministic part: candidates by the words two statements share, and a
//! flag where one of them negates what the other requires. Nothing here
//! decides a contradiction; a person reads both passages, and a model judge
//! can be put behind it later the way `judge.rs` stands behind the rules.

use std::collections::BTreeSet;

use super::requirements::Requirement;

/// How alike two statements must be to be shown at all.
pub const MIN_SCORE: f64 = 0.45;
/// At or above this, the two read as the same requirement.
pub const SAME_SCORE: f64 = 0.75;
/// At most this many matches per requirement.
pub const PER_REQUIREMENT: usize = 3;

/// Words that carry no meaning of their own in a requirement.
const STOP: [&str; 44] = [
    "the", "and", "for", "with", "that", "this", "are", "was", "were", "has", "have", "had", "its",
    "into", "from", "when", "then", "than", "each", "every", "any", "all", "can", "may", "must",
    "shall", "should", "will", "would", "system", "user", "users", "able", "also", "only", "such",
    "which", "who", "whom", "their", "there", "these", "those", "via",
];

/// Words that turn a requirement into its opposite.
const NEGATIONS: [&str; 7] = [
    "not",
    "never",
    "no",
    "without",
    "cannot",
    "forbidden",
    "prohibited",
];

/// A requirement of another project, with the project it belongs to.
#[derive(Clone, Debug)]
pub struct Elsewhere {
    pub project_id: String,
    pub requirement: Requirement,
}

/// `same`, `overlap` or `opposite`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Relation {
    Same,
    Overlap,
    /// Alike in what they are about, and one of them negates it.
    Opposite,
}

impl Relation {
    pub fn as_str(self) -> &'static str {
        match self {
            Relation::Same => "same",
            Relation::Overlap => "overlap",
            Relation::Opposite => "opposite",
        }
    }
}

/// One requirement here and one elsewhere that read alike.
#[derive(Clone, Debug)]
pub struct Match {
    pub here: Requirement,
    pub there: Elsewhere,
    pub score: f64,
    pub relation: Relation,
    /// The words they share, for a reader to see why.
    pub shared: Vec<String>,
}

/// The meaningful words of a statement, folded.
pub fn words(text: &str) -> BTreeSet<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() >= 3 && !STOP.contains(w) && !NEGATIONS.contains(w))
        .map(|w| w.trim_end_matches('s').to_string())
        .filter(|w| w.len() >= 3)
        .collect()
}

fn negated(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower
        .split(|c: char| !c.is_alphanumeric() && c != '\'')
        .any(|w| NEGATIONS.contains(&w) || w.ends_with("n't"))
}

/// Every requirement here matched against every one elsewhere: the best
/// [`PER_REQUIREMENT`] matches per requirement, strongest first, then
/// requirements in document order.
pub fn related(here: &[Requirement], elsewhere: &[Elsewhere]) -> Vec<Match> {
    let theirs: Vec<(BTreeSet<String>, bool, &Elsewhere)> = elsewhere
        .iter()
        .map(|e| (words(&e.requirement.text), negated(&e.requirement.text), e))
        .filter(|(w, _, _)| w.len() >= 3)
        .collect();
    let mut out = Vec::new();
    for mine in here {
        let w = words(&mine.text);
        if w.len() < 3 {
            continue;
        }
        let neg = negated(&mine.text);
        let mut found: Vec<Match> = theirs
            .iter()
            .filter_map(|(tw, tneg, e)| {
                let shared: Vec<String> = w.intersection(tw).cloned().collect();
                let union = w.union(tw).count();
                let score = shared.len() as f64 / union as f64;
                (score >= MIN_SCORE).then(|| Match {
                    here: mine.clone(),
                    there: (*e).clone(),
                    score,
                    relation: if neg != *tneg {
                        Relation::Opposite
                    } else if score >= SAME_SCORE {
                        Relation::Same
                    } else {
                        Relation::Overlap
                    },
                    shared,
                })
            })
            .collect();
        found.sort_by(|a, b| b.score.total_cmp(&a.score));
        found.truncate(PER_REQUIREMENT);
        out.extend(found);
    }
    out
}

#[cfg(test)]
#[path = "related_tests.rs"]
mod tests;
