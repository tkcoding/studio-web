//! The reference index of a project's documents, and the rules that need no
//! model: a reference to something the project does not have, and a bare ADR
//! number two ADR sets of the project both have.
//!
//! Everything here reads the text as written (`docs/project-domain-model.md`,
//! "Read as written"): no front matter, template or naming scheme is required,
//! and nothing names a project. A convention is used only where the project
//! itself shows it — an identifier family is checked only when the project
//! defines identifiers of that family, and ADR numbers only when it has ADRs.

use std::collections::{BTreeMap, BTreeSet};

use super::extract::Fact;
use super::finding::{Finding, Side};
use super::rules::Candidate;

/// One document of the project, with its text.
#[derive(Clone, Debug)]
pub struct SourceDoc<'a> {
    /// Repo-relative path, `/`-separated.
    pub path: &'a str,
    pub text: &'a str,
    /// The document type the classifier or a person gave it, when known.
    pub doc_type: Option<&'a str>,
}

/// One ADR of the project.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Adr {
    /// The directory it lives in: one project can number two ADR sets from 1.
    pub namespace: String,
    pub number: u32,
    pub path: String,
    pub title: Option<String>,
    pub status: Option<String>,
}

/// What the project's documents define and refer to.
#[derive(Debug, Default)]
pub struct ReferenceIndex {
    pub adrs: Vec<Adr>,
    /// Identifier → where it is defined.
    pub defined_ids: BTreeMap<String, Vec<Side>>,
}

impl ReferenceIndex {
    /// The ADR namespaces that have `number`.
    fn adrs_numbered(&self, number: u32) -> Vec<&Adr> {
        self.adrs.iter().filter(|a| a.number == number).collect()
    }
}

