//! Stage 2: a document's facts, asked of a model and checked against the
//! text (`docs/project-domain-model.md`, "A build").
//!
//! Everything here is pure: cutting a document into pieces a model can read
//! with their line numbers, the prompt, and reading the answer. Reading the
//! answer is where precision is won: a fact whose quote is not in the text it
//! names is dropped, never kept on the model's word.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::llm_proxy::port::CompletionRequest;

/// Bumped whenever the prompt or the reading changes, so a document is
/// extracted again rather than served an answer to a different question.
pub const EXTRACTOR_VERSION: &str = "2";

/// How much text one call reads. Large enough that a section and its
/// neighbours arrive together, small enough that the answer fits the budget.
const CHUNK_CHARS: usize = 12_000;

/// The answer's budget per call.
const MAX_TOKENS: u32 = 8_000;

pub const KINDS: [&str; 14] = [
    "entity",
    "attribute",
    "relation",
    "requirement",
    "constraint",
    "lifecycle",
    "decision",
    "role",
    "action",
    "problem",
    "outcome",
    "idea",
    "benefit",
    "scenario",
];

/// Where an entity sits on the map: what the product is about, what serves
/// it, or where it runs.
pub const LAYERS: [&str; 3] = ["domain", "system", "deployment"];

pub const STATUSES: [&str; 6] = [
    "active",
    "proposed",
    "deferred",
    "superseded",
    "resolved",
    "evidence",
];

/// One fact, as extracted from one passage.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Fact {
    pub kind: String,
    /// The entity (or decision) it is about.
    pub subject: String,
    /// The slot a value fills, in plain words; empty when the fact is not a
    /// value of something.
    #[serde(default)]
    pub aspect: String,
    #[serde(default)]
    pub value: String,
    /// The fact in one sentence.
    pub text: String,
    pub status: String,
    /// The words that gave the status, when it is not `active`.
    #[serde(default)]
    pub status_because: String,
    pub path: String,
    pub line_start: usize,
    pub line_end: usize,
    /// Verbatim from the document.
    pub quote: String,
    /// One of [`LAYERS`], stated by the model for an `entity` fact; absent
    /// on other kinds and on extractions kept before it was asked.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layer: Option<String>,
}

/// What one document gave.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Extraction {
    pub facts: Vec<Fact>,
    /// Facts the model gave that the text did not bear out.
    pub dropped: usize,
}

/// A document's revision: its text's hash, so an unchanged document is never
/// asked about twice.
pub fn revision(text: &str) -> String {
    hex::encode(&Sha256::digest(text.as_bytes())[..10])
}

/// One piece of a document, with its first line's number.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Chunk {
    pub first_line: usize,
    pub lines: Vec<String>,
}

impl Chunk {
    pub fn last_line(&self) -> usize {
        self.first_line + self.lines.len().saturating_sub(1)
    }

    /// The text with every line numbered, as the model reads it.
    fn numbered(&self) -> String {
        self.lines
            .iter()
            .enumerate()
            .map(|(i, l)| format!("{}| {l}\n", self.first_line + i))
            .collect()
    }
}

/// The document cut at top-level headings (`#`, `##`) into pieces of at most
/// [`CHUNK_CHARS`]; a section longer than that is cut between lines.
pub fn chunks(text: &str) -> Vec<Chunk> {
    let lines: Vec<&str> = text.lines().collect();
    // Section starts: line 0 and every top-level heading outside a fence.
    let mut starts = vec![0];
    let mut fence = false;
    for (i, line) in lines.iter().enumerate() {
        let t = line.trim_start();
        if t.starts_with("```") || t.starts_with("~~~") {
            fence = !fence;
        }
        if !fence && i > 0 && (t.starts_with("# ") || t.starts_with("## ")) {
            starts.push(i);
        }
    }
    starts.push(lines.len());
    let mut out: Vec<Chunk> = Vec::new();
    let mut current = Chunk {
        first_line: 1,
        lines: Vec::new(),
    };
    let mut size = 0;
    for pair in starts.windows(2) {
        let section = &lines[pair[0]..pair[1]];
        let section_size: usize = section.iter().map(|l| l.len() + 1).sum();
        if size > 0 && size + section_size > CHUNK_CHARS {
            out.push(std::mem::replace(
                &mut current,
                Chunk {
                    first_line: pair[0] + 1,
                    lines: Vec::new(),
                },
            ));
            size = 0;
        }
        for (offset, line) in section.iter().enumerate() {
            if size > 0 && size + line.len() + 1 > CHUNK_CHARS {
                out.push(std::mem::replace(
                    &mut current,
                    Chunk {
                        first_line: pair[0] + offset + 1,
                        lines: Vec::new(),
                    },
                ));
                size = 0;
            }
            current.lines.push((*line).to_string());
            size += line.len() + 1;
        }
    }
    if !current.lines.is_empty() {
        out.push(current);
    }
    out
}

