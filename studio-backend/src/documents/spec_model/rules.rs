//! Stages 3 and 4: the facts of every document merged into one model, and the
//! candidates for a disagreement found in it (`docs/project-domain-model.md`,
//! "The rule catalogue").
//!
//! No model is asked here, and nothing here is a finding yet: a candidate is
//! two passages that look as if they cannot both hold, and the judge decides
//! whether they really cannot. So these rules may be generous, and they are
//! kept cheap instead: one candidate per pair of different values, never one
//! per pair of passages.

use std::collections::BTreeMap;

use super::extract::Fact;
use super::finding::Side;

/// Two passages that may disagree, for the judge.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Candidate {
    pub rule: &'static str,
    /// The merged subject and aspect both sides are about.
    pub subject: String,
    pub aspect: String,
    pub sides: [Fact; 2],
}

impl Candidate {
    pub fn side_refs(&self) -> Vec<Side> {
        self.sides
            .iter()
            .map(|f| Side {
                path: f.path.clone(),
                line_start: Some(f.line_start),
                line_end: Some(f.line_end),
                quote: Some(f.quote.clone()),
            })
            .collect()
    }
}

/// A subject as the documents name it, folded so that two spellings of one
/// thing meet: case, articles, punctuation and a plural `s` do not count.
pub fn subject_key(subject: &str) -> String {
    let words: Vec<String> = subject
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty() && !matches!(*w, "the" | "a" | "an"))
        .map(singular)
        .collect();
    words.join(" ")
}

fn singular(word: &str) -> String {
    let keep = word.len() <= 3 || ["ss", "us", "is"].iter().any(|e| word.ends_with(e));
    match word.strip_suffix('s') {
        Some(stem) if !keep => stem.to_string(),
        _ => word.to_string(),
    }
}

/// A value, folded for comparing: two values that differ only in case,
/// markup, punctuation or spacing are one value.
fn value_key(value: &str) -> String {
    value
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Which rule a disagreement between two facts falls under: against a
/// decision when either is one, else by the aspect.
fn rule_for_pair(a: &Fact, b: &Fact) -> &'static str {
    if a.kind == "decision" || b.kind == "decision" {
        "contradiction.decision"
    } else {
        rule_for(a)
    }
}

/// Which rule a disagreement about this kind of fact and aspect falls under.
fn rule_for(fact: &Fact) -> &'static str {
    let aspect = fact.aspect.to_lowercase();
    let has = |words: &[&str]| words.iter().any(|w| aspect.contains(w));
    if has(&["cardinality", "grain", "per ", "one row", "multiplicity"]) {
        "contradiction.cardinality"
    } else if fact.kind == "lifecycle"
        || has(&[
            "trigger",
            "schedule",
            "dating",
            "start",
            "expir",
            "retention",
            "state",
        ])
    {
        "contradiction.lifecycle"
    } else if has(&[
        "access",
        "read",
        "write",
        "permission",
        "role",
        "who may",
        "authoriz",
    ]) {
        "contradiction.access"
    } else {
        "contradiction.value"
    }
}

/// Whether two facts rest on the same passage (the model extracted one
/// sentence twice): such a pair is not a disagreement between places.
fn same_place(a: &Fact, b: &Fact) -> bool {
    a.path == b.path && a.line_start <= b.line_end && b.line_start <= a.line_end
}

/// Every candidate in the model, at most `cap`, the ones across documents
/// first: a disagreement between two documents is the kind a single-document
/// check cannot see, and the kind calibration found most of.
pub fn candidates(facts: &[Fact], cap: usize) -> Vec<Candidate> {
    // (subject, aspect) → facts with a value about it.
    let mut groups: BTreeMap<(String, String), Vec<&Fact>> = BTreeMap::new();
    for fact in facts {
        if fact.aspect.trim().is_empty() || fact.value.trim().is_empty() {
            continue;
        }
        let key = (subject_key(&fact.subject), subject_key(&fact.aspect));
        if key.0.is_empty() || key.1.is_empty() {
            continue;
        }
        groups.entry(key).or_default().push(fact);
    }
    let mut out: Vec<Candidate> = Vec::new();
    for ((subject, aspect), group) in &groups {
        conflicts_in(subject, aspect, group, &mut out);
        stale_in(subject, aspect, group, &mut out);
        taken_as_made_in(subject, aspect, group, &mut out);
    }
    out.sort_by_key(|c| c.sides[0].path == c.sides[1].path);
    out.truncate(cap);
    out
}

/// Two `active` facts giving one slot different values: one candidate per
/// pair of values, its sides the first passage of each.
fn conflicts_in(subject: &str, aspect: &str, group: &[&Fact], out: &mut Vec<Candidate>) {
    let mut by_value: BTreeMap<String, &Fact> = BTreeMap::new();
    for fact in group.iter().filter(|f| f.status == "active") {
        by_value.entry(value_key(&fact.value)).or_insert(fact);
    }
    let values: Vec<&&Fact> = by_value.values().collect();
    for (i, a) in values.iter().enumerate() {
        for b in &values[i + 1..] {
            if same_place(a, b) {
                continue;
            }
            // The decision, when there is one, is side B: the text is what
            // has to answer to it.
            let (a, b) = if a.kind == "decision" && b.kind != "decision" {
                (b, a)
            } else {
                (a, b)
            };
            out.push(Candidate {
                rule: rule_for_pair(a, b),
                subject: subject.to_string(),
                aspect: aspect.to_string(),
                sides: [(**a).clone(), (**b).clone()],
            });
        }
    }
}

/// `active` text giving a slot the very value another passage says was
/// replaced: the text still describes what is gone.
fn stale_in(subject: &str, aspect: &str, group: &[&Fact], out: &mut Vec<Candidate>) {
    for gone in group.iter().filter(|f| f.status == "superseded") {
        let key = value_key(&gone.value);
        if let Some(still) = group
            .iter()
            .find(|f| f.status == "active" && value_key(&f.value) == key && !same_place(f, gone))
        {
            out.push(Candidate {
                rule: "stale.superseded",
                subject: subject.to_string(),
                aspect: aspect.to_string(),
                sides: [(**still).clone(), (**gone).clone()],
            });
        }
    }
}

/// `active` text stating as done what only a `proposed` decision says: the
/// text treats a decision nobody has made as made. A proposed decision that
/// shows signs of being built is already `active` (the extraction's status),
/// so it never gets here.
fn taken_as_made_in(subject: &str, aspect: &str, group: &[&Fact], out: &mut Vec<Candidate>) {
    for proposed in group
        .iter()
        .filter(|f| f.kind == "decision" && f.status == "proposed")
    {
        let key = value_key(&proposed.value);
        if let Some(taken) = group.iter().find(|f| {
            f.kind != "decision"
                && f.status == "active"
                && f.path != proposed.path
                && value_key(&f.value) == key
        }) {
            out.push(Candidate {
                rule: "contradiction.decision",
                subject: subject.to_string(),
                aspect: aspect.to_string(),
                sides: [(**taken).clone(), (**proposed).clone()],
            });
        }
    }
}

#[cfg(test)]
#[path = "rules_tests.rs"]
mod tests;