/// The identifiers the documents define with a label (`**ID**: \`x\``), and
/// where: the requirements, components and decisions work can name. Anchors
/// are left out: `how-it-works` is a heading, and it turns up in any URL.
pub fn labelled_ids(docs: &[SourceDoc<'_>]) -> BTreeMap<String, Vec<Side>> {
    let mut out: BTreeMap<String, Vec<Side>> = BTreeMap::new();
    for doc in docs {
        for line in prose_lines(doc.text) {
            if let Some(id) = defined_id(line.text) {
                out.entry(id)
                    .or_default()
                    .push(Side::at(doc.path, line.number, line.text));
            }
        }
    }
    out
}

/// Build the index and run the reference rules.
///
/// `tree` is every path the project's repositories hold (documents or not),
/// for resolving links to files that are not documents.
pub fn reference_findings(
    docs: &[SourceDoc<'_>],
    tree: &BTreeSet<String>,
) -> (ReferenceIndex, Vec<Finding>) {
    let index = build_index(docs);
    let anchors: BTreeMap<&str, BTreeSet<String>> =
        docs.iter().map(|d| (d.path, anchors_of(d.text))).collect();
    let families = id_families(&index);
    let mut findings = Vec::new();
    for doc in docs {
        for line in prose_lines(doc.text) {
            // "Formerly `x`", "renamed from ADR-0003": a name a thing used to
            // have is history, not a reference to resolve.
            if mentions_a_former_name(line.text) {
                continue;
            }
            check_links(doc, &line, tree, &anchors, &mut findings);
            check_adr_citations(doc, &line, &index, &mut findings);
            check_ids(doc, &line, &index, &families, &mut findings);
        }
    }
    (index, grouped(findings))
}

fn mentions_a_former_name(text: &str) -> bool {
    let lower = text.to_lowercase();
    [
        "formerly",
        "renamed",
        "previously",
        "was called",
        "used to be",
    ]
    .iter()
    .any(|w| lower.contains(w))
}

/// Index the ADRs and the identifiers the documents define.
pub fn build_index(docs: &[SourceDoc<'_>]) -> ReferenceIndex {
    let mut index = ReferenceIndex::default();
    for doc in docs {
        if let Some(adr) = adr_of(doc) {
            index.adrs.push(adr);
        }
        for line in prose_lines(doc.text) {
            if let Some(id) = defined_id(line.text) {
                index.defined_ids.entry(id).or_default().push(Side::at(
                    doc.path,
                    line.number,
                    line.text,
                ));
            }
        }
        for line in code_or_prose_lines(doc.text) {
            for id in anchor_ids(line.text) {
                index.defined_ids.entry(id).or_default().push(Side::at(
                    doc.path,
                    line.number,
                    line.text,
                ));
            }
        }
    }
    index
        .adrs
        .sort_by(|a, b| (&a.namespace, a.number).cmp(&(&b.namespace, b.number)));
    index
}

// ---------------------------------------------------------------- ADRs ----

/// The ADR a document is, when its file name is numbered and it lives in a
/// directory called `adr` (any case, any depth) or the classifier typed it so.
fn adr_of(doc: &SourceDoc<'_>) -> Option<Adr> {
    let (dir, file) = doc.path.rsplit_once('/').unwrap_or(("", doc.path));
    let in_adr_dir = dir
        .split('/')
        .any(|seg| seg.eq_ignore_ascii_case("adr") || seg.eq_ignore_ascii_case("adrs"));
    let typed = doc.doc_type.is_some_and(|t| t.eq_ignore_ascii_case("adr"));
    if !(in_adr_dir || typed) {
        return None;
    }
    let stem = file
        .strip_prefix("ADR-")
        .or_else(|| file.strip_prefix("adr-"))
        .unwrap_or(file);
    let digits: String = stem.chars().take_while(char::is_ascii_digit).collect();
    if digits.is_empty() || digits.len() > 5 {
        return None;
    }
    let number = digits.parse().ok()?;
    Some(Adr {
        namespace: dir.to_string(),
        number,
        path: doc.path.to_string(),
        title: doc
            .text
            .lines()
            .find_map(|l| l.strip_prefix("# ").map(|t| t.trim().to_string())),
        status: adr_status(doc.text),
    })
}

/// The status an ADR states, in any of the forms seen: front matter
/// `status:`, a `Status:` line, `**Status**: x` or `- **Status:** x`.
pub fn adr_status(text: &str) -> Option<String> {
    for line in text.lines().take(40) {
        let plain: String = line
            .chars()
            .filter(|c| !matches!(c, '*' | '_' | '`'))
            .collect();
        let plain = plain.trim_start_matches(['-', ' ', '>', '|']).trim();
        let Some((key, value)) = plain.split_once(':') else {
            continue;
        };
        if key.trim().eq_ignore_ascii_case("status") {
            let value = value.trim().trim_end_matches('|').trim();
            let word: String = value
                .split(|c: char| !c.is_alphanumeric() && c != '-')
                .find(|w| !w.is_empty())?
                .to_ascii_lowercase();
            return Some(word);
        }
    }
    None
}

/// Bare ADR citations: `ADR-0003`, `ADR 3`, `ADR-003`. A citation inside a
/// link is resolved by the link, not here.
fn check_adr_citations(
    doc: &SourceDoc<'_>,
    line: &Line<'_>,
    index: &ReferenceIndex,
    out: &mut Vec<Finding>,
) {
    if index.adrs.is_empty() {
        return;
    }
    let text = without_links(line.text);
    for (number, token) in adr_numbers(&text) {
        let have = index.adrs_numbered(number);
        if have.is_empty() {
            out.push(
                Finding::new(
                    "reference.dangling",
                    "high",
                    format!("{token} is cited, but the project has no ADR numbered {number}."),
                    vec![Side::at(doc.path, line.number, line.text)],
                )
                .with_target(token.clone())
                .with_fix_decide(&[
                    &format!("link the record {token} means"),
                    &format!("remove the citation of {token}"),
                ]),
            );
            continue;
        }
        if have.len() < 2 {
            continue;
        }
        // The nearest set wins: the one sharing the longest leading path with
        // the citing document. A tie is a citation a reader cannot resolve.
        let mut by_closeness: Vec<(usize, &Adr)> = have
            .iter()
            .map(|a| (common_dirs(doc.path, &a.namespace), *a))
            .collect();
        by_closeness.sort_by_key(|(closeness, _)| std::cmp::Reverse(*closeness));
        if by_closeness[0].0 > by_closeness[1].0 {
            continue;
        }
        let mut sides = vec![Side::at(doc.path, line.number, line.text)];
        let names: Vec<String> = by_closeness
            .iter()
            .filter(|(c, _)| *c == by_closeness[0].0)
            .map(|(_, a)| {
                sides.push(Side::file(&a.path, a.title.as_deref()));
                a.path.clone()
            })
            .collect();
        out.push(
            Finding::new(
                "reference.ambiguous",
                "medium",
                format!(
                    "{token} is cited without a link, and the project has {} records with that number: {}.",
                    names.len(),
                    names.join(", ")
                ),
                sides,
            )
            .with_fix_decide(&names.iter().map(|n| format!("link {n}")).collect::<Vec<_>>().iter().map(String::as_str).collect::<Vec<_>>()),
        );
    }
}

/// `(number, as written)` for every `ADR-nnnn` / `ADR nnnn` in `text`.
pub(super) fn adr_numbers(text: &str) -> Vec<(u32, String)> {
    let mut out = Vec::new();
    let bytes = text.as_bytes();
    let mut i = 0;
    while let Some(at) = text[i..].find("ADR").map(|p| p + i) {
        i = at + 3;
        // `ARCH-ADR-010` is a checklist item's id, not a citation: the
        // number is an ADR's only when `ADR` starts a word of its own.
        let word_start = at == 0
            || !(bytes[at - 1].is_ascii_alphanumeric() || matches!(bytes[at - 1], b'-' | b'_'));
        let sep = bytes.get(at + 3).copied();
        if !word_start || !matches!(sep, Some(b'-' | b' ')) {
            continue;
        }
        let digits: String = text[at + 4..]
            .chars()
            .take_while(char::is_ascii_digit)
            .collect();
        let end = at + 4 + digits.len();
        let word_end = bytes.get(end).is_none_or(|b| !b.is_ascii_alphanumeric());
        if digits.is_empty() || digits.len() > 5 || !word_end {
            continue;
        }
        if let Ok(n) = digits.parse() {
            out.push((n, text[at..end].to_string()));
        }
    }
    out
}

fn common_dirs(path: &str, namespace: &str) -> usize {
    let dirs: Vec<&str> = path
        .rsplit_once('/')
        .map_or(vec![], |(d, _)| d.split('/').collect());
    dirs.iter()
        .zip(namespace.split('/'))
        .take_while(|(a, b)| *a == b)
        .count()
}

// ------------------------------------------------------ misattribution ----

/// Most citations one build asks the judge about: each is a model call.
pub const CITATION_CAP: usize = 50;

/// Citations of an ADR whose own words share nothing with the record's title:
/// the candidates for `reference.misattributed`, which the judge settles by
/// reading the record's decision.
///
/// The filter is what keeps this to calls worth making. A citation that says
/// nothing beyond the number ("see ADR-0003") states no purpose to be wrong
/// about; one whose words meet the title's is very likely right. One
/// candidate per citing document and record, and never a record citing
/// itself.
pub fn misattribution_candidates(docs: &[SourceDoc<'_>], cap: usize) -> Vec<Candidate> {
    let index = build_index(docs);
    if index.adrs.is_empty() {
        return Vec::new();
    }
    let texts: BTreeMap<&str, &str> = docs.iter().map(|d| (d.path, d.text)).collect();
    let mut seen: BTreeSet<(&str, &str)> = BTreeSet::new();
    let mut out = Vec::new();
    for doc in docs {
        for line in prose_lines(doc.text) {
            // A heading names, it does not cite for a purpose.
            if mentions_a_former_name(line.text) || line.text.trim_start().starts_with('#') {
                continue;
            }
            // A line citing two records cannot say which of its words are
            // about which, so it states no purpose either can be wrong about.
            let cited = cited_adrs(doc.path, line.text, &index);
            if cited.len() != 1 {
                continue;
            }
            for adr in cited {
                if adr.path == doc.path || !seen.insert((doc.path, adr.path.as_str())) {
                    continue;
                }
                let Some(title) = adr.title.as_deref() else {
                    continue;
                };
                let said = content_words(&link_labels(line.text));
                let titled = content_words(title);
                if said.len() < 3 || titled.is_empty() || !said.is_disjoint(&titled) {
                    continue;
                }
                let Some(record) = texts.get(adr.path.as_str()) else {
                    continue;
                };
                out.push(misattribution(doc.path, &line, adr, record));
                if out.len() >= cap {
                    return out;
                }
            }
        }
    }
    out
}

/// The ADRs one line cites: a bare number resolved to the nearest record set
/// (an ambiguous one is `reference.ambiguous`'s, not this rule's), and a link
/// to a record's file.
fn cited_adrs<'i>(path: &str, text: &str, index: &'i ReferenceIndex) -> Vec<&'i Adr> {
    let mut out: Vec<&Adr> = Vec::new();
    for (number, _) in adr_numbers(&without_links(text)) {
        let mut have: Vec<(usize, &Adr)> = index
            .adrs_numbered(number)
            .into_iter()
            .map(|a| (common_dirs(path, &a.namespace), a))
            .collect();
        have.sort_by_key(|(closeness, _)| std::cmp::Reverse(*closeness));
        match have.as_slice() {
            [(_, only)] => out.push(*only),
            [(a, first), (b, _), ..] if a > b => out.push(*first),
            _ => {}
        }
    }
    for target in link_targets(text) {
        let file = target.split_once('#').map_or(target.as_str(), |(f, _)| f);
        if file.is_empty() || file.contains("://") {
            continue;
        }
        if let Some(to) = resolve(path, file)
            && let Some(adr) = index.adrs.iter().find(|a| a.path == to)
        {
            out.push(adr);
        }
    }
    let mut seen = BTreeSet::new();
    out.retain(|a| seen.insert(a.path.as_str()));
    out
}

/// A line's words that can say what something is about: lowercased, cut to
/// their first five letters so `authorize` meets `authorization`, without
/// short words, numbers, the word "ADR" and the commonest filler.
fn content_words(text: &str) -> BTreeSet<String> {
    const FILLER: [&str; 24] = [
        "this", "that", "with", "from", "into", "which", "where", "when", "will", "must", "should",
        "shall", "have", "been", "being", "were", "they", "their", "there", "also", "only", "each",
        "every", "about",
    ];
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.chars().count() >= 4 && !w.chars().all(|c| c.is_ascii_digit()))
        .filter(|w| !w.starts_with("adr") && !FILLER.contains(w))
        .map(|w| w.chars().take(5).collect())
        .collect()
}

/// The candidate for one citation: the citing line, and the record at its
/// title.
fn misattribution(path: &str, line: &Line<'_>, adr: &Adr, record: &str) -> Candidate {
    let (title_line, title_text) = record
        .lines()
        .enumerate()
        .find(|(_, l)| l.starts_with("# "))
        .map_or((1, adr.title.clone().unwrap_or_default()), |(i, l)| {
            (i + 1, l.trim().to_string())
        });
    let citing = Fact {
        kind: "reference".into(),
        subject: adr.title.clone().unwrap_or_default(),
        aspect: "what it is cited for".into(),
        value: line.text.trim().to_string(),
        text: line.text.trim().to_string(),
        status: "active".into(),
        status_because: String::new(),
        path: path.to_string(),
        line_start: line.number,
        line_end: line.number,
        quote: line.text.trim().to_string(),
        layer: None,
    };
    let cited = Fact {
        kind: "decision".into(),
        subject: adr.title.clone().unwrap_or_default(),
        aspect: "what it decides".into(),
        value: adr.title.clone().unwrap_or_default(),
        text: title_text.clone(),
        status: adr.status.clone().unwrap_or_else(|| "active".into()),
        status_because: String::new(),
        path: adr.path.clone(),
        line_start: title_line,
        line_end: title_line,
        quote: title_text,
        layer: None,
    };
    Candidate {
        rule: "reference.misattributed",
        subject: adr.title.clone().unwrap_or_default(),
        aspect: "what it is cited for".into(),
        sides: [citing, cited],
    }
}

// --------------------------------------------------------------- links ----

/// Relative links to a file the repositories do not hold, or to a heading the
/// linked document does not have.
fn check_links(
    doc: &SourceDoc<'_>,
    line: &Line<'_>,
    tree: &BTreeSet<String>,
    anchors: &BTreeMap<&str, BTreeSet<String>>,
    out: &mut Vec<Finding>,
) {
    for target in link_targets(line.text) {
        if target.contains("://") || target.starts_with("mailto:") || target.starts_with('<') {
            continue;
        }
        let (file, anchor) = target.split_once('#').unwrap_or((target.as_str(), ""));
        let file = file.split('?').next().unwrap_or_default();
        let resolved = if file.is_empty() {
            Some(doc.path.to_string())
        } else {
            resolve(doc.path, file)
        };
        let Some(resolved) = resolved else {
            continue;
        };
        let exists = tree.contains(&resolved)
            || anchors.contains_key(resolved.as_str())
            || tree.iter().any(|p| p.starts_with(&format!("{resolved}/")));
        if !exists {
            out.push(
                Finding::new(
                    "reference.dangling",
                    "high",
                    format!(
                        "The link to `{file}` leads nowhere: the repository has no `{resolved}`."
                    ),
                    vec![Side::at(doc.path, line.number, line.text)],
                )
                .with_target(resolved.clone())
                .with_fix_decide(&["point the link at the file it means", "remove the link"]),
            );
            continue;
        }
        if anchor.is_empty() {
            continue;
        }
        if let Some(known) = anchors.get(resolved.as_str())
            && !known.contains(&compact(&percent_decode(anchor)))
        {
            out.push(
                Finding::new(
                    "reference.dangling",
                    "medium",
                    format!("`{resolved}` has no section `#{anchor}`."),
                    vec![Side::at(doc.path, line.number, line.text)],
                )
                .with_target(format!("{resolved}#{anchor}"))
                .with_fix_decide(&["point the link at the section it means", "drop the anchor"]),
            );
        }
    }
}

/// Every `](target)` on a line, the target as written.
pub(super) fn link_targets(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(at) = rest.find("](") {
        let after = &rest[at + 2..];
        let Some(end) = after.find(')') else {
            break;
        };
        let target = after[..end].trim();
        // `[a](b "title")`
        let target = target.split_once(' ').map_or(target, |(t, _)| t);
        if !target.is_empty() {
            out.push(target.to_string());
        }
        rest = &after[end..];
    }
    out
}

/// `text` with every `[label](target)` replaced by its label's absence, so a
/// citation that is a link is not read twice.
fn without_links(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('[') {
        let Some(close) = rest[open..].find("](").map(|p| p + open) else {
            break;
        };
        let Some(end) = rest[close..].find(')').map(|p| p + close) else {
            break;
        };
        out.push_str(&rest[..open]);
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    out
}

/// `text` with every `[label](target)` replaced by its label.
fn link_labels(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('[') {
        let Some(close) = rest[open..].find("](").map(|p| p + open) else {
            break;
        };
        let Some(end) = rest[close..].find(')').map(|p| p + close) else {
            break;
        };
        out.push_str(&rest[..open]);
        out.push_str(&rest[open + 1..close]);
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    out
}

/// `target` relative to the document at `from`; a leading `/` is the root.
fn resolve(from: &str, target: &str) -> Option<String> {
    let mut parts: Vec<&str> = if target.starts_with('/') {
        Vec::new()
    } else {
        from.rsplit_once('/')
            .map_or(vec![], |(d, _)| d.split('/').collect())
    };
    for seg in target.trim_start_matches('/').split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                // Above the repository root is outside what can be checked.
                parts.pop()?;
            }
            s => parts.push(s),
        }
    }
    let joined = parts.join("/");
    Some(percent_decode(&joined))
}

