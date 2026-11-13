//! What would make a project's documentation better, each with the change
//! ready to save: the "improve the docs" half of the Issues table, beside the
//! queue of what to decide (`resolve.rs`; `docs/project-domain-model.md`,
//! "To resolve").
//!
//! A finding says the documents disagree; these say they are thin where a
//! reader needs them:
//!
//! - **No definition** (`nodefinition`): a thing of the domain the documents
//!   say plenty about, but never what it is. The sentence is put together
//!   from what they say.
//! - **Two names for one thing** (`twonames`): the glossary's similar pairs.
//! - **One-sided relation** (`onesided`): A says it relates to B, and B never
//!   mentions A.
//! - **Only in an ADR or a feature** (`onlyadr`): a thing of the domain no
//!   requirement or domain document describes.
//! - **No relation** (`norelation`): a thing whose name says what it is about
//!   (connection health) while no document says how the two relate. The
//!   sentence goes into the document that describes it, after that passage.
//!
//! Moved from the portal (`doc-quality.ts`, with the entity folding of
//! `spec-model.ts` `entitiesOf`, the layers and drafts of `domain-layers.ts`
//! and `similarPairs` of `glossary-view.ts`) so an agent reads the same rows
//! a person does. The rules, the sentences and the order are the browser's;
//! names are compared as the browser folded them ([`subject_key`]). Pure: the
//! route reads the facts, the reviews, the glossary and the documents'
//! revisions, and this computes the rows.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::LazyLock;

use regex::Regex;

use super::extract::Fact;
use super::fact_key::subject_key;

/// Kinds that describe the need and its claims, not a thing the application
/// keeps: they stay off the model's entities.
const NEED_KINDS: [&str; 5] = ["problem", "outcome", "idea", "benefit", "scenario"];

/// A glossary entry as the rows need it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Term {
    pub key: String,
    pub name: String,
    /// The keys of the names merged into it.
    pub aliases: Vec<String>,
    pub facts: usize,
    /// Entries a member said are different things from this one.
    pub distinct_from: Vec<String>,
}

/// One thing the documents speak of, with every fact about it.
#[derive(Clone, Debug)]
pub struct Entity {
    pub key: String,
    /// The glossary's name, else the spelling the documents use most.
    pub name: String,
    /// Its own key and its aliases' keys.
    pub keys: Vec<String>,
    pub facts: Vec<Fact>,
}

/// Where an entity sits: what the product is about, what serves it, where
/// that runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Layer {
    Domain,
    System,
    Deployment,
}

impl Layer {
    fn parse(raw: &str) -> Option<Self> {
        match raw {
            "domain" => Some(Self::Domain),
            "system" => Some(Self::System),
            "deployment" => Some(Self::Deployment),
            _ => None,
        }
    }
}

/// Names compared as the browser's `localeCompare` does for plain names:
/// case does not count first.
fn name_order(a: &str, b: &str) -> std::cmp::Ordering {
    a.to_lowercase().cmp(&b.to_lowercase()).then(a.cmp(b))
}

/// Length in UTF-16 units, as the browser counted it.
fn js_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// The model's subjects, each with every fact about it, the most described
/// first. A subject that is only ever a decision is left out, and so are the
/// need's kinds. An alias's facts count as its entry's.
pub fn entities_of(facts: &[Fact], terms: &[Term]) -> Vec<Entity> {
    let mut index: HashMap<&str, &Term> = HashMap::new();
    for t in terms {
        index.insert(t.key.as_str(), t);
        for a in &t.aliases {
            index.insert(a.as_str(), t);
        }
    }
    // In the order the keys first appear, as the browser's Map kept them.
    let mut order: Vec<String> = Vec::new();
    let mut groups: HashMap<String, (BTreeMap<String, usize>, Vec<Fact>)> = HashMap::new();
    for fact in facts {
        if NEED_KINDS.contains(&fact.kind.as_str()) {
            continue;
        }
        let own = subject_key(&fact.subject);
        if own.is_empty() {
            continue;
        }
        let key = index.get(own.as_str()).map_or(own, |t| t.key.clone());
        let group = groups.entry(key.clone()).or_insert_with(|| {
            order.push(key.clone());
            (BTreeMap::new(), Vec::new())
        });
        *group.0.entry(fact.subject.clone()).or_default() += 1;
        group.1.push(fact.clone());
    }
    let mut out = Vec::new();
    for key in order {
        let Some((spellings, facts)) = groups.remove(&key) else {
            continue;
        };
        if facts.iter().all(|f| f.kind == "decision") {
            continue;
        }
        let entry = index.get(key.as_str());
        let name = match entry {
            Some(t) => t.name.clone(),
            None => {
                let mut all: Vec<(String, usize)> = spellings.into_iter().collect();
                all.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| name_order(&a.0, &b.0)));
                all.into_iter().next().map(|(s, _)| s).unwrap_or_default()
            }
        };
        let mut keys = vec![key.clone()];
        if let Some(t) = entry {
            keys.extend(t.aliases.iter().cloned());
        }
        out.push(Entity {
            key,
            name,
            keys,
            facts,
        });
    }
    out.sort_by(|a, b| {
        b.facts
            .len()
            .cmp(&a.facts.len())
            .then_with(|| name_order(&a.name, &b.name))
    });
    out
}

