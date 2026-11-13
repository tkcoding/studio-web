//! What a project has to decide before it can build from its documents, most
//! blocking first, and whether anything stops a build (the portal's Issues
//! tab; `docs/project-domain-model.md`, "To resolve").
//!
//! Moved from the portal (`domain-model-views.ts` `resolveQueue`, `blocks`,
//! `readiness`, and the Issues table's grouping in `domain-model-screens.tsx`)
//! so an agent reads the same queue a person does. Pure: the route reads the
//! findings, their decisions, the requirements and the opened issues, and
//! this orders them.
//!
//! The table's second half — ways to make the documentation better (no
//! definition, two names, one-sided relation) — is `doc_quality.rs`, served
//! by `GET /project-domain-model/doc-quality`.

use std::cmp::Ordering;
use std::collections::BTreeMap;

use super::finding::{Finding, Side};
use super::requirements::Requirement;

/// The kinds of requirement that say what to build, so a missing basis
/// matters. An ADR or a component that states no source is not chased.
const BUILDABLE: [&str; 5] = ["fr", "nfr", "feature", "usecase", "constraint"];

/// Where a row came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Type {
    /// A problem in the documents a rule or the judge found.
    Finding,
    /// A requirement left undecided.
    Question,
    /// A requirement resting on an assumption.
    Assumption,
    /// A buildable requirement that says nothing of where it comes from.
    NoBasis,
}

impl Type {
    pub fn as_str(self) -> &'static str {
        match self {
            Type::Finding => "finding",
            Type::Question => "question",
            Type::Assumption => "assumption",
            Type::NoBasis => "nobasis",
        }
    }

    /// What the Issues table calls it.
    fn label(self) -> &'static str {
        match self {
            Type::Finding => "Problem",
            Type::Question => "Open question",
            Type::Assumption => "Assumption",
            Type::NoBasis => "No basis",
        }
    }
}

/// A finding with a member's word on it: `confirmed` or `dismissed`.
#[derive(Clone, Debug)]
pub struct Decided {
    pub finding: Finding,
    pub decision: Option<String>,
}

/// One thing to decide.
#[derive(Clone, Debug)]
pub struct Item {
    /// `f:<fingerprint>`, `q:<id>`, `a:<id>` or `n:<id>`: what an opened
    /// issue is recorded under (`iss:<key>`).
    pub key: String,
    pub r#type: Type,
    /// `bad` blocks a build; `warn` should be looked at.
    pub tone: &'static str,
    /// A finding the model proposed from facts nobody confirmed (a judged
    /// contradiction): a concern, not a verdict, until a person says so.
    pub concern: bool,
    pub title: String,
    /// What is wrong and what to do about it, in a sentence.
    pub hint: String,
    pub sides: Vec<Side>,
    pub finding: Option<Decided>,
    pub requirement: Option<Requirement>,
    /// Decided already: listed after the rest.
    pub done: bool,
}

impl Item {
    /// What the Issues table calls it.
    pub fn label(&self) -> &'static str {
        if self.concern {
            "Possible conflict"
        } else {
            self.r#type.label()
        }
    }

    /// Whether it stops a build: a problem a rule established, a concern a
    /// person confirmed, a question nobody answered. An assumption, a
    /// requirement with no source and a concern nobody looked at do not.
    pub fn blocks(&self) -> bool {
        match self.r#type {
            Type::Question => !self.done,
            Type::Finding if self.concern => self
                .finding
                .as_ref()
                .is_some_and(|f| f.decision.as_deref() == Some("confirmed")),
            Type::Finding => !self.done,
            _ => false,
        }
    }

    /// The Issues table's group: `blocks`, `look` or `decided`.
    pub fn group(&self) -> &'static str {
        if self.blocks() {
            "blocks"
        } else if self.done {
            "decided"
        } else {
            "look"
        }
    }

    /// What can be done about it, as the portal offers it: on an open finding
    /// `propose_fix` (when it carries an edit), `confirm` and `dismiss`; on a
    /// requirement `trace`; and `create_issue` on any row with no issue yet.
    pub fn actions(&self, issue_opened: bool) -> Vec<&'static str> {
        let mut out = Vec::new();
        if let Some(f) = &self.finding
            && !self.done
        {
            if f.finding.edit.is_some() {
                out.push("propose_fix");
            }
            out.push("confirm");
            out.push("dismiss");
        }
        if self.requirement.is_some() {
            out.push("trace");
        }
        if !issue_opened {
            out.push("create_issue");
        }
        out
    }
}

/// A judged contradiction rather than a finding a rule established.
pub fn is_concern(rule: &str) -> bool {
    rule.starts_with("contradiction.")
}

/// A finding's message as a headline: a dangling reference reads as what is
/// missing.
pub fn finding_title(message: &str) -> String {
    const CITED: &str = " is cited, but the project has no ";
    let Some(at) = message.find(CITED) else {
        return message.to_string();
    };
    let what = &message[..at];
    let missing = &message[at + CITED.len()..];
    let missing = missing.strip_suffix('.').unwrap_or(missing);
    if what.is_empty() || missing.is_empty() {
        return message.to_string();
    }
    format!("{what} is cited, but there is no {missing}")
}

fn finding_hint(rule: &str) -> &'static str {
    if rule.starts_with("reference.") {
        "A document points at something that does not exist. Fix the reference, or write what it names."
    } else if is_concern(rule) {
        "The model reads these passages as disagreeing. It is a proposed concern, not a verdict: say whether it is a real problem, then fix the document that is wrong."
    } else {
        "The documents cannot all be right here. Decide which one is, and fix the others."
    }
}

