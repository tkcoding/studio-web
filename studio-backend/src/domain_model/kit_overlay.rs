//! A kit's model overlay (ADR-0067 §6, ADR-0068 §2 and §8): the types,
//! fields, relations, tabs and lifecycles a kit brings into an organization's
//! model, and how the model is made to carry exactly what one kit version
//! says.
//!
//! The overlay is JSON (`model` in a kit's `kit.json`):
//!
//! ```json
//! {
//!   "types": [{"name": "phase", "label": "Phase", "description": "…",
//!              "extends": null, "bucket": null,
//!              "fields": [{"name": "order", "type": "integer"}]}],
//!   "fields": [{"on": "project", "name": "phase", "type": "idea | build",
//!               "description": "…", "required": false}],
//!   "relations": [{"on": "project", "name": "phase_of", "target": "phase",
//!                  "verb": "references", "label": "in phase"}],
//!   "tabs": [{"level": "project", "name": "lifecycle", "label": "Lifecycle",
//!             "target": "project"}],
//!   "lifecycles": [{"on": "project", "field": "phase", "states": ["idea", "build"],
//!                   "initial": "idea",
//!                   "transitions": [{"name": "start", "from": ["idea"], "to": "build"}]}]
//! }
//! ```
//!
//! A type the kit brings is the entity `<slug>-<name>` (the domain model
//! derives its graph type from that id) and is catalogued as
//! `gts.cf.studio.kit.<slug>.<name>.v1~` (`meta.gts`). `on`, `target` and
//! `level` name a type of the model by its id, or one of the kit's own by its
//! `name`.
//!
//! Everything carries its origin: a type `meta.origin = "kit"`, `meta.kit`
//! and `meta.kit_version`; a field, relation or tab `origin`, `kit` and
//! `kit_version` on the property; a lifecycle the same keys in
//! `meta.lifecycles[]`. So [`sync`] can tell what a kit brought from what
//! people and gears defined, and:
//!
//! - **installs** by adding what the overlay says,
//! - **upgrades** by applying the difference between what the model carries
//!   for the kit and what the new version says,
//! - **uninstalls** (no overlay) by removing what carries the kit's origin; a
//!   type that still has objects (or a gear holds) is kept dormant, marked `meta.left_by = {kit, version, at}` (ADR-0070 §4), with its
//!   fields, until an administrator removes it.
//!
//! The rules of ADR-0067 §6 hold by construction: the format has no way to
//! remove or retype, a field or relation a type already has from anyone else
//! is a conflict rather than a change, and a kit never holds a type (there is
//! no `held_by` to say, and an unknown key is refused).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use super::ontology::Ontology;