fn percent_decode(s: &str) -> String {
    if !s.contains('%') {
        return s.to_string();
    }
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && let Some(h) = s.get(i + 1..i + 3)
            && let Ok(b) = u8::from_str_radix(h, 16)
        {
            out.push(b);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Every anchor a document offers — its headings and explicit `id`s — in
/// [`compact`] form.
fn anchors_of(text: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let mut seen: BTreeMap<String, usize> = BTreeMap::new();
    for line in prose_lines(text) {
        let t = line.text.trim_start();
        if t.starts_with('#') {
            // A heading that is a link is slugged by its label.
            let base = compact(&link_labels(t.trim_start_matches('#')));
            let n = seen.entry(base.clone()).or_insert(0);
            out.insert(if *n == 0 {
                base.clone()
            } else {
                format!("{base}{n}")
            });
            *n += 1;
        }
    }
    for line in code_or_prose_lines(text) {
        out.extend(anchor_ids(line.text).iter().map(|a| compact(a)));
    }
    out
}

/// An anchor or heading with everything but letters and digits dropped, lower
/// case. Renderers slug headings differently — one keeps `_` and doubles `-`
/// around a dash, another drops both — and a link written for one is not
/// broken on the page it was written for, so a section counts as there when
/// the two agree in this form.
fn compact(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect()
}

/// `<a id="x">`, `<a name="x">`, `{#x}`.
fn anchor_ids(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for key in ["id=\"", "name=\""] {
        let mut rest = text;
        while let Some(at) = rest.find(key) {
            let before_ok = rest[..at].ends_with(' ');
            let after = &rest[at + key.len()..];
            let Some(end) = after.find('"') else { break };
            if before_ok && rest[..at].contains('<') {
                out.push(after[..end].to_string());
            }
            rest = &after[end..];
        }
    }
    let mut rest = text;
    while let Some(at) = rest.find("{#") {
        let after = &rest[at + 2..];
        let Some(end) = after.find('}') else { break };
        out.push(after[..end].to_string());
        rest = &after[end..];
    }
    out
}

// ----------------------------------------------------------------- ids ----

/// The labels that define the identifier after them, as the document kit's
/// templates write them: `**ID**:` for an actor, requirement, component or
/// decision, `**Contract**:` (singular) for an external contract. A plural
/// label (`**Actors**:`, `**Contracts**:`) lists references.
const DEFINING_LABELS: [&str; 2] = ["ID:", "Contract:"];

/// An identifier this line defines: `**ID**: \`x\`` in any of its spellings.
pub(super) fn defined_id(text: &str) -> Option<String> {
    let plain: String = text.chars().filter(|c| *c != '*').collect();
    let (at, label) = DEFINING_LABELS
        .iter()
        .find_map(|label| plain.find(label).map(|at| (at, label.len())))?;
    if at > 0 && plain.as_bytes()[at - 1].is_ascii_alphanumeric() {
        return None;
    }
    let after = &plain[at + label..];
    let open = after.find('`')?;
    let close = after[open + 1..].find('`')? + open + 1;
    let id = after[open + 1..close].trim();
    is_id_shaped(id).then(|| id.to_string())
}

/// `word-word-word…`: lower case, at least three segments. Plain words with
/// hyphens are rarely back-ticked; identifiers almost always are.
pub(super) fn is_id_shaped(s: &str) -> bool {
    let segments: Vec<&str> = s.split('-').collect();
    segments.len() >= 3
        && segments.iter().all(|seg| {
            !seg.is_empty()
                && seg
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
        })
}

/// The family of an identifier: its first two segments (`cpt-studio`).
fn family(id: &str) -> Option<String> {
    let mut it = id.split('-');
    Some(format!("{}-{}", it.next()?, it.next()?))
}

/// The families the project actually uses for definitions, with enough
/// members to be a convention rather than a coincidence.
fn id_families(index: &ReferenceIndex) -> BTreeSet<String> {
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for id in index.defined_ids.keys() {
        if let Some(f) = family(id) {
            *counts.entry(f).or_default() += 1;
        }
    }
    counts
        .into_iter()
        .filter(|(_, n)| *n >= 5)
        .map(|(f, _)| f)
        .collect()
}

/// A back-ticked identifier of a family the project defines, defined nowhere.
fn check_ids(
    doc: &SourceDoc<'_>,
    line: &Line<'_>,
    index: &ReferenceIndex,
    families: &BTreeSet<String>,
    out: &mut Vec<Finding>,
) {
    if families.is_empty() || defined_id(line.text).is_some() {
        return;
    }
    for id in backticked(line.text) {
        let id = id.trim_end_matches(['.', ',', ':', ';']);
        if !is_id_shaped(id) || index.defined_ids.contains_key(id) {
            continue;
        }
        if !family(id).is_some_and(|f| families.contains(&f)) {
            continue;
        }
        // A family prefix written as a pattern (`cpt-studio-fr-*`) is not a reference.
        if id.ends_with('-') {
            continue;
        }
        out.push(
            Finding::new(
                "reference.dangling",
                "high",
                format!("`{id}` is referenced, but no document of the project defines it."),
                vec![Side::at(doc.path, line.number, line.text)],
            )
            .with_target(id.to_string())
            .with_fix_decide(&[
                &format!("define `{id}` where it belongs"),
                "reference the identifier that is defined",
            ]),
        );
    }
}

fn backticked(text: &str) -> Vec<&str> {
    text.split('`').skip(1).step_by(2).collect()
}

// --------------------------------------------------------------- lines ----

/// One line of a document, numbered from 1.
pub struct Line<'a> {
    pub number: usize,
    pub text: &'a str,
}

/// The lines outside fenced code, HTML comments and front matter.
pub fn prose_lines(text: &str) -> Vec<Line<'_>> {
    let mut out = Vec::new();
    let mut in_fence: Option<&str> = None;
    let mut in_comment = false;
    let mut in_front = false;
    for (i, line) in text.lines().enumerate() {
        let t = line.trim_start();
        if i == 0 && t == "---" {
            in_front = true;
            continue;
        }
        if in_front {
            if t == "---" || t == "..." {
                in_front = false;
            }
            continue;
        }
        if let Some(fence) = in_fence {
            if t.starts_with(fence) {
                in_fence = None;
            }
            continue;
        }
        if t.starts_with("```") || t.starts_with("~~~") {
            in_fence = Some(&t[..3]);
            continue;
        }
        if in_comment {
            if line.contains("-->") {
                in_comment = false;
            }
            continue;
        }
        if t.starts_with("<!--") {
            in_comment = !line.contains("-->");
            continue;
        }
        out.push(Line {
            number: i + 1,
            text: line,
        });
    }
    out
}

/// Every line, for anchors an HTML block may declare.
fn code_or_prose_lines(text: &str) -> Vec<Line<'_>> {
    text.lines()
        .enumerate()
        .map(|(i, text)| Line {
            number: i + 1,
            text,
        })
        .collect()
}

/// One finding per missing thing: an identifier cited from ten places is one
/// problem with ten places, fixed by one decision. The message names the
/// thing, so findings with the same rule and message are merged, their sides
/// in order of first appearance, and the fingerprint is the thing alone —
/// citing it from one more place is the same finding.
fn grouped(findings: Vec<Finding>) -> Vec<Finding> {
    let mut out: Vec<Finding> = Vec::new();
    let mut at: BTreeMap<(String, String), usize> = BTreeMap::new();
    for finding in findings {
        let key = (finding.rule.clone(), finding.message.clone());
        if let Some(&i) = at.get(&key) {
            for side in finding.sides {
                if !out[i].sides.contains(&side) {
                    out[i].sides.push(side);
                }
            }
            continue;
        }
        at.insert(key, out.len());
        out.push(finding.keyed_by_message());
    }
    out
}

#[cfg(test)]
#[path = "index_tests.rs"]
mod tests;