const SYSTEM: &str = "You read software specification documents and extract the domain model of \
the application they describe, as facts. You never invent: every fact rests on a passage you \
quote verbatim from the numbered text you are given.\n\n\
Answer with one JSON object and nothing else:\n\
{\"facts\": [{\"kind\": ..., \"subject\": ..., \"aspect\": ..., \"value\": ..., \"text\": ..., \
\"status\": ..., \"status_because\": ..., \"line_start\": N, \"line_end\": N, \"quote\": ..., \
\"layer\": ...}]}\n\n\
kind is one of:\n\
- entity: a thing the application keeps or acts on. Include implicit ones: a thing never \
declared but used as a key, a grain or a row kind (\"one row per connector instance\" makes \
connector instance an entity). Give each entity a layer: domain (what the product is about: \
organizations, projects, people, what they own and do), system (what serves it: services, \
gears, sessions, screens, events, APIs, the IDE) or deployment (where it runs: clusters, \
images, pipelines, identity provider, databases, CI). Other kinds leave layer out.\n\
- attribute: a property of an entity (subject = the entity, aspect = the property, value = its \
type, rule or allowed values).\n\
- relation: subject relates to another entity (aspect = the verb, value = the other entity and \
the cardinality if stated).\n\
- requirement: something the application must do (subject = what it is mostly about).\n\
- constraint: something that must always hold: an invariant, a limit, a number, an access rule \
(aspect names which, value gives it).\n\
- lifecycle: who or what starts, dates, changes, ends or re-runs something, and its states \
(aspect names which, value gives it).\n\
- decision: a choice the documents record (subject = the decision, value = what was chosen).\n\
- role: a kind of person who uses the product (subject = the role, as the text names it).\n\
- action: something a role does to a thing (subject = the thing acted on, aspect = the role, \
value = the action and its result; the precondition, if stated, in text).\n\
- problem: a difficulty someone has today (subject = the problem in a few words, aspect = who \
has it, value = the situation it happens in). Only what the text says, never inferred.\n\
- outcome: what someone wants to reach (subject = the outcome, aspect = who, value = how it \
would be measured, if stated).\n\
- idea: a solution or functionality the text proposes or mentions (subject = the idea, aspect = \
the problem it addresses if the text says so, value = who it is for).\n\
- benefit: an effect someone expects a solution to have (subject = the solution, aspect = for \
whom, value = the expected effect and its conditions). A claim, not a fact: extract it only \
where the text expects or hopes, and leave a part empty when the text does not state it.\n\
- scenario: a sequence of steps someone follows (subject = the scenario, aspect = who, value = \
the steps in short).\n\n\
subject is a short noun phrase as the documents name it. aspect is the slot a value fills, in \
plain words (grain, trigger, dating rule, routing, cardinality, who may read, limit), so two \
statements about the same slot of the same subject get the same aspect. Leave aspect and value \
empty when the fact is not a value of something.\n\n\
status says whether the passage is in force, for this clause, not for its whole section:\n\
- active: in force now.\n\
- proposed: a proposal or a proposed decision with no sign in the text that it was built.\n\
- deferred: future, planned, later, out of this release, a known gap, an open question.\n\
- superseded: the text says it was replaced, retired or no longer holds.\n\
- resolved: an open question the text says is closed.\n\
- evidence: what someone found or what was true before, not what the application must do: \
research notes, audits, examples, walkthroughs, the context or history of a decision, why a \
component exists.\n\
status_because quotes the words that gave a status other than active.\n\n\
quote is copied character for character from the lines line_start..line_end (without the line \
numbers), at most 300 characters, enough to show the fact. Prefer the most specific passage. \
Extract what matters for building the application; skip document structure, tooling, \
formatting and repetition. If a passage states the same fact as another, extract it again \
with its own quote: the reader compares them.";

/// The question for one piece of one document.
pub fn request(
    path: &str,
    doc_type: Option<&str>,
    chunk: &Chunk,
    of: (usize, usize),
) -> CompletionRequest {
    let kind = doc_type.map_or(String::new(), |t| format!(" (a {t})"));
    CompletionRequest {
        system: SYSTEM.to_string(),
        prompt: format!(
            "Document `{path}`{kind}, part {} of {}, lines {}-{}:\n\n{}",
            of.0,
            of.1,
            chunk.first_line,
            chunk.last_line(),
            chunk.numbered()
        ),
        max_tokens: MAX_TOKENS,
    }
}

#[derive(Deserialize)]
struct Answer {
    #[serde(default)]
    facts: Vec<RawFact>,
}

