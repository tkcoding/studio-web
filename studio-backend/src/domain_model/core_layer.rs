//! The running core as a layer under the organization's model (ADR-0070 §5).
//!
//! Studio's own types used to be copied into a stored model once and only
//! ever grown (`add_studio_types`), so a changed field of the running Studio
//! never reached an organization and a field the organization removed came
//! back at the next start. The layer pins the core *source* the organization
//! was last composed from, per type (`entity`) and per field
//! (`property:<name>`). What the organization changed is the difference
//! between its effective model and that source, kept as named overrides and
//! re-derived at each sync, so a new running core reaches every key the
//! organization did not change, and every key it changed or removed stays as
//! it made it.
//!
//! The first sync of a legacy model is its migration: the organization's
//! layer is `stored − core`, the composition must equal what it read before,
//! and the version that records it has no inverse (a revert past it is
//! refused, like an import's).
//!
//! What a kit or a gear owns is not the core's to set: a field a kit brought
//! (`kit` mark), a field or type a gear holds (`held_by`) and a type a kit
//! declared by its existing id (`meta.origin = "kit"`, `meta.left_by`) are
//! skipped in both directions. The kit's own layer
//! ([`super::kit_property_layers`]) composes them.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::Ontology;
use super::kit_property_layers::{Overrides, apply, diff};

type Contributions = BTreeMap<String, BTreeMap<String, Value>>;

const KEY: &str = "core_layer";
const ENTITY: &str = "entity";
const PROPERTY: &str = "property:";

/// Marks the layers write on a field; never the core's content.
const FIELD_MARKS: &[&str] = &["origin", "kit", "kit_version", "left_by", "held_by"];
/// What other layers keep in a type's `meta`: never the core's content.
const RUNTIME_META: &[&str] = &[
    "origin",
    "upload",
    "adopted_from",
    "kit",
    "kit_version",
    "left_by",
    "held_by",
    "searchable",
    "lifecycles",
    "declared_by",
];

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Layer {
    format: u32,
    source: Contributions,
    overrides: Overrides,
    /// Keys whose difference was found when a legacy model was migrated: it
    /// may be the organization's edit or an older core's value, which a
    /// legacy model cannot tell apart. Kept as the organization's, and named
    /// here so the difference stays explainable.
    #[serde(default)]
    legacy: BTreeMap<String, BTreeSet<String>>,
}

/// What one core sync did to an organization's model.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CoreLayerChange {
    /// This sync migrated a legacy model into the layer.
    pub adopted: bool,
    /// The migration kept this many differences from the running core as the
    /// organization's.
    pub legacy_overrides: usize,
    /// Types whose effective document changed.
    pub updated: Vec<String>,
    /// Core keys the running core no longer declares: left as they are, now
    /// the organization's (`type` or `type.field`).
    pub released: Vec<String>,
    /// What moved to a kit: marked left by that kit until its overlay adopts
    /// it (`type` or `type.field`, with the kit).
    pub moved: Vec<(String, String)>,
}

impl Ontology {
    /// Whether this model has been migrated into the core layer.
    pub(in crate::domain_model) fn has_core_layer(&self) -> bool {
        self.doc.get(KEY).is_some()
    }