static TEMPLATE_PATH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"/templates/|/examples/|/template\.md$|kits/sdlc/artifacts").expect("constant")
});
static DEPLOY_PATH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(deploy/|keycloak/|\.githooks/|docs/deploy)|/k8s/").expect("constant")
});
static SYSTEM_NAME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(screen|tile|wizard|table|row|page|dialog|panel|button|view|card|tabs?|header|engine|backend|frontend|studio-[a-z-]+|[a-z]+-registry|gear|service|api|endpoint|route|mfe|microfrontend|shell|frame|event|topic|channel|schema|sdk|plugin|bridge|session|token|jwt|graph|storage|index|connector|driver|proxy|gateway|pdp|cache|queue|task|scheduler|ide|theia|portal|ui|component|module|kit|catalogue|catalog|contract|webhook|oidc|idp)\b",
    )
    .expect("constant")
});
static DEPLOY_NAME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(k8s|kubernetes|helm|cluster|namespace|pod|keycloak|postgres|pg|cnpg|docker|compose|ci|cd|pipeline|workflow|image|ingress|secret|env|deploy|deployment|rollout|replica|volume|s3|bucket|dns|tls|certificate|vault|backup|hook|runner|ghcr|realm)\b",
    )
    .expect("constant")
});
static NOT_ENTITY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^(adr[- ]?\d+|cpt-|https?:|/|`)").expect("constant"));
/// A name that is a screen, a step or an action rather than a thing the
/// product keeps: no relation is proposed for it.
static SCREEN_OR_STEP: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(overlay|screen|form|button|menu|slot|tab|step|list|listing|bar|rail|breadcrumb|click|dialog|wizard|page|panel|view|section|container|switcher|tile|table|row)\b|^(go|move|open|create|connect|new|sign|run|re-?run|add|pick|choose|select)\b|\b(creation|selection|resolution|switch|navigation|write|read|refusal|validation|bootstrap|backfill|import|sync|open|delivery|choice)$",
    )
    .expect("constant")
});
static DECISION_OR_FEATURE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^docs/(adr|features?)/").expect("constant"));
static ADR_PATH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^docs/adr/").expect("constant"));

/// A kit's templates and examples describe a document type, not this project.
pub fn is_template_path(path: &str) -> bool {
    TEMPLATE_PATH.is_match(path)
}

/// The layer most of the `entity` facts state (a tie goes to the earlier of
/// domain, system, deployment), or none when none states one.
fn stated_layer(facts: &[&Fact]) -> Option<Layer> {
    let mut count = [0usize; 3];
    for f in facts {
        if f.kind != "entity" {
            continue;
        }
        match f.layer.as_deref().and_then(Layer::parse) {
            Some(Layer::Domain) => count[0] += 1,
            Some(Layer::System) => count[1] += 1,
            Some(Layer::Deployment) => count[2] += 1,
            None => {}
        }
    }
    let layers = [Layer::Domain, Layer::System, Layer::Deployment];
    let mut best: Option<(Layer, usize)> = None;
    for (layer, n) in layers.into_iter().zip(count) {
        if n > best.map_or(0, |(_, b)| b) {
            best = Some((layer, n));
        }
    }
    best.map(|(layer, _)| layer)
}

/// Which layer an entity belongs to, or none when it is not an entity of the
/// product at all: an identifier, a word used in passing, or something only
/// a kit's template says.
pub fn layer_of(e: &Entity) -> Option<Layer> {
    if NOT_ENTITY.is_match(e.name.trim()) {
        return None;
    }
    let facts: Vec<&Fact> = e
        .facts
        .iter()
        .filter(|f| !is_template_path(&f.path))
        .collect();
    if facts.is_empty() {
        return None;
    }
    if !facts.iter().any(|f| f.kind == "entity") && facts.len() < 3 {
        return None;
    }
    if let Some(stated) = stated_layer(&facts) {
        return Some(stated);
    }
    if SYSTEM_NAME.is_match(&e.name) {
        return Some(Layer::System);
    }
    let deploy = facts
        .iter()
        .filter(|f| DEPLOY_PATH.is_match(&f.path))
        .count();
    if DEPLOY_NAME.is_match(&e.name) || deploy > facts.len() - deploy {
        return Some(Layer::Deployment);
    }
    Some(Layer::Domain)
}

/// The fields a card lists: what the entity holds, by aspect, once each.
pub fn card_fields(e: &Entity, max: usize) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for f in &e.facts {
        let a = f.aspect.trim();
        if f.kind != "attribute" || a.is_empty() {
            continue;
        }
        if !out.iter().any(|x| x == a) {
            out.push(a.to_string());
        }
        if out.len() >= max {
            break;
        }
    }
    out
}

/// One field of an entity's section.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Field {
    pub name: String,
    pub meaning: String,
}

/// One relation of an entity's section.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Relation {
    pub verb: String,
    pub target: String,
}

/// An entity's section of `docs/domain-model.md` as it would be saved
/// (`POST /project-domain-model/entities`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EntityEdit {
    pub name: String,
    pub definition: Option<String>,
    pub fields: Vec<Field>,
    pub relations: Vec<Relation>,
}

/// An entity as the editor starts it: what the model already knows, each
/// field and relation once, so a person corrects rather than retypes.
pub fn entity_draft(e: &Entity) -> EntityEdit {
    let mut fields: Vec<Field> = Vec::new();
    let mut relations: Vec<Relation> = Vec::new();
    for f in &e.facts {
        let aspect = f.aspect.trim();
        if f.kind == "attribute" && !aspect.is_empty() && !fields.iter().any(|x| x.name == aspect) {
            fields.push(Field {
                name: aspect.to_string(),
                meaning: f.value.trim().to_string(),
            });
        }
        let value = f.value.trim();
        if f.kind == "relation" && !aspect.is_empty() && !value.is_empty() {
            let known = relations
                .iter()
                .any(|x| x.verb == aspect && x.target.to_lowercase() == value.to_lowercase());
            if !known {
                relations.push(Relation {
                    verb: aspect.to_string(),
                    target: value.to_string(),
                });
            }
        }
    }
    EntityEdit {
        name: e.name.clone(),
        definition: Some(
            e.facts
                .iter()
                .find(|f| f.kind == "entity")
                .map(|f| f.text.clone())
                .unwrap_or_default(),
        ),
        fields,
        relations,
    }
}

/// The entity a relation fact points at: its value folded to an entity's
/// key, or a longer phrase that starts or ends with one ("the owning
/// workspace"). Never the entity itself.
pub fn relation_target<'a>(
    e: &Entity,
    f: &Fact,
    entities: &'a [Entity],
    by_key: &HashMap<&str, &'a Entity>,
) -> Option<&'a Entity> {
    let tk = subject_key(&f.value);
    let target = by_key.get(tk.as_str()).copied().or_else(|| {
        entities.iter().find(|o| {
            o.key != e.key
                && js_len(&o.key) > 3
                && (o.keys.contains(&tk)
                    || tk.starts_with(&format!("{} ", o.key))
                    || tk.ends_with(&format!(" {}", o.key)))
        })
    })?;
    (target.key != e.key).then_some(target)
}

fn index_of(entities: &[Entity]) -> HashMap<&str, &Entity> {
    entities.iter().map(|e| (e.key.as_str(), e)).collect()
}

/// The keys every declared relation among `entities` ties together.
fn tied_keys(entities: &[Entity]) -> BTreeSet<String> {
    let by_key = index_of(entities);
    let mut out = BTreeSet::new();
    for e in entities {
        for f in e.facts.iter().filter(|f| f.kind == "relation") {
            if let Some(target) = relation_target(e, f, entities, &by_key) {
                out.insert(e.key.clone());
                out.insert(target.key.clone());
            }
        }
    }
    out
}

/// One place a row rests on.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Side {
    pub path: String,
    pub line_start: Option<usize>,
    pub line_end: Option<usize>,
    pub quote: Option<String>,
}

fn side_of(f: &Fact) -> Side {
    Side {
        path: f.path.clone(),
        line_start: (f.line_start > 0).then_some(f.line_start),
        line_end: (f.line_end > 0).then_some(f.line_end),
        quote: (!f.quote.is_empty()).then(|| f.quote.clone()),
    }
}

/// The places a thing is described, one per document, the first three.
fn sides_of(facts: &[&Fact]) -> Vec<Side> {
    let mut out: Vec<Side> = Vec::new();
    for f in facts {
        if !out.iter().any(|s| s.path == f.path) {
            out.push(side_of(f));
        }
    }
    out.truncate(3);
    out
}

/// A thing's facts that are about this project: a kit's templates and
/// examples describe a document type.
fn own(e: &Entity) -> Vec<&Fact> {
    e.facts
        .iter()
        .filter(|f| !is_template_path(&f.path))
        .collect()
}

fn article(name: &str) -> &'static str {
    if name
        .chars()
        .next()
        .is_some_and(|c| "aeiouAEIOU".contains(c))
    {
        "An"
    } else {
        "A"
    }
}

/// "a, b and c".
fn listed(parts: &[String]) -> String {
    match parts {
        [] => String::new(),
        [one] => one.clone(),
        [head @ .., last] => format!("{} and {last}", head.join(", ")),
    }
}

fn capitalised(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// A sentence saying what an entity is, from what the documents say of it:
/// what it holds and how it relates, else the first thing asked of it. A
/// starting point a person corrects, not a definition the model vouches for.
pub fn definition_from(e: &Entity) -> String {
    let fields = card_fields(e, 3);
    let relations = entity_draft(e).relations;
    let mut parts: Vec<String> = Vec::new();
    if !fields.is_empty() {
        parts.push(format!("holds {}", listed(&fields)));
    }
    parts.extend(
        relations
            .iter()
            .take(2)
            .map(|r| format!("{} {}", r.verb, r.target)),
    );
    let a = article(&e.name);
    if !parts.is_empty() {
        return format!("{a} {} {}.", e.name, listed(&parts));
    }
    let said = e
        .facts
        .iter()
        .find(|f| !f.text.trim().is_empty() && f.kind != "decision")
        .or_else(|| e.facts.iter().find(|f| !f.text.trim().is_empty()));
    match said {
        Some(f) => format!("{a} {}: {}", e.name, f.text.trim()),
        None => format!("{a} {} is \u{2026}", e.name),
    }
}

/// The relation as the other side would say it: if a project belongs to a
/// workspace, the workspace has the project. Anything not known reads "has";
/// the verb is editable before the save.
pub fn inverse_verb(verb: &str) -> &'static str {
    match verb.trim().to_lowercase().as_str() {
        "belongs to" => "has",
        "has" | "has many" | "has one" => "belongs to",
        "is part of" | "is in" => "contains",
        "contains" | "includes" => "is part of",
        "owns" => "is owned by",
        "is owned by" => "owns",
        "references" => "is referenced by",
        "is referenced by" => "references",
        "uses" => "is used by",
        "is used by" => "uses",
        "creates" => "is created by",
        "is created by" => "creates",
        "manages" => "is managed by",
        "is managed by" => "manages",
        _ => "has",
    }
}

/// The sentence that states a relation, as a document would: "Connection
/// health belongs to **connection**."
pub fn relation_sentence(name: &str, verb: &str, target: &str) -> String {
    format!("{} {} **{target}**.", capitalised(name), verb.trim())
}

/// Whether any of `facts` names `other`, by a relation to it or by its name
/// in what a fact says.
fn mentions(
    facts: &[&Fact],
    other: &Entity,
    of: &Entity,
    all: &[Entity],
    by_key: &HashMap<&str, &Entity>,
) -> bool {
    for f in facts {
        if f.kind == "relation"
            && relation_target(of, f, all, by_key).is_some_and(|t| t.key == other.key)
        {
            return true;
        }
        let said = format!(
            " {} ",
            subject_key(&format!("{} {} {}", f.aspect, f.value, f.text))
        );
        if other.keys.iter().any(|k| said.contains(&format!(" {k} "))) {
            return true;
        }
    }
    false
}

/// The other things a name is made of, the longest first: "connection draft"
/// is about a connection and a draft. `head` when the part ends the name.
fn named_in<'a>(e: &Entity, keys: &HashMap<&str, &'a Entity>) -> Vec<(&'a Entity, bool)> {
    let words: Vec<&str> = e.key.split(' ').collect();
    let mut out: Vec<(&Entity, bool)> = Vec::new();
    for len in (1..words.len()).rev() {
        for i in 0..=words.len() - len {
            let k = words[i..i + len].join(" ");
            if let Some(other) = keys.get(k.as_str())
                && js_len(&k) > 3
                && !out.iter().any(|(o, _)| o.key == other.key)
            {
                out.push((*other, i + len == words.len()));
            }
        }
    }
    out
}

/// Where a sentence about a thing goes: after the passage that says what it
/// is, else the first that describes it, in a document read at its current
/// revision, so the line is still the line the model read.
fn passage_of<'a>(e: &'a Entity, revisions: &BTreeMap<String, String>) -> Option<&'a Fact> {
    let facts: Vec<&Fact> = own(e)
        .into_iter()
        .filter(|f| revisions.contains_key(&f.path) && f.line_end > 0)
        .collect();
    facts
        .iter()
        .find(|f| f.kind == "entity")
        .or_else(|| facts.first())
        .copied()
}

/// How two names are alike.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Alike {
    /// One is the other with an ending: `ship`, `s` or `ing`.
    Suffix(&'static str),
    /// One is the other with a level in front.
    Level(String),
}

/// Two entries that are probably one thing, and why it looks so.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SimilarPair {
    /// The busier one: the name kept.
    pub a: Term,
    pub b: Term,
    pub why: String,
    pub how: Alike,
}

/// Levels a word can be qualified by without becoming another thing.
const SCOPES: [&str; 4] = ["organization", "workspace", "project", "platform"];

/// Pairs of entries that look like one thing under two names: one is the
/// other with "-ship"/"-s"/"-ing" on it, or one is the other with its level
/// in front. Only entries the documents say something real about, the
/// busiest first; never a pair a member kept apart.
pub fn similar_pairs(entries: &[Term], max: usize) -> Vec<SimilarPair> {
    let pool: Vec<&Term> = entries
        .iter()
        .filter(|e| e.facts >= 2 && js_len(&e.key) >= 4)
        .collect();
    let by_key: HashMap<&str, &Term> = pool.iter().map(|e| (e.key.as_str(), *e)).collect();
    let apart =
        |a: &Term, b: &Term| a.distinct_from.contains(&b.key) || b.distinct_from.contains(&a.key);
    let mut out: Vec<SimilarPair> = Vec::new();
    let mut seen: BTreeSet<(String, String)> = BTreeSet::new();
    let mut add = |a: &Term, b: &Term, why: String, how: Alike| {
        let id = if a.key <= b.key {
            (a.key.clone(), b.key.clone())
        } else {
            (b.key.clone(), a.key.clone())
        };
        if a.key == b.key || seen.contains(&id) || apart(a, b) {
            return;
        }
        seen.insert(id);
        let (a, b) = if a.facts >= b.facts { (a, b) } else { (b, a) };
        out.push(SimilarPair {
            a: a.clone(),
            b: b.clone(),
            why,
            how,
        });
    };
    for e in &pool {
        for suffix in ["ship", "s", "ing"] {
            if let Some(other) = by_key.get(format!("{}{suffix}", e.key).as_str()) {
                let why = format!(
                    "\u{201c}{}\u{201d} is \u{201c}{}\u{201d} with \u{201c}-{suffix}\u{201d}",
                    other.name, e.name
                );
                add(e, other, why, Alike::Suffix(suffix));
            }
        }
        let words: Vec<&str> = e.key.split(' ').filter(|w| !w.is_empty()).collect();
        if words.len() == 2
            && SCOPES.contains(&words[0])
            && let Some(tail) = by_key.get(words[1])
        {
            let why = format!(
                "\u{201c}{}\u{201d} names \u{201c}{}\u{201d} with its level",
                e.name, tail.name
            );
            add(tail, e, why, Alike::Level(words[0].to_string()));
        }
    }
    out.sort_by_key(|p| std::cmp::Reverse(p.a.facts + p.b.facts));
    out.truncate(max);
    out
}

/// What kind of improvement a row is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    OnlyAdr,
    NoDefinition,
    OneSided,
    NoRelation,
    TwoNames,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::OnlyAdr => "onlyadr",
            Kind::NoDefinition => "nodefinition",
            Kind::OneSided => "onesided",
            Kind::NoRelation => "norelation",
            Kind::TwoNames => "twonames",
        }
    }

    /// What the Issues table calls it.
    pub fn label(self) -> &'static str {
        match self {
            Kind::OnlyAdr => "Only in an ADR or a feature",
            Kind::NoDefinition => "No definition",
            Kind::OneSided => "One-sided relation",
            Kind::NoRelation => "No relation",
            Kind::TwoNames => "Two names for one thing",
        }
    }
}

/// For a "no relation" row: the sentence for the document that describes
/// the thing, after the passage at `line`, and the relation it states.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Sentence {
    pub path: String,
    pub revision: String,
    pub line: usize,
    pub sentence: String,
    pub why: String,
    pub name: String,
    pub verb: String,
    pub target: String,
}

/// One way to make the documentation better.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Item {
    /// `oa:`, `nd:`, `os:`, `nr:` or `tn:` and what it is about: what an
    /// opened issue is recorded under (`iss:<key>`).
    pub key: String,
    pub kind: Kind,
    pub title: String,
    /// What is thin, and what saving does, in a sentence.
    pub hint: String,
    pub sides: Vec<Side>,
    /// The entity's section as it would be saved; absent for two names and
    /// no relation.
    pub edit: Option<EntityEdit>,
    /// For two names: the pair, the second to be read as the first.
    pub pair: Option<SimilarPair>,
    pub sentence: Option<Sentence>,
}

impl Item {
    /// The key of the entity whose section the row's save writes: a person
    /// who just saved it sees the row go before a build reads the document.
    pub fn entity(&self) -> Option<String> {
        self.edit.as_ref().map(|e| subject_key(&e.name))
    }
}

/// Everything that would make the documentation better, worst gap first:
/// things only an ADR or a feature describes, things with no definition,
/// one-sided relations, things related to nothing, then words that may name
/// one thing. `revisions` is each read document's revision, by path: a
/// sentence is proposed only where the lines the model read are the lines in
/// the repository.
pub fn doc_quality(
    entities: &[Entity],
    glossary: &[Term],
    revisions: &BTreeMap<String, String>,
) -> Vec<Item> {
    let domain: Vec<&Entity> = entities
        .iter()
        .filter(|e| layer_of(e) == Some(Layer::Domain))
        .collect();
    let all_by_key = index_of(entities);
    let mut only_adr = Vec::new();
    let mut no_def = Vec::new();
    let mut one_sided = Vec::new();

    for e in &domain {
        let facts = own(e);
        let definition = facts.iter().find(|f| f.kind == "entity");
        if !facts.is_empty() && facts.iter().all(|f| DECISION_OR_FEATURE.is_match(&f.path)) {
            let place = if facts.iter().any(|f| ADR_PATH.is_match(&f.path)) {
                "an ADR"
            } else {
                "a feature"
            };
            let stated = definition
                .map(|f| f.text.trim().to_string())
                .unwrap_or_default();
            only_adr.push(Item {
                key: format!("oa:{}", e.key),
                kind: Kind::OnlyAdr,
                title: format!("{} is described only in {place}", e.name),
                hint: "No requirement or domain document says it is part of the product. Add it to the project domain model, with what it is.".to_string(),
                sides: sides_of(&facts),
                edit: Some(EntityEdit {
                    definition: Some(if stated.is_empty() { definition_from(e) } else { stated }),
                    ..entity_draft(e)
                }),
                pair: None,
                sentence: None,
            });
            continue;
        }
        if definition.is_none() && facts.len() >= 3 {
            no_def.push(Item {
                key: format!("nd:{}", e.key),
                kind: Kind::NoDefinition,
                title: format!("{} has no definition", e.name),
                hint: format!(
                    "{} facts describe it, but no document says what it is. Correct the sentence below and save it.",
                    facts.len()
                ),
                sides: sides_of(&facts),
                edit: Some(EntityEdit {
                    definition: Some(definition_from(e)),
                    ..entity_draft(e)
                }),
                pair: None,
                sentence: None,
            });
        }
    }

    let domain_keys: BTreeSet<&str> = domain.iter().map(|e| e.key.as_str()).collect();
    let mut seen: BTreeSet<String> = BTreeSet::new();
    for a in &domain {
        for f in own(a) {
            if f.kind != "relation" {
                continue;
            }
            let Some(b) = relation_target(a, f, entities, &all_by_key) else {
                continue;
            };
            if !domain_keys.contains(b.key.as_str()) {
                continue;
            }
            let id = format!("{}>{}", a.key, b.key);
            if seen.contains(&id) || seen.contains(&format!("{}>{}", b.key, a.key)) {
                continue;
            }
            seen.insert(id.clone());
            if mentions(&own(b), a, b, entities, &all_by_key) {
                continue;
            }
            let draft = entity_draft(b);
            let verb = inverse_verb(&f.aspect);
            let said = f.aspect.trim();
            let said = if said.is_empty() { "relates to" } else { said };
            let mut sides = vec![side_of(f)];
            sides.extend(sides_of(&own(b)));
            sides.truncate(3);
            let mut relations = draft.relations.clone();
            relations.push(Relation {
                verb: verb.to_string(),
                target: a.name.clone(),
            });
            one_sided.push(Item {
                key: format!("os:{id}"),
                kind: Kind::OneSided,
                title: format!(
                    "{} {said} {}, but {} never mentions {}",
                    a.name, b.name, b.name, a.name
                ),
                hint: format!(
                    "Only one side of the relation is written down, so a reader who starts at {} does not learn of it. Add the other side to {}.",
                    b.name, b.name
                ),
                sides,
                edit: Some(EntityEdit {
                    definition: draft.definition.clone().filter(|d| !d.is_empty()),
                    relations,
                    ..draft
                }),
                pair: None,
                sentence: None,
            });
        }
    }

    // No relation: a name made of another thing's name, and nothing that
    // relates the two. The modifier is what it belongs to; a head noun alone
    // is what it is a kind of.
    let mut no_relation = Vec::new();
    let tied = tied_keys(entities);
    let domain_by_key: HashMap<&str, &Entity> =
        domain.iter().map(|e| (e.key.as_str(), *e)).collect();
    for e in &domain {
        if tied.contains(&e.key) || SCREEN_OR_STEP.is_match(&e.name) {
            continue;
        }
        let parts = named_in(e, &domain_by_key);
        let Some(&(other, head)) = parts.iter().find(|p| !p.1).or(parts.first()) else {
            continue;
        };
        let Some(anchor) = passage_of(e, revisions) else {
            continue;
        };
        let verb = if head { "is a kind of" } else { "belongs to" };
        let target = other.name.clone();
        let mut sides = vec![side_of(anchor)];
        sides.extend(sides_of(&own(other)));
        sides.truncate(3);
        no_relation.push(Item {
            key: format!("nr:{}", e.key),
            kind: Kind::NoRelation,
            title: format!("{} is related to nothing", e.name),
            hint: format!(
                "Its name says it is about {target}, but no document says how. The sentence goes into the document that describes {}, after that passage, as a pull request.",
                e.name
            ),
            sides,
            edit: None,
            pair: None,
            sentence: Some(Sentence {
                path: anchor.path.clone(),
                revision: revisions.get(&anchor.path).cloned().unwrap_or_default(),
                line: anchor.line_end,
                sentence: relation_sentence(&e.name, verb, &target),
                why: format!("say how {} relates to {target}", e.name),
                name: e.name.clone(),
                verb: verb.to_string(),
                target,
            }),
        });
    }

    let two_names = similar_pairs(glossary, 40).into_iter().map(|p| Item {
        key: format!("tn:{}|{}", p.a.key, p.b.key),
        kind: Kind::TwoNames,
        title: format!(
            "\u{201c}{}\u{201d} and \u{201c}{}\u{201d} may be one thing",
            p.a.name, p.b.name
        ),
        hint: format!(
            "{}. If they are one thing, the glossary reads \u{201c}{}\u{201d} as \u{201c}{}\u{201d} everywhere.",
            p.why, p.b.name, p.a.name
        ),
        sides: Vec::new(),
        edit: None,
        pair: Some(p),
        sentence: None,
    });

    only_adr
        .into_iter()
        .chain(no_def)
        .chain(one_sided)
        .chain(no_relation)
        .chain(two_names)
        .collect()
}

#[cfg(test)]
#[path = "doc_quality_tests.rs"]
mod tests;