/// `meta.origin` / `origin` of what a kit brought.
pub const ORIGIN_KIT: &str = "kit";

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KitOverlay {
    #[serde(default)]
    pub types: Vec<OverlayType>,
    #[serde(default)]
    pub fields: Vec<OverlayField>,
    #[serde(default)]
    pub relations: Vec<OverlayRelation>,
    #[serde(default)]
    pub tabs: Vec<OverlayTab>,
    #[serde(default)]
    pub lifecycles: Vec<OverlayLifecycle>,
    /// Fields, relations and tabs that move out of the core into this kit
    /// (ADR-0070 phase 5), each as the model writes it, so an organization
    /// reads them exactly as before: added as written, with the kit's marks.
    #[serde(default)]
    pub properties: Vec<OverlayProperty>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OverlayProperty {
    /// The type it is on.
    pub on: String,
    /// The property as the model writes it: `name`, `type`, and for a
    /// relation or a tab `relation`, `relationType`, `extends: edge`, ...
    pub property: Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OverlayType {
    /// Lowercase words joined by hyphens; the entity is `<slug>-<name>`,
    /// unless `id` declares an existing one. The overlay names the type by it.
    pub name: String,
    /// Declare a type Studio already knows, by its entity id (`milestone`):
    /// the type keeps that id and its GTS id
    /// (`gts.cf.studio.domain.milestone.v1~`), so stored objects keep
    /// matching. A model that already has it from Studio's core is adopted
    /// rather than refused: its fields stay, a field the kit declares with
    /// the same type is taken over as the kit's, and a gear's hold
    /// (`held_by`) is kept. Another kit's type is still a conflict.
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    /// A type of the model it extends.
    #[serde(default)]
    pub extends: Option<String>,
    #[serde(default)]
    pub bucket: Option<String>,
    #[serde(default)]
    pub fields: Vec<TypeField>,
    /// The type's whole definition as Studio's model writes it, for a type
    /// that moves out of the core into this kit (ADR-0070 phase 5): needs
    /// `id`. Where the model lacks the type it is added as written, with the
    /// kit's marks; where the model has it (an organization that had it from
    /// the core), the organization's definition stays and only the marks
    /// change, as for any declared type.
    #[serde(default)]
    pub entity: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TypeField {
    pub name: String,
    #[serde(rename = "type")]
    pub type_name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub required: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OverlayField {
    /// The type it is added to.
    pub on: String,
    pub name: String,
    #[serde(rename = "type")]
    pub type_name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub required: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OverlayRelation {
    pub on: String,
    pub name: String,
    pub target: String,
    /// `references` (default), `owns`, `member`, `composes`.
    #[serde(default)]
    pub verb: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OverlayTab {
    /// The level's type: `organization`, `workspace`, `project`.
    pub level: String,
    pub name: String,
    pub label: String,
    /// The type the tab shows.
    pub target: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OverlayLifecycle {
    pub on: String,
    /// The status field the lifecycle moves.
    pub field: String,
    pub states: Vec<String>,
    #[serde(default)]
    pub initial: Option<String>,
    #[serde(default)]
    pub transitions: Vec<Transition>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Transition {
    pub name: String,
    pub from: Vec<String>,
    pub to: String,
}

/// Why a kit's overlay was not applied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KitModelError {
    /// The overlay itself is wrong: a name, a state, a type that is nowhere.
    Invalid(String),
    /// The organization's model already has it from somebody else: a kit
    /// extends, it never takes over or retypes.
    Conflict(String),
}

impl std::fmt::Display for KitModelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(m) | Self::Conflict(m) => f.write_str(m),
        }
    }
}

impl std::error::Error for KitModelError {}

/// What [`sync`] changed, in words a person reads (`type x`, `field
/// project.phase`, …).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct KitModelChange {
    pub added: Vec<String>,
    pub updated: Vec<String>,
    pub removed: Vec<String>,
    /// Types the kit no longer brings that still have objects: kept, marked
    /// left by the kit.
    pub kept: Vec<String>,
}

impl KitModelChange {
    pub fn is_empty(&self) -> bool {
        self.added.is_empty()
            && self.updated.is_empty()
            && self.removed.is_empty()
            && self.kept.is_empty()
    }
}

/// The entity a kit's type is.
pub fn kit_entity_id(slug: &str, name: &str) -> String {
    format!("{slug}-{name}")
}

impl OverlayType {
    /// The entity this type is: the one it declares, else the kit's own.
    pub fn entity_id(&self, slug: &str) -> String {
        self.id
            .clone()
            .unwrap_or_else(|| kit_entity_id(slug, &self.name))
    }

    /// The GTS id it is catalogued under: a declared type keeps Studio's,
    /// a kit's own is under the kit's namespace.
    pub fn gts(&self, slug: &str) -> String {
        match &self.id {
            Some(id) => super::gts::node_type_id(id),
            None => kit_type_gts(slug, &self.name),
        }
    }
}

/// The GTS id a kit's type is catalogued under.
pub fn kit_type_gts(slug: &str, name: &str) -> String {
    let token = |s: &str| s.replace(['-', '.', ' '], "_");
    format!("gts.cf.studio.kit.{}.{}.v1~", token(slug), token(name))
}

fn type_name_ok(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 40
        && s.starts_with(|c: char| c.is_ascii_lowercase())
        && !s.ends_with('-')
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn property_name_ok(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.starts_with(|c: char| c.is_ascii_lowercase())
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// Check an overlay on its own, before any model is read.
pub fn validate(slug: &str, o: &KitOverlay) -> Result<(), KitModelError> {
    let bad = |m: String| Err(KitModelError::Invalid(m));
    let mut types = Vec::new();
    for t in &o.types {
        if !type_name_ok(&t.name) || kit_entity_id(slug, &t.name).len() > 64 {
            return bad(format!(
                "type `{}`: a kit's type is lowercase words joined by hyphens",
                t.name
            ));
        }
        if let Some(id) = &t.id
            && (!type_name_ok(id) || id.len() > 64)
        {
            return bad(format!(
                "type `{}`: `id` `{id}` is not an entity id (lowercase words joined by hyphens)",
                t.name
            ));
        }
        if let Some(entity) = &t.entity {
            let Some(id) = &t.id else {
                return bad(format!(
                    "type `{}`: a whole `entity` definition needs the `id` it keeps",
                    t.name
                ));
            };
            if entity.get("id").and_then(Value::as_str) != Some(id.as_str())
                || !entity.get("properties").is_some_and(Value::is_array)
            {
                return bad(format!(
                    "type `{}`: `entity` must be a model entity with the id `{id}` and its properties",
                    t.name
                ));
            }
        }
        if types.contains(&t.name) {
            return bad(format!("type `{}` is declared twice", t.name));
        }
        types.push(t.name.clone());
        let mut names: Vec<&str> = Vec::new();
        for f in &t.fields {
            if !property_name_ok(&f.name) || f.type_name.trim().is_empty() {
                return bad(format!(
                    "type `{}`: field `{}` is not well formed",
                    t.name, f.name
                ));
            }
            if names.contains(&f.name.as_str()) {
                return bad(format!("type `{}`: field `{}` twice", t.name, f.name));
            }
            names.push(&f.name);
        }
    }
    let mut props: Vec<(String, String)> = Vec::new();
    let mut add = |on: &str, name: &str| -> Result<(), KitModelError> {
        if on.trim().is_empty() || !property_name_ok(name) {
            return Err(KitModelError::Invalid(format!(
                "`{on}.{name}`: a field, relation or tab is a lowercase name on a type"
            )));
        }
        let key = (on.to_owned(), name.to_owned());
        if props.contains(&key) {
            return Err(KitModelError::Invalid(format!(
                "`{on}.{name}` is declared twice"
            )));
        }
        props.push(key);
        Ok(())
    };
    for p in &o.properties {
        let Some(name) = p.property.get("name").and_then(Value::as_str) else {
            return bad(format!("a moved property on `{}` has no name", p.on));
        };
        if p.property.get("type").and_then(Value::as_str).is_none() {
            return bad(format!("moved property `{}.{name}` has no type", p.on));
        }
        add(&p.on, name)?;
    }
    for f in &o.fields {
        if f.type_name.trim().is_empty() {
            return bad(format!("field `{}.{}` has no type", f.on, f.name));
        }
        add(&f.on, &f.name)?;
    }
    for r in &o.relations {
        if let Some(verb) = &r.verb
            && (verb == "shows" || !property_name_ok(verb))
        {
            return bad(format!(
                "relation `{}.{}`: `{verb}` is not a verb (a tab is declared under `tabs`)",
                r.on, r.name
            ));
        }
        add(&r.on, &r.name)?;
    }
    for t in &o.tabs {
        if t.label.trim().is_empty() {
            return bad(format!("tab `{}.{}` has no label", t.level, t.name));
        }
        add(&t.level, &t.name)?;
    }
    let mut cycles: Vec<(String, String)> = Vec::new();
    for l in &o.lifecycles {
        let at = format!("lifecycle `{}.{}`", l.on, l.field);
        if l.states.is_empty() {
            return bad(format!("{at} has no states"));
        }
        let mut seen: Vec<&str> = Vec::new();
        for s in &l.states {
            if s.trim().is_empty() || seen.contains(&s.as_str()) {
                return bad(format!("{at}: state `{s}` is empty or twice"));
            }
            seen.push(s);
        }
        if let Some(i) = &l.initial
            && !l.states.contains(i)
        {
            return bad(format!(
                "{at}: the initial state `{i}` is not one of its states"
            ));
        }
        for t in &l.transitions {
            if !l.states.contains(&t.to) || t.from.iter().any(|f| !l.states.contains(f)) {
                return bad(format!(
                    "{at}: transition `{}` names a state it does not have",
                    t.name
                ));
            }
        }
        let key = (l.on.clone(), l.field.clone());
        if cycles.contains(&key) {
            return bad(format!("{at} is declared twice"));
        }
        cycles.push(key);
    }
    Ok(())
}

fn str_of<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

/// Whose a property is: `Some(slug)` when a kit brought it.
fn property_kit(p: &Value) -> Option<&str> {
    (str_of(p, "origin") == Some(ORIGIN_KIT))
        .then(|| str_of(p, "kit"))
        .flatten()
}

/// A property the kit brought, or left behind on a type it kept.
fn ours_or_left(p: &Value, slug: &str) -> bool {
    property_kit(p) == Some(slug) || left_kit(p) == Some(slug)
}

fn entity_kit(e: &Value) -> Option<&str> {
    e.get("meta")
        .filter(|m| str_of(m, "origin") == Some(ORIGIN_KIT))
        .and_then(|m| str_of(m, "kit"))
}

/// The kit that left `v` dormant (ADR-0070 §4: `left_by = {kit, version, at}`).
fn left_kit(v: &Value) -> Option<&str> {
    v.pointer("/left_by/kit").and_then(Value::as_str)
}

fn entity_left_by(e: &Value) -> Option<&str> {
    e.get("meta").and_then(left_kit)
}

/// Mark `v` (a type's meta, or a field) dormant, left by the kit it carried,
/// unless it already is: the mark keeps when it was left.
fn leave(v: &mut Map<String, Value>, slug: &str, at: &str) -> bool {
    if v.get("left_by")
        .and_then(|l| l.get("kit"))
        .and_then(Value::as_str)
        == Some(slug)
    {
        return false;
    }
    let version = v.remove("kit_version").unwrap_or(Value::Null);
    v.remove("kit");
    v.insert(
        "left_by".into(),
        json!({ "kit": slug, "version": version, "at": at }),
    );
    true
}

/// The kits a model carries, with the version each was applied at.
pub fn carried(o: &Ontology) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    let mut note = |v: &Value, slug: &str| {
        let version = str_of(v, "kit_version").unwrap_or_default().to_owned();
        out.entry(slug.to_owned()).or_insert(version);
    };
    for e in o.entities() {
        if let Some(slug) = entity_kit(e) {
            note(&e["meta"], slug);
        }
        for p in e
            .get("properties")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(slug) = property_kit(p) {
                note(p, slug);
            }
        }
        for l in e
            .pointer("/meta/lifecycles")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(slug) = property_kit(l) {
                note(l, slug);
            }
        }
    }
    out.extend(o.property_layer_versions());
    out
}

fn marked(mut v: Value, slug: &str, version: &str) -> Value {
    if let Some(o) = v.as_object_mut() {
        o.insert("origin".into(), json!(ORIGIN_KIT));
        o.insert("kit".into(), json!(slug));
        o.insert("kit_version".into(), json!(version));
        o.remove("left_by");
    }
    v
}

/// The types of a kit's own that the model has, carried or left by it: the
/// caller asks which still have objects before [`sync`].
pub fn own_types(o: &Ontology, slug: &str) -> Vec<String> {
    o.entities()
        .iter()
        .filter(|e| entity_kit(e) == Some(slug) || entity_left_by(e) == Some(slug))
        .filter_map(|e| str_of(e, "id").map(str::to_owned))
        .collect()
}

/// Make `o` carry exactly `overlay` for kit `slug` at `version`; `None`
/// removes what the kit brought. `inhabited` says whether a type has objects.
pub fn sync(
    o: &mut Ontology,
    slug: &str,
    version: &str,
    overlay: Option<&KitOverlay>,
    inhabited: &dyn Fn(&str) -> bool,
) -> Result<KitModelChange, KitModelError> {
    let empty = KitOverlay::default();
    let overlay = overlay.unwrap_or(&empty);
    validate(slug, overlay)?;
    // When a type or field goes dormant (ADR-0070 §4).
    let at = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default();
    // The types the overlay declares by an existing id (moved out of
    // Studio's core into the kit): adopted where the model has them.
    let declared: Vec<String> = overlay
        .types
        .iter()
        .filter(|t| t.id.is_some())
        .map(|t| t.entity_id(slug))
        .collect();
    let resolve = |name: &str| -> Result<String, KitModelError> {
        if let Some(t) = overlay.types.iter().find(|t| t.name == name) {
            return Ok(t.entity_id(slug));
        }
        o.resolve_entity_id(name).ok_or_else(|| {
            KitModelError::Invalid(format!(
                "the model has no type `{name}` for the kit to extend"
            ))
        })
    };

    // What the overlay wants: types, then properties by (entity, name), then
    // lifecycles by (entity, field).
    let mut want_types: Vec<(String, Value)> = Vec::new();
    for t in &overlay.types {
        let extends = t.extends.as_deref().map(&resolve).transpose()?;
        let id = t.entity_id(slug);
        let bucket = t
            .bucket
            .clone()
            .or_else(|| {
                extends
                    .as_deref()
                    .and_then(|b| o.entity(b))
                    .and_then(|e| str_of(e, "bucket"))
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| "planning".into());
        if let Some(entity) = &t.entity {
            let mut want = entity.clone();
            if !want.get("meta").is_some_and(Value::is_object) {
                want["meta"] = json!({});
            }
            want["meta"]["origin"] = json!(ORIGIN_KIT);
            want["meta"]["kit"] = json!(slug);
            want["meta"]["kit_version"] = json!(version);
            want["meta"]["gts"] = json!(t.gts(slug));
            want_types.push((id.clone(), want));
            continue;
        }
        want_types.push((
            id.clone(),
            json!({
                "id": id,
                "layer": "product",
                "extends": extends,
                "abstract": false,
                "bucket": bucket,
                "name": t.label.clone().unwrap_or_else(|| t.name.clone()),
                "kind": "entity",
                "description": t.description.clone().unwrap_or_default(),
                "meta": {
                    "origin": ORIGIN_KIT,
                    "kit": slug,
                    "kit_version": version,
                    "gts": t.gts(slug),
                },
                "properties": [],
                "methods": [],
                "examples": [],
            }),
        ));
    }
    let type_label = |id: &str| -> String {
        want_types
            .iter()
            .find(|(i, _)| i == id)
            .and_then(|(_, v)| str_of(v, "name").map(str::to_owned))
            .or_else(|| {
                o.entity(id)
                    .and_then(|e| str_of(e, "name"))
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| id.to_owned())
    };
    let mut want_props: Vec<(String, String, Value)> = Vec::new();
    for t in &overlay.types {
        let id = t.entity_id(slug);
        for f in &t.fields {
            want_props.push((
                id.clone(),
                f.name.clone(),
                json!({
                    "name": f.name, "type": f.type_name,
                    "description": f.description.clone().unwrap_or_default(),
                    "required": f.required, "relationLabel": "",
                }),
            ));
        }
    }
    for p in &overlay.properties {
        let name = p
            .property
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        want_props.push((resolve(&p.on)?, name, p.property.clone()));
    }
    for f in &overlay.fields {
        want_props.push((
            resolve(&f.on)?,
            f.name.clone(),
            json!({
                "name": f.name, "type": f.type_name,
                "description": f.description.clone().unwrap_or_default(),
                "required": f.required, "relationLabel": "",
            }),
        ));
    }
    for r in &overlay.relations {
        let target = resolve(&r.target)?;
        want_props.push((
            resolve(&r.on)?,
            r.name.clone(),
            json!({
                "name": r.name, "type": type_label(&target), "description": "",
                "required": false, "extends": "edge", "relation": target,
                "relationType": r.verb.clone().unwrap_or_else(|| "references".into()),
                "relationLabel": r.label.clone().unwrap_or_else(|| r.name.replace('_', " ")),
            }),
        ));
    }
    for t in &overlay.tabs {
        let target = resolve(&t.target)?;
        let level = resolve(&t.level)?;
        want_props.push((
            level.clone(),
            t.name.clone(),
            json!({
                "name": t.name, "type": type_label(&target),
                "description": format!("A tab of the {level}: what it shows."),
                "required": false, "extends": "edge", "relation": target,
                "relationType": "shows", "relationLabel": t.label,
            }),
        ));
    }
    let mut want_cycles: Vec<(String, String, Value)> = Vec::new();
    for l in &overlay.lifecycles {
        let on = resolve(&l.on)?;
        let declared = want_props.iter().any(|(e, n, _)| *e == on && *n == l.field)
            || o.effective_properties(&on)
                .iter()
                .any(|p| p.name == l.field);
        if !declared {
            return Err(KitModelError::Invalid(format!(
                "lifecycle `{}.{}`: the type has no such field",
                l.on, l.field
            )));
        }
        want_cycles.push((
            on,
            l.field.clone(),
            json!({
                "field": l.field, "states": l.states, "initial": l.initial,
                "transitions": l.transitions.iter().map(|t| json!({
                    "name": t.name, "from": t.from, "to": t.to,
                })).collect::<Vec<_>>(),
            }),
        ));
    }

    // Conflicts first: nothing is changed when any is found.
    for (id, _) in &want_types {
        // A type the overlay declares by its existing id is adopted, unless
        // another kit carries it.
        let adoptable = |e: &Value| declared.contains(id) && entity_kit(e).is_none();
        if let Some(e) = o.entity(id)
            && entity_kit(e) != Some(slug)
            && entity_left_by(e) != Some(slug)
            && !adoptable(e)
        {
            return Err(KitModelError::Conflict(format!(
                "the model already has a type `{id}` the kit `{slug}` did not bring"
            )));
        }
    }
    for (entity, name, want) in &want_props {
        if want_types.iter().any(|(id, _)| id == entity) && o.entity(entity).is_none() {
            continue;
        }
        // A declared type's own field of the same type is taken over.
        if adopts_field(o, &declared, entity, name, want) {
            continue;
        }
        if o.entity(entity).is_none() {
            return Err(KitModelError::Invalid(format!(
                "the model has no type `{entity}` for the kit to extend"
            )));
        }
        let own = o
            .entity(entity)
            .and_then(|e| e.get("properties"))
            .and_then(Value::as_array)
            .and_then(|ps| ps.iter().find(|p| str_of(p, "name") == Some(name.as_str())));
        let ours = own.is_some_and(|p| ours_or_left(p, slug));
        let anywhere = o
            .effective_properties(entity)
            .iter()
            .any(|p| p.name == *name);
        if (own.is_some() || anywhere) && !ours {
            return Err(KitModelError::Conflict(format!(
                "`{entity}` already has `{name}`, which the kit `{slug}` did not bring: a kit adds, \
                 it never takes over or retypes"
            )));
        }
    }
    for (entity, field, _) in &want_cycles {
        let theirs = o
            .entity(entity)
            .and_then(|e| e.pointer("/meta/lifecycles"))
            .and_then(Value::as_array)
            .is_some_and(|ls| {
                ls.iter().any(|l| {
                    str_of(l, "field") == Some(field.as_str()) && property_kit(l) != Some(slug)
                })
            });
        if theirs {
            return Err(KitModelError::Conflict(format!(
                "`{entity}.{field}` already has a lifecycle the kit `{slug}` did not bring"
            )));
        }
    }

    let before: Vec<Value> = o.entities().to_vec();
    let mut change = KitModelChange::default();
    let leaving: Vec<String> = own_types(o, slug)
        .into_iter()
        .filter(|id| !want_types.iter().any(|(w, _)| w == id))
        .collect();
    // A type with objects stays, and so does one a gear holds: the gear
    // writes it whatever kit declared it.
    let (kept, dropped): (Vec<String>, Vec<String>) = leaving.into_iter().partition(|id| {
        entity_kit_or_left(o, id, slug) && (inhabited(id) || o.held_by(id).is_some())
    });
    // Fields of declared types the kit takes over rather than adds.
    let adopted: Vec<(String, String)> = want_props
        .iter()
        .filter(|(e, n, w)| adopts_field(o, &declared, e, n, w))
        .map(|(e, n, _)| (e.clone(), n.clone()))
        .collect();
    let entities = o
        .entities_mut()
        .ok_or_else(|| KitModelError::Invalid("the model is malformed".into()))?;

    // Types: adopt, update or add.
    for (id, want) in &want_types {
        match entities
            .iter_mut()
            .find(|e| str_of(e, "id") == Some(id.as_str()))
        {
            Some(e) => {
                let mut next = if declared.contains(id) {
                    // A type the kit declares by its existing id stays as the
                    // model has it; only the marks change. A type that moved
                    // out of the core (its whole `entity` in the overlay), that
                    // a gear declared first with only what it writes, gains the
                    // fields it lacks. An organization's own definition is left
                    // as it is: a field it removed stays removed (ADR-0070 §7,
                    // decision 6).
                    let mut next = e.clone();
                    let gear_made =
                        e.pointer("/meta/origin").and_then(Value::as_str) == Some("gear");
                    let theirs: Vec<Value> = want
                        .get("properties")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default();
                    if gear_made && !theirs.is_empty() {
                        if !next.get("properties").is_some_and(Value::is_array) {
                            next["properties"] = json!([]);
                        }
                        let props = next["properties"].as_array_mut().expect("made above");
                        for p in theirs {
                            let name = str_of(&p, "name").unwrap_or_default().to_owned();
                            if !props
                                .iter()
                                .any(|q| str_of(q, "name") == Some(name.as_str()))
                            {
                                props.push(p);
                            }
                        }
                    }
                    next
                } else {
                    let mut next = want.clone();
                    next["properties"] = e.get("properties").cloned().unwrap_or_else(|| json!([]));
                    for key in ["methods", "examples"] {
                        if let Some(v) = e.get(key) {
                            next[key] = v.clone();
                        }
                    }
                    next
                };
                // Keep what the type's meta says beyond the kit's marks: a
                // gear's hold, lifecycles, where it came from.
                let mut meta = e
                    .get("meta")
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default();
                if entity_kit(e) != Some(slug)
                    && entity_left_by(e) != Some(slug)
                    && let Some(origin) = meta.get("origin").cloned()
                {
                    meta.insert("adopted_from".into(), origin);
                }
                if let Some(marks) = want.get("meta").and_then(Value::as_object) {
                    for (k, v) in marks {
                        meta.insert(k.clone(), v.clone());
                    }
                }
                meta.remove("left_by");
                next["meta"] = Value::Object(meta);
                if *e != next {
                    *e = next;
                    change.updated.push(format!("type {id}"));
                }
            }
            None => {
                entities.push(want.clone());
                change.added.push(format!("type {id}"));
            }
        }
    }

    // Properties: on every type, what the kit brought and no longer wants
    // goes (a kept type keeps its fields, marked left), what it wants is
    // added or brought up to date.
    for e in entities.iter_mut() {
        let id = str_of(e, "id").unwrap_or_default().to_owned();
        let is_kept = kept.contains(&id);
        let Some(props) = e.get_mut("properties").and_then(Value::as_array_mut) else {
            continue;
        };
        let mut i = 0;
        while i < props.len() {
            let name = str_of(&props[i], "name").unwrap_or_default().to_owned();
            if ours_or_left(&props[i], slug) {
                match want_props.iter().find(|(en, n, _)| *en == id && *n == name) {
                    Some((_, _, want)) => {
                        let next = keep_hold(&props[i], marked(want.clone(), slug, version));
                        if props[i] != next {
                            props[i] = next;
                            change.updated.push(format!("{id}.{name}"));
                        }
                    }
                    None if is_kept => {
                        if let Some(p) = props[i].as_object_mut() {
                            leave(p, slug, &at);
                        }
                    }
                    None => {
                        props.remove(i);
                        change.removed.push(format!("{id}.{name}"));
                        continue;
                    }
                }
            }
            i += 1;
        }
        for (_, name, want) in want_props.iter().filter(|(en, _, _)| *en == id) {
            match props
                .iter_mut()
                .find(|p| str_of(p, "name") == Some(name.as_str()))
            {
                // A declared type's own field, taken over as the kit's.
                Some(p) if adopted.iter().any(|(e, n)| *e == id && n == name) => {
                    *p = keep_hold(p, marked(want.clone(), slug, version));
                    change.updated.push(format!("{id}.{name}"));
                }
                Some(_) => {}
                None => {
                    props.push(marked(want.clone(), slug, version));
                    change.added.push(format!("{id}.{name}"));
                }
            }
        }
    }

    // Lifecycles, kept in `meta.lifecycles` of their type.
    for e in entities.iter_mut() {
        let id = str_of(e, "id").unwrap_or_default().to_owned();
        let wanted: Vec<&(String, String, Value)> =
            want_cycles.iter().filter(|(en, _, _)| *en == id).collect();
        let has_ours = e
            .pointer("/meta/lifecycles")
            .and_then(Value::as_array)
            .is_some_and(|ls| ls.iter().any(|l| property_kit(l) == Some(slug)));
        if wanted.is_empty() && !has_ours {
            continue;
        }
        if !e.get("meta").is_some_and(Value::is_object) {
            e["meta"] = Value::Object(Map::new());
        }
        let meta = e["meta"].as_object_mut().expect("an object, made above");
        let list = meta
            .entry("lifecycles")
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .map(std::mem::take)
            .unwrap_or_default();
        let mut next: Vec<Value> = Vec::new();
        for l in list {
            if property_kit(&l) != Some(slug) {
                next.push(l);
            } else if !wanted
                .iter()
                .any(|(_, f, _)| Some(f.as_str()) == str_of(&l, "field"))
            {
                change.removed.push(format!(
                    "lifecycle {id}.{}",
                    str_of(&l, "field").unwrap_or_default()
                ));
            } else {
                next.push(l);
            }
        }
        for (_, field, want) in wanted {
            let want = marked(want.clone(), slug, version);
            match next.iter_mut().find(|l| {
                str_of(l, "field") == Some(field.as_str()) && property_kit(l) == Some(slug)
            }) {
                Some(l) if *l == want => {}
                Some(l) => {
                    *l = want;
                    change.updated.push(format!("lifecycle {id}.{field}"));
                }
                None => {
                    next.push(want);
                    change.added.push(format!("lifecycle {id}.{field}"));
                }
            }
        }
        if next.is_empty() {
            meta.remove("lifecycles");
        } else {
            meta.insert("lifecycles".into(), Value::Array(next));
        }
    }

    // Types the kit no longer brings: dormant when they have objects or a
    // gear holds them (ADR-0070 §4), else gone.
    for id in &kept {
        if let Some(e) = entities
            .iter_mut()
            .find(|e| str_of(e, "id") == Some(id.as_str()))
            && let Some(meta) = e.get_mut("meta").and_then(Value::as_object_mut)
            && leave(meta, slug, &at)
        {
            change.kept.push(id.clone());
        }
    }
    let before_len = entities.len();
    entities.retain(|e| !dropped.iter().any(|d| Some(d.as_str()) == str_of(e, "id")));
    if entities.len() != before_len {
        change
            .removed
            .extend(dropped.iter().map(|d| format!("type {d}")));
    }
    // A version that changed nothing else still moves the markers.
    if change.is_empty() && o.entities() != before.as_slice() {
        change.updated.push(format!("kit {slug} {version}"));
    }
    Ok(change)
}

/// `next` with the gear's hold `old` carried (`held_by`): a kit declaring a
/// field never takes it away from the gear that writes it.
fn keep_hold(old: &Value, mut next: Value) -> Value {
    if let (Some(gear), Some(o)) = (old.get("held_by").cloned(), next.as_object_mut()) {
        o.insert("held_by".into(), gear);
    }
    next
}

/// Whether `entity.name` is a field the overlay takes over rather than adds:
/// the entity is a type it declares by its existing id, and the field is
/// already that type's own, of the same type, and no kit's.
fn adopts_field(o: &Ontology, declared: &[String], entity: &str, name: &str, want: &Value) -> bool {
    declared.iter().any(|d| d == entity)
        && o.entity(entity)
            .and_then(|e| e.get("properties"))
            .and_then(Value::as_array)
            .and_then(|ps| ps.iter().find(|p| str_of(p, "name") == Some(name)))
            .is_some_and(|p| property_kit(p).is_none() && p.get("type") == want.get("type"))
}

/// Is `id` a type of the kit's, carried or left?
fn entity_kit_or_left(o: &Ontology, id: &str, slug: &str) -> bool {
    o.entity(id)
        .is_some_and(|e| entity_kit(e) == Some(slug) || entity_left_by(e) == Some(slug))
}

/// What moved between `current` and `next`, as JSON Patch over `/entities`
/// and its inverse: a changed type replaced where it was, a removed one
/// taken out (from the end, so the indexes hold), an added one appended.
/// Small enough to keep in a model version, unlike the whole document.
#[cfg(test)]
pub fn entity_patches(current: &[Value], next: &[Value]) -> (Value, Value) {
    let id = |e: &Value| str_of(e, "id").unwrap_or_default().to_owned();
    let mut forward = Vec::new();
    let mut inverse_replace = Vec::new();
    for (i, e) in current.iter().enumerate() {
        if let Some(n) = next.iter().find(|n| id(n) == id(e))
            && n != e
        {
            forward.push(json!({ "op": "replace", "path": format!("/entities/{i}"), "value": n }));
            inverse_replace
                .push(json!({ "op": "replace", "path": format!("/entities/{i}"), "value": e }));
        }
    }
    let removed: Vec<(usize, &Value)> = current
        .iter()
        .enumerate()
        .filter(|(_, e)| !next.iter().any(|n| id(n) == id(e)))
        .collect();
    for (i, _) in removed.iter().rev() {
        forward.push(json!({ "op": "remove", "path": format!("/entities/{i}") }));
    }
    let added: Vec<&Value> = next
        .iter()
        .filter(|n| !current.iter().any(|e| id(e) == id(n)))
        .collect();
    for n in &added {
        forward.push(json!({ "op": "add", "path": "/entities/-", "value": n }));
    }
    // Undo, applied to `next`: the added ones off the end, the removed ones
    // back where they were, then the changed ones as they were.
    let mut inverse = Vec::new();
    for k in (0..added.len()).rev() {
        let at = next.len() - added.len() + k;
        inverse.push(json!({ "op": "remove", "path": format!("/entities/{at}") }));
    }
    for (i, e) in &removed {
        inverse.push(json!({ "op": "add", "path": format!("/entities/{i}"), "value": e }));
    }
    inverse.extend(inverse_replace);
    (Value::Array(forward), Value::Array(inverse))
}

#[cfg(test)]
#[path = "kit_overlay_tests.rs"]
mod tests;