    /// Compose the running core under the organization's changes. `None`
    /// when the model already stands on this core. An error leaves `self`
    /// untouched: a migration whose composition would not equal the model it
    /// replaces is refused rather than applied.
    pub(in crate::domain_model) fn sync_core_layer(
        &mut self,
        seed: &[Value],
        moves: &BTreeMap<String, String>,
    ) -> anyhow::Result<Option<CoreLayerChange>> {
        let running = contributions(seed);
        let previous: Option<Layer> = self
            .doc
            .get(KEY)
            .cloned()
            .map(serde_json::from_value)
            .transpose()?;
        if let Some(layer) = &previous {
            anyhow::ensure!(layer.format == 1, "unsupported core layer format");
            if layer.source == running {
                return Ok(None);
            }
        }

        let mut change = CoreLayerChange::default();
        let mut next = self.clone();
        let mut layer = match previous {
            None => {
                // Legacy: whatever it lacked of the core was added at every
                // start, so that is what it read. The organization's layer
                // is what it holds beyond the core.
                next.add_core_types(seed);
                let mut overrides = Overrides::new();
                capture(&next, &running, &mut overrides);
                let mut composed = next.clone();
                compose(&mut composed, &running, &overrides);
                let differing = differing(&next, &composed);
                anyhow::ensure!(
                    differing.is_empty(),
                    "the core-layer migration would change types {differing:?}; kept the stored model"
                );
                change.adopted = true;
                let legacy: BTreeMap<String, BTreeSet<String>> = overrides
                    .iter()
                    .map(|(e, keys)| (e.clone(), keys.keys().cloned().collect()))
                    .collect();
                change.legacy_overrides = legacy.values().map(BTreeSet::len).sum();
                Layer {
                    format: 1,
                    source: running.clone(),
                    overrides,
                    legacy,
                }
            }
            Some(mut layer) => {
                capture(self, &layer.source, &mut layer.overrides);
                for (entity, keys) in &layer.source {
                    let Some(now) = running.get(entity) else {
                        change.released.push(entity.clone());
                        layer.overrides.remove(entity);
                        layer.legacy.remove(entity);
                        continue;
                    };
                    for key in keys.keys().filter(|k| !now.contains_key(*k)) {
                        if let Some(name) = key.strip_prefix(PROPERTY) {
                            change.released.push(format!("{entity}.{name}"));
                        }
                        if let Some(o) = layer.overrides.get_mut(entity) {
                            o.remove(key);
                        }
                        if let Some(l) = layer.legacy.get_mut(entity) {
                            l.remove(key);
                        }
                    }
                }
                layer.overrides.retain(|_, keys| !keys.is_empty());
                // A legacy difference the organization has since given up
                // is no longer one.
                for (entity, keys) in &mut layer.legacy {
                    keys.retain(|k| {
                        layer
                            .overrides
                            .get(entity)
                            .is_some_and(|o| o.contains_key(k))
                    });
                }
                layer.legacy.retain(|_, keys| !keys.is_empty());
                next.add_core_types(seed);
                compose(&mut next, &running, &layer.overrides);
                layer.source = running.clone();
                layer
            }
        };
        layer.overrides.retain(|_, keys| !keys.is_empty());
        change.moved = hand_over(&mut next, moves);
        next.doc[KEY] = json!(layer);
        change.updated = differing(self, &next);
        if next.document() == self.document() {
            return Ok(None);
        }
        *self = next;
        Ok(Some(change))
    }

    /// Keep the trusted core layer of `current`: an uploaded document cannot
    /// bring its own pinned source or its own record of what was legacy.
    pub(in crate::domain_model) fn keep_core_layer(&mut self, current: &Self) {
        match current.doc.get(KEY) {
            Some(layer) => self.doc[KEY] = layer.clone(),
            None => {
                if let Some(doc) = self.doc.as_object_mut() {
                    doc.remove(KEY);
                }
            }
        }
    }
}

fn contributions(seed: &[Value]) -> Contributions {
    let mut out = Contributions::new();
    for e in seed {
        let Some(id) = e.get("id").and_then(Value::as_str) else {
            continue;
        };
        let entries = out.entry(id.to_owned()).or_default();
        entries.insert(ENTITY.into(), entity_content(e));
        for p in e
            .get("properties")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(name) = p.get("name").and_then(Value::as_str) {
                entries.insert(format!("{PROPERTY}{name}"), field_content(p));
            }
        }
    }
    out
}

fn entity_content(e: &Value) -> Value {
    let mut e = e.clone();
    if let Some(o) = e.as_object_mut() {
        o.remove("properties");
        if let Some(meta) = o.get_mut("meta").and_then(Value::as_object_mut) {
            for key in RUNTIME_META {
                meta.remove(*key);
            }
        }
    }
    e
}