#[derive(Deserialize)]
struct RawFact {
    #[serde(default)]
    kind: String,
    #[serde(default)]
    subject: String,
    #[serde(default)]
    aspect: Option<String>,
    #[serde(default)]
    value: Option<serde_json::Value>,
    #[serde(default)]
    text: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    status_because: Option<String>,
    #[serde(default)]
    line_start: Option<usize>,
    #[serde(default)]
    line_end: Option<usize>,
    #[serde(default)]
    quote: String,
    #[serde(default)]
    layer: Option<String>,
}

/// Read one answer about `chunk`: every fact whose quote is in the text is
/// kept, placed on the lines it really is on; the rest are counted as
/// dropped. An answer that is not the JSON asked for is an error, so the
/// piece can be asked again.
pub fn read_answer(path: &str, chunk: &Chunk, answer: &str) -> Result<Extraction, String> {
    let start = answer.find('{').ok_or("the answer holds no JSON object")?;
    let end = answer.rfind('}').ok_or("the answer holds no JSON object")?;
    let parsed: Answer = serde_json::from_str(&answer[start..=end])
        .map_err(|e| format!("the answer is not the JSON asked for: {e}"))?;
    let mut out = Extraction::default();
    for raw in parsed.facts {
        match checked(path, chunk, raw) {
            Some(fact) => out.facts.push(fact),
            None => out.dropped += 1,
        }
    }
    Ok(out)
}

fn checked(path: &str, chunk: &Chunk, raw: RawFact) -> Option<Fact> {
    let kind = raw.kind.trim().to_ascii_lowercase();
    let status = raw.status.trim().to_ascii_lowercase();
    if !KINDS.contains(&kind.as_str()) || !STATUSES.contains(&status.as_str()) {
        return None;
    }
    let subject = raw.subject.trim().to_string();
    if subject.is_empty() || raw.quote.trim().is_empty() {
        return None;
    }
    let (line_start, line_end) = locate(chunk, &raw.quote, raw.line_start, raw.line_end)?;
    let value = match raw.value {
        Some(serde_json::Value::String(s)) => s,
        Some(serde_json::Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    };
    let layer = (kind == "entity")
        .then(|| raw.layer.unwrap_or_default().trim().to_ascii_lowercase())
        .filter(|l| LAYERS.contains(&l.as_str()));
    Some(Fact {
        kind,
        subject,
        aspect: raw.aspect.unwrap_or_default().trim().to_string(),
        value: value.trim().to_string(),
        text: raw.text.trim().to_string(),
        status,
        status_because: raw.status_because.unwrap_or_default().trim().to_string(),
        path: path.to_string(),
        line_start,
        line_end,
        quote: raw.quote.trim().to_string(),
        layer,
    })
}

/// Text compared for quoting: markup and whitespace do not count, since a
/// model copying a passage drops the asterisks and backticks around words.
fn plain(text: &str) -> String {
    text.chars()
        .filter(|c| !matches!(c, '*' | '`' | '|' | '_'))
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Where in `chunk` the quote is: the lines the model named (two lines of
/// slack either side) when it is there, otherwise the first place in the
/// piece that holds it. `None` when it is nowhere.
fn locate(
    chunk: &Chunk,
    quote: &str,
    start: Option<usize>,
    end: Option<usize>,
) -> Option<(usize, usize)> {
    let needle = plain(quote);
    if needle.len() < 8 {
        return None;
    }
    let first = chunk.first_line;
    let last = chunk.last_line();
    let holds = |from: usize, to: usize| -> bool {
        let from = from.clamp(first, last);
        let to = to.clamp(from, last);
        plain(&chunk.lines[from - first..=to - first].join("\n")).contains(&needle)
    };
    if let (Some(s), Some(e)) = (start, end)
        && s <= e
        && holds(s.saturating_sub(2), e + 2)
    {
        return Some(narrow(
            chunk,
            &needle,
            s.saturating_sub(2).max(first),
            (e + 2).min(last),
        ));
    }
    if holds(first, last) {
        return Some(narrow(chunk, &needle, first, last));
    }
    None
}

/// The smallest run of lines inside `from..=to` that still holds `needle`.
fn narrow(chunk: &Chunk, needle: &str, mut from: usize, mut to: usize) -> (usize, usize) {
    let first = chunk.first_line;
    let holds =
        |a: usize, b: usize| plain(&chunk.lines[a - first..=b - first].join("\n")).contains(needle);
    while from < to && holds(from + 1, to) {
        from += 1;
    }
    while to > from && holds(from, to - 1) {
        to -= 1;
    }
    (from, to)
}

#[cfg(test)]
#[path = "extract_tests.rs"]
mod tests;