fn severity_rank(severity: &str) -> u8 {
    match severity {
        "high" => 0,
        "medium" => 1,
        "low" => 2,
        _ => 3,
    }
}

/// Findings in the order a person works through them (`orderFindings`):
/// undecided, then confirmed, dismissed last; high before low; a rule's
/// findings before a reference's; then by rule.
pub fn order_findings(mut findings: Vec<Decided>) -> Vec<Decided> {
    let decided = |d: &Decided| match d.decision.as_deref() {
        Some("dismissed") => 2,
        Some("confirmed") => 1,
        _ => 0,
    };
    let family = |d: &Decided| u8::from(d.finding.rule.starts_with("reference."));
    findings.sort_by(|a, b| {
        decided(a)
            .cmp(&decided(b))
            .then(severity_rank(&a.finding.severity).cmp(&severity_rank(&b.finding.severity)))
            .then(family(a).cmp(&family(b)))
            .then_with(|| rule_order(&a.finding.rule, &b.finding.rule))
    });
    findings
}

/// Rules compared as the browser's `localeCompare` does for these ASCII
/// names: case does not count first.
fn rule_order(a: &str, b: &str) -> Ordering {
    a.to_lowercase().cmp(&b.to_lowercase()).then(a.cmp(b))
}

/// Everything to decide, most blocking first: the documents' problems, then
/// open questions, assumptions and buildable requirements that state no
/// basis; whatever is decided after the rest. `findings` are taken in
/// [`order_findings`]'s order.
pub fn queue(findings: Vec<Decided>, requirements: &[Requirement]) -> Vec<Item> {
    let mut out = Vec::new();
    let mut findings = order_findings(findings);
    // The browser sorted the ordered findings once more by severity alone,
    // where an unknown severity counts as low: stable, so only that moves.
    findings.sort_by_key(|d| severity_rank(&d.finding.severity).min(2));
    for d in findings {
        let concern = is_concern(&d.finding.rule);
        let decision = d.decision.as_deref();
        let tone = if d.finding.severity == "low" || (concern && decision != Some("confirmed")) {
            "warn"
        } else {
            "bad"
        };
        out.push(Item {
            key: format!("f:{}", d.finding.fingerprint),
            r#type: Type::Finding,
            tone,
            concern,
            title: finding_title(&d.finding.message),
            hint: finding_hint(&d.finding.rule).to_string(),
            sides: d.finding.sides.clone(),
            done: matches!(decision, Some("dismissed" | "confirmed")),
            finding: Some(d),
            requirement: None,
        });
    }
    let because = |r: &Requirement| {
        r.because
            .as_deref()
            .filter(|b| !b.is_empty())
            .map(|b| format!(": \u{201c}{b}\u{201d}"))
            .unwrap_or_default()
    };
    let row =
        |r: &Requirement, prefix: &str, r#type: Type, tone: &'static str, hint: String| Item {
            key: format!("{prefix}:{}", r.id),
            r#type,
            tone,
            concern: false,
            title: r.title.clone().unwrap_or_else(|| r.id.clone()),
            hint,
            sides: vec![Side {
                path: r.path.clone(),
                line_start: Some(r.line),
                line_end: Some(r.line),
                quote: None,
            }],
            finding: None,
            requirement: Some(r.clone()),
            done: false,
        };
    for r in requirements
        .iter()
        .filter(|r| r.basis.as_str() == "open_question")
    {
        let hint = format!(
            "Left undecided{}. Someone has to answer it before it is built.",
            because(r)
        );
        out.push(row(r, "q", Type::Question, "bad", hint));
    }
    for r in requirements
        .iter()
        .filter(|r| r.basis.as_str() == "assumption")
    {
        let hint = format!(
            "Rests on an assumption{}. It may wait for a check; say how it will be checked, or cite what already shows it.",
            because(r)
        );
        out.push(row(r, "a", Type::Assumption, "warn", hint));
    }
    for r in requirements.iter().filter(|r| {
        r.basis.as_str() == "stated" && BUILDABLE.contains(&r.kind.as_deref().unwrap_or(""))
    }) {
        let hint = "Says what to build, but not why or from where. Worth a source or the decision behind it; it does not stop a build.".to_string();
        out.push(row(r, "n", Type::NoBasis, "warn", hint));
    }
    let (done, open): (Vec<Item>, Vec<Item>) = out.into_iter().partition(|i| i.done);
    open.into_iter().chain(done).collect()
}

/// How far the documents are from something one can build from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Readiness {
    /// Requirements the documents define.
    pub total: usize,
    /// Of them, those that cite a source.
    pub cited: usize,
    /// Those that give a reason and cite nothing.
    pub reasoned: usize,
    /// Rows that wait for somebody.
    pub open: usize,
    /// Of them, the ones that stop a build.
    pub blocking: usize,
    pub ready: bool,
}

/// Whether anything stops a build, from the queue and the requirements'
/// count by basis.
pub fn readiness(queue: &[Item], by_basis: &BTreeMap<String, usize>, total: usize) -> Readiness {
    let blocking = queue.iter().filter(|i| i.blocks()).count();
    Readiness {
        total,
        cited: by_basis.get("cited").copied().unwrap_or(0),
        reasoned: by_basis.get("reasoned").copied().unwrap_or(0),
        open: queue.iter().filter(|i| !i.done).count(),
        blocking,
        ready: blocking == 0,
    }
}

#[cfg(test)]
#[path = "resolve_tests.rs"]
mod resolve_tests;