fn field_content(p: &Value) -> Value {
    let mut p = p.clone();
    if let Some(o) = p.as_object_mut() {
        for key in FIELD_MARKS {
            o.remove(*key);
        }
    }
    p
}

/// Mark what moved out of the core with the kit it moved to, as if that kit
/// had left it (`left_by`): dormant until the kit's overlay declares it, which
/// adopts it with the organization's definition, its objects and its ids. A
/// key a kit already carries, or that is already marked, is left alone; so is
/// one the organization never had.
fn hand_over(o: &mut Ontology, moves: &BTreeMap<String, String>) -> Vec<(String, String)> {
    let mut moved = Vec::new();
    for (key, kit) in moves {
        let mark = json!({"kit": kit, "version": "core", "at": "moved from the core"});
        match key.split_once('.') {
            None => {
                let Ok(e) = o.entity_mut(key) else { continue };
                if kit_declared(e) {
                    continue;
                }
                if !e.get("meta").is_some_and(Value::is_object) {
                    e["meta"] = json!({});
                }
                e["meta"]["left_by"] = mark;
                moved.push((key.clone(), kit.clone()));
            }
            Some((entity, name)) => {
                let Ok(e) = o.entity_mut(entity) else {
                    continue;
                };
                let Some(p) = e
                    .get_mut("properties")
                    .and_then(Value::as_array_mut)
                    .and_then(|ps| {
                        ps.iter_mut()
                            .find(|p| p.get("name").and_then(Value::as_str) == Some(name))
                    })
                else {
                    continue;
                };
                if foreign_field(p) || !p.is_object() {
                    continue;
                }
                p["left_by"] = mark;
                moved.push((key.clone(), kit.clone()));
            }
        }
    }
    moved
}

/// Another layer owns this type's own attributes.
fn kit_declared(e: &Value) -> bool {
    e.pointer("/meta/origin").and_then(Value::as_str) == Some("kit")
        || e.pointer("/meta/left_by").is_some()
}

/// Another layer owns this field.
fn foreign_field(p: &Value) -> bool {
    p.get("held_by").is_some()
        || p.get("origin").and_then(Value::as_str) == Some("kit")
        || p.get("left_by").is_some()
}

fn property<'a>(o: &'a Ontology, entity: &str, name: &str) -> Option<&'a Value> {
    o.entity(entity)?
        .get("properties")?
        .as_array()?
        .iter()
        .find(|p| p.get("name").and_then(Value::as_str) == Some(name))
}

/// The organization's current value of a core key, `None` when it has
/// removed it, or `Err` when another layer owns it.
fn current(o: &Ontology, entity: &str, key: &str) -> Result<Option<Value>, ()> {
    let Some(e) = o.entity(entity) else {
        return Err(());
    };
    if key == ENTITY {
        return if kit_declared(e) {
            Err(())
        } else {
            Ok(Some(entity_content(e)))
        };
    }
    let name = key.strip_prefix(PROPERTY).ok_or(())?;
    match property(o, entity, name) {
        Some(p) if foreign_field(p) => Err(()),
        Some(p) => Ok(Some(field_content(p))),
        None => Ok(None),
    }
}

/// Record, for every key of `source` the core owns, how the model differs
/// from it. A key another layer owns keeps whatever override it had.
fn capture(o: &Ontology, source: &Contributions, overrides: &mut Overrides) {
    for (entity, keys) in source {
        for (key, value) in keys {
            let Ok(now) = current(o, entity, key) else {
                continue;
            };
            let delta = diff(Some(value), now.as_ref());
            let entries = overrides.entry(entity.clone()).or_default();
            match delta {
                Some(delta) => {
                    entries.insert(key.clone(), delta);
                }
                None => {
                    entries.remove(key);
                }
            }
        }
    }
    overrides.retain(|_, keys| !keys.is_empty());
}

/// Set every key the core owns to the source with the organization's
/// override on top.
fn compose(o: &mut Ontology, source: &Contributions, overrides: &Overrides) {
    for (entity, keys) in source {
        for (key, value) in keys {
            if current(o, entity, key).is_err() {
                continue;
            }
            let mut effective = Some(value.clone());
            if let Some(delta) = overrides.get(entity).and_then(|o| o.get(key)) {
                apply(&mut effective, delta);
            }
            if key == ENTITY {
                if let Some(attrs) = effective {
                    put_entity(o, entity, attrs);
                }
            } else if let Some(name) = key.strip_prefix(PROPERTY) {
                put_property(o, entity, name, effective);
            }
        }
    }
}

fn put_entity(o: &mut Ontology, entity: &str, attrs: Value) {
    let Ok(e) = o.entity_mut(entity) else { return };
    let mut next = attrs;
    if !next.is_object() {
        return;
    }
    if let Some(properties) = e.get("properties") {
        next["properties"] = properties.clone();
    }
    let runtime: Vec<(String, Value)> = e
        .get("meta")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(k, _)| RUNTIME_META.contains(&k.as_str()))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    if !runtime.is_empty() {
        if !next.get("meta").is_some_and(Value::is_object) {
            next["meta"] = json!({});
        }
        for (k, v) in runtime {
            next["meta"][k] = v;
        }
    }
    *e = next;
}

fn put_property(o: &mut Ontology, entity: &str, name: &str, value: Option<Value>) {
    let Ok(e) = o.entity_mut(entity) else { return };
    if !e.get("properties").is_some_and(Value::is_array) {
        if value.is_none() {
            return;
        }
        e["properties"] = json!([]);
    }
    let list = e["properties"].as_array_mut().expect("made above");
    let at = list
        .iter()
        .position(|p| p.get("name").and_then(Value::as_str) == Some(name));
    match (at, value) {
        (Some(at), Some(mut value)) if value.is_object() => {
            for mark in FIELD_MARKS {
                if let Some(m) = list[at].get(*mark) {
                    value[*mark] = m.clone();
                }
            }
            list[at] = value;
        }
        (Some(at), Some(value)) => list[at] = value,
        (Some(at), None) => {
            list.remove(at);
        }
        (None, Some(value)) => list.push(value),
        (None, None) => {}
    }
}

fn differing(a: &Ontology, b: &Ontology) -> Vec<String> {
    let ids: BTreeSet<&str> = a
        .entities()
        .iter()
        .chain(b.entities())
        .filter_map(|e| e.get("id").and_then(Value::as_str))
        .collect();
    let mut out: Vec<String> = ids
        .into_iter()
        .filter(|id| a.entity(id) != b.entity(id))
        .map(str::to_owned)
        .collect();
    if a.entity_ids() != b.entity_ids() && out.is_empty() {
        out.push("(type order)".into());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain_model::ontology::{FieldEdit, FieldSpec, PRODUCT_MODEL_JSON};

    /// A model stored before the layer existed.
    fn legacy(mut o: Ontology) -> Ontology {
        o.doc.as_object_mut().unwrap().remove(KEY);
        o
    }

    fn field<'a>(o: &'a Ontology, entity: &str, name: &str) -> Option<&'a Value> {
        property(o, entity, name)
    }

    fn set(o: &mut Ontology, entity: &str, name: &str, key: &str, value: Value) {
        let e = o.entity_mut(entity).unwrap();
        let p = e["properties"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|p| p["name"] == name)
            .unwrap();
        p[key] = value;
    }

    /// The next running core: a changed field, a retyped field, a new field,
    /// a dropped field, a renamed type and a new type.
    fn next_core() -> Vec<Value> {
        let mut seed = Ontology::running_core();
        let project = seed.iter_mut().find(|e| e["id"] == "project").unwrap();
        project["name"] = json!("Project (next)");
        let props = project["properties"].as_array_mut().unwrap();
        for p in props.iter_mut() {
            match p["name"].as_str() {
                Some("description") => p["type"] = json!("markdown"),
                Some("key") => p["description"] = json!("The short key, next core"),
                Some("target_at") => p["description"] = json!("When it should land, next core"),
                _ => {}
            }
        }
        props.retain(|p| p["name"] != "started_at");
        props.push(json!({"name": "budget_code", "type": "string", "description": "next"}));
        let mut extra = project.clone();
        extra["id"] = json!("core-next-type");
        extra["name"] = json!("Next Type");
        seed.push(extra);
        seed
    }

    fn entities(o: &Ontology) -> Vec<Value> {
        o.entities().to_vec()
    }

    #[test]
    fn an_untouched_legacy_model_reads_the_same_and_then_takes_core_updates() {
        let mut o = legacy(Ontology::load());
        let before = entities(&o);
        let change = o
            .sync_core_layer(&Ontology::running_core(), &Ontology::running_moves())
            .unwrap()
            .unwrap();
        assert!(change.adopted);
        assert_eq!(change.legacy_overrides, 0);
        assert!(change.updated.is_empty(), "{:?}", change.updated);
        assert_eq!(
            entities(&o),
            before,
            "the migration changes nothing it reads"
        );
        assert!(
            o.sync_core_layer(&Ontology::running_core(), &Ontology::running_moves())
                .unwrap()
                .is_none()
        );

        let change = o
            .sync_core_layer(&next_core(), &BTreeMap::new())
            .unwrap()
            .unwrap();
        assert!(!change.adopted);
        assert!(change.updated.contains(&"project".to_string()));
        assert_eq!(change.released, vec!["project.started_at".to_string()]);
        assert_eq!(o.entity("project").unwrap()["name"], "Project (next)");
        assert_eq!(
            field(&o, "project", "description").unwrap()["type"],
            "markdown"
        );
        assert!(field(&o, "project", "budget_code").is_some());
        assert!(o.has_entity("core-next-type"));
        // Dropped by the core, kept for the objects that carry it.
        assert!(field(&o, "project", "started_at").is_some());
        assert!(
            o.sync_core_layer(&next_core(), &BTreeMap::new())
                .unwrap()
                .is_none(),
            "idempotent"
        );
    }

    #[test]
    fn a_fresh_model_already_stands_on_the_running_core() {
        let mut o = Ontology::load();
        assert!(o.has_core_layer());
        assert!(
            o.sync_core_layer(&Ontology::running_core(), &Ontology::running_moves())
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn legacy_edits_become_the_organization_s_layer_and_survive_upgrades_key_by_key() {
        let mut o = legacy(Ontology::load());
        set(
            &mut o,
            "project",
            "description",
            "description",
            json!("ours"),
        );
        o.entity_mut("project").unwrap()["description"] = json!("our project");
        o.add_field(
            "project",
            FieldSpec {
                name: "cost_center".into(),
                type_name: "string".into(),
                description: None,
                required: false,
            },
        )
        .unwrap();
        let before = entities(&o);
        let change = o
            .sync_core_layer(&Ontology::running_core(), &Ontology::running_moves())
            .unwrap()
            .unwrap();
        assert!(change.adopted);
        assert_eq!(change.legacy_overrides, 2, "the field and the type");
        assert_eq!(
            entities(&o),
            before,
            "equality: the composition is the stored model"
        );

        // After the migration the organization removes a core field.
        o.remove_field("project", "target_at").unwrap();
        o.sync_core_layer(&next_core(), &BTreeMap::new())
            .unwrap()
            .unwrap();
        let description = field(&o, "project", "description").unwrap();
        assert_eq!(description["description"], "ours", "its edit stays");
        assert_eq!(
            description["type"], "markdown",
            "the core's change still arrives"
        );
        let project = o.entity("project").unwrap();
        assert_eq!(project["description"], "our project");
        assert_eq!(project["name"], "Project (next)");
        assert!(
            field(&o, "project", "target_at").is_none(),
            "its removal stays"
        );
        assert!(
            field(&o, "project", "cost_center").is_some(),
            "its own field stays"
        );
        assert_eq!(
            field(&o, "project", "key").unwrap()["description"],
            "The short key, next core"
        );
        let layer: Layer = serde_json::from_value(o.doc[KEY].clone()).unwrap();
        assert!(layer.legacy["project"].contains(ENTITY));
    }

    #[test]
    fn restoring_the_core_value_drops_the_override() {
        let mut o = Ontology::load();
        let original = field(&o, "project", "key").unwrap()["description"]
            .as_str()
            .map(str::to_owned);
        o.edit_field(
            "project",
            "key",
            &FieldEdit {
                description: Some("ours".into()),
                ..FieldEdit::default()
            },
        )
        .unwrap();
        o.edit_field(
            "project",
            "key",
            &FieldEdit {
                description: original,
                ..FieldEdit::default()
            },
        )
        .unwrap();
        o.sync_core_layer(&next_core(), &BTreeMap::new())
            .unwrap()
            .unwrap();
        assert_eq!(
            field(&o, "project", "key").unwrap()["description"],
            "The short key, next core"
        );
    }

    #[test]
    fn a_legacy_removal_of_a_core_field_was_already_undone_and_stays_undone() {
        let mut o = legacy(Ontology::load());
        o.remove_field("project", "key").unwrap();
        let change = o
            .sync_core_layer(&Ontology::running_core(), &Ontology::running_moves())
            .unwrap()
            .unwrap();
        assert!(change.adopted);
        assert_eq!(change.legacy_overrides, 0);
        assert!(field(&o, "project", "key").is_some());
    }

    #[test]
    fn what_kits_and_gears_own_is_left_to_their_layers() {
        let mut o = Ontology::load();
        o.hold("project", "gear-x", &["key".to_string()]).unwrap();
        set(&mut o, "project", "key", "description", json!("the gear's"));
        set(&mut o, "project", "target_at", "origin", json!("kit"));
        set(
            &mut o,
            "project",
            "target_at",
            "kit",
            json!("project-lifecycle"),
        );
        set(
            &mut o,
            "project",
            "target_at",
            "description",
            json!("the kit's"),
        );
        o.sync_core_layer(&next_core(), &BTreeMap::new())
            .unwrap()
            .unwrap();
        assert_eq!(
            field(&o, "project", "key").unwrap()["description"],
            "the gear's"
        );
        assert_eq!(field(&o, "project", "key").unwrap()["held_by"], "gear-x");
        assert_eq!(
            field(&o, "project", "target_at").unwrap()["description"],
            "the kit's"
        );
        // The gear's hold on the type survives the core's change of it.
        assert_eq!(o.entity("project").unwrap()["meta"]["held_by"], "gear-x");
        assert_eq!(o.entity("project").unwrap()["name"], "Project (next)");
    }

    #[test]
    fn an_uploaded_legacy_model_migrates_without_changing_what_it_reads() {
        let mut o =
            Ontology::from_value(serde_json::from_str(PRODUCT_MODEL_JSON).unwrap()).unwrap();
        o.mark_uploaded("product model");
        o.add_studio_types();
        let before = entities(&o);
        let mut moved = o.clone();
        let change = o
            .sync_core_layer(&Ontology::running_core(), &BTreeMap::new())
            .unwrap()
            .unwrap();
        assert!(change.adopted);
        assert_eq!(entities(&o), before);
        // The upload's `report` extends the kit's type (ADR-0070 §7,
        // decision 9): handed over to org-reports, not taken as the core's.
        moved
            .sync_core_layer(&Ontology::running_core(), &Ontology::running_moves())
            .unwrap()
            .unwrap();
        assert_eq!(moved.left_by("report"), Some("org-reports"));
        o.sync_core_layer(&next_core(), &BTreeMap::new())
            .unwrap()
            .unwrap();
        assert!(field(&o, "project", "budget_code").is_some());
    }

    #[test]
    fn an_import_cannot_bring_its_own_core_layer() {
        let trusted = Ontology::load();
        let mut uploaded = Ontology::load();
        uploaded.doc[KEY] = json!({"format": 1, "source": {}, "overrides": {}});
        uploaded.keep_core_layer(&trusted);
        assert_eq!(uploaded.doc[KEY], trusted.doc[KEY]);
        let mut onto_legacy = Ontology::load();
        onto_legacy.keep_core_layer(&legacy(Ontology::load()));
        assert!(!onto_legacy.has_core_layer());
    }

    #[test]
    fn an_unknown_layer_format_is_refused_without_a_change() {
        let mut o = Ontology::load();
        o.doc[KEY]["format"] = json!(2);
        let before = o.document().clone();
        assert!(o.sync_core_layer(&next_core(), &BTreeMap::new()).is_err());
        assert_eq!(o.document(), &before);
    }

    const REPORTS_KIT: &str = include_str!("../kit_registry/builtin/org-reports.kit.json");

    fn reports_overlay() -> crate::domain_model::kit_overlay::KitOverlay {
        let kit: Value = serde_json::from_str(REPORTS_KIT).unwrap();
        serde_json::from_value(kit["model"].clone()).unwrap()
    }

    /// A model from before `report` left the core: the type and the
    /// organization's Reports tab, as the old core wrote them.
    fn with_old_report(mut o: Ontology) -> (Ontology, Vec<Value>) {
        let kit: Value = serde_json::from_str(REPORTS_KIT).unwrap();
        let mut report = kit["model"]["types"][0]["entity"].clone();
        report["meta"]["kit"] = json!("org-reports");
        let tab = json!({"name": "reports", "type": "report", "relation": "report",
            "extends": "edge", "relationType": "shows", "relationLabel": "Reports",
            "description": "A tab of the organization: what it shows."});
        o.entities_mut().unwrap().push(report.clone());
        o.entity_mut("organization").unwrap()["properties"]
            .as_array_mut()
            .unwrap()
            .push(tab.clone());
        let mut old_core = Ontology::running_core();
        old_core.push(report);
        old_core
            .iter_mut()
            .find(|e| e["id"] == "organization")
            .unwrap()["properties"]
            .as_array_mut()
            .unwrap()
            .push(tab);
        (o, old_core)
    }

    #[test]
    fn a_type_that_moved_to_a_kit_is_handed_over_and_the_kit_adopts_it_as_the_organization_had_it()
    {
        use crate::domain_model::kit_overlay::sync;
        let moves = Ontology::running_moves();
        assert_eq!(moves.get("report").map(String::as_str), Some("org-reports"));
        assert!(
            !Ontology::load().has_entity("report"),
            "the core no longer has it"
        );

        // An organization already on the layer, whose old core had `report`;
        // it changed the type's description.
        let (mut layered, old_core) = with_old_report(legacy(Ontology::load()));
        layered
            .sync_core_layer(&old_core, &BTreeMap::new())
            .unwrap();
        layered.entity_mut("report").unwrap()["description"] = json!("ours");
        // And a legacy organization that never had the layer.
        let (legacy_org, _) = with_old_report(legacy(Ontology::load()));

        for mut o in [layered, legacy_org] {
            let change = o
                .sync_core_layer(&Ontology::running_core(), &moves)
                .unwrap()
                .unwrap();
            assert!(
                change
                    .moved
                    .contains(&("report".into(), "org-reports".into()))
            );
            assert_eq!(
                o.left_by("report"),
                Some("org-reports"),
                "dormant until the kit adopts it"
            );
            assert_eq!(
                property(&o, "organization", "reports").unwrap()["left_by"]["kit"],
                "org-reports"
            );
            let fields_before = o.entity("report").unwrap()["properties"].clone();
            let description = o.entity("report").unwrap()["description"].clone();

            sync(
                &mut o,
                "org-reports",
                "1",
                Some(&reports_overlay()),
                &|_| true,
            )
            .unwrap();
            assert_eq!(o.left_by("report"), None, "adopted");
            let report = o.entity("report").unwrap();
            assert_eq!(report["meta"]["origin"], "kit");
            assert_eq!(report["meta"]["kit"], "org-reports");
            assert_eq!(report["meta"]["gts"], "gts.cf.studio.domain.report.v1~");
            assert_eq!(
                report["properties"], fields_before,
                "the organization's fields stay"
            );
            assert_eq!(report["description"], description);
            let tab = property(&o, "organization", "reports").unwrap();
            assert!(tab.get("left_by").is_none());
            assert_eq!(tab["kit"], "org-reports");
            assert_eq!(tab["relationType"], "shows");
            // The next start finds it the kit's and hands nothing over again.
            assert!(
                o.sync_core_layer(&Ontology::running_core(), &moves)
                    .unwrap()
                    .is_none()
            );
        }
    }

    #[test]
    fn what_the_core_dropped_is_left_by_studio_and_a_new_organization_never_has_it() {
        let moves = Ontology::running_moves();
        assert_eq!(
            moves.get("gears").map(String::as_str),
            Some(crate::domain_model::ontology::LEFT_BY_STUDIO)
        );
        assert_eq!(
            moves.get("kit.packages_9").map(String::as_str),
            Some(crate::domain_model::ontology::LEFT_BY_STUDIO)
        );
        let fresh = Ontology::load();
        assert!(!fresh.has_entity("gears"));
        assert!(property(&fresh, "kit", "packages_9").is_none());

        // A legacy organization whose old core had `gears` and the packaging
        // relation to it keeps both, read-only, left by Studio.
        let mut o = legacy(Ontology::load());
        o.doc["entities"].as_array_mut().unwrap().push(json!({
            "id": "gears",
            "name": "Gears",
            "meta": {"kit": null, "retired": true},
            "properties": [{"name": "id", "type": "string"}]
        }));
        o.entity_mut("kit").unwrap()["properties"]
            .as_array_mut()
            .unwrap()
            .push(json!({
                "name": "packages_9", "type": "Gears", "relation": "gears",
                "relationType": "references", "extends": "link"
            }));
        let change = o
            .sync_core_layer(&Ontology::running_core(), &moves)
            .unwrap()
            .unwrap();
        assert!(change.moved.contains(&("gears".into(), "studio".into())));
        assert_eq!(o.left_by("gears"), Some("studio"));
        assert_eq!(
            property(&o, "kit", "packages_9").unwrap()["left_by"]["kit"],
            "studio"
        );
        assert!(
            o.sync_core_layer(&Ontology::running_core(), &moves)
                .unwrap()
                .is_none(),
            "the next start changes nothing"
        );
    }

    #[test]
    fn a_new_organization_gets_the_moved_type_whole_from_its_kit_and_loses_it_with_the_kit() {
        use crate::domain_model::kit_overlay::sync;
        let mut o = Ontology::load();
        sync(
            &mut o,
            "org-reports",
            "1",
            Some(&reports_overlay()),
            &|_| false,
        )
        .unwrap();
        let kit: Value = serde_json::from_str(REPORTS_KIT).unwrap();
        let written = &kit["model"]["types"][0]["entity"];
        let report = o.entity("report").unwrap();
        assert_eq!(report["properties"], written["properties"]);
        assert_eq!(report["bucket"], written["bucket"]);
        assert_eq!(report["meta"]["kit"], "org-reports");
        assert!(property(&o, "organization", "reports").is_some());
        // Without objects, uninstalling takes it away: absent.
        sync(&mut o, "org-reports", "1", None, &|_| false).unwrap();
        assert!(!o.has_entity("report"));
        assert!(property(&o, "organization", "reports").is_none());
    }
}
