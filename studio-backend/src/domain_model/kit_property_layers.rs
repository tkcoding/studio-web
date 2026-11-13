//! Kit property sources and the organization's named overrides (ADR-0070 §5).
//! This is the property part of phase 3, not the legacy/core migration.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::Ontology;
use crate::domain_model::kit_overlay::{self, KitModelChange, KitOverlay};

type Contributions = BTreeMap<String, BTreeMap<String, Value>>;
pub(super) type Overrides = BTreeMap<String, BTreeMap<String, Delta>>;
const KEY: &str = "kit_property_layers";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Layer {
    format: u32,
    version: String,
    installed: bool,
    overlay: KitOverlay,
    source: Contributions,
    overrides: Overrides,
}

/// Names, rather than array offsets, identify contributions. A removal is an
/// explicit tombstone, including while a version no longer declares the name.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", content = "value", rename_all = "snake_case")]
pub(super) enum Delta {
    Remove,
    Set(Value),
    Merge(BTreeMap<String, Delta>),
}

impl Ontology {
    pub(in crate::domain_model) fn sync_kit_properties(
        &mut self,
        slug: &str,
        version: &str,
        overlay: Option<&KitOverlay>,
        inhabited: &dyn Fn(&str) -> bool,
    ) -> anyhow::Result<KitModelChange> {
        let mut layers: BTreeMap<String, Layer> = self
            .doc
            .get(KEY)
            .cloned()
            .map(serde_json::from_value)
            .transpose()?
            .unwrap_or_default();
        let previous = layers.get(slug);
        if let Some(layer) = previous {
            anyhow::ensure!(
                layer.format == 1,
                "unsupported kit property layer format for {slug}"
            );
        }
        let carried = kit_overlay::carried(self);
        if previous.is_none()
            && overlay.is_some()
            && let Some(old_version) = carried.get(slug)
        {
            anyhow::ensure!(
                old_version == version,
                "kit {slug} has no property source for {old_version}; reconcile its pinned {old_version} manifest before upgrading to {version}"
            );
        }

        // Work on a copy: invalid overlays, collisions and unknown formats
        // cannot leave a partial source or partial organization edit behind.
        let mut next = self.clone();
        let mut overrides = previous.map(|l| l.overrides.clone()).unwrap_or_default();
        if let Some(layer) = previous.filter(|l| l.installed) {
            capture_overrides(self, &layer.source, &mut overrides);
            // Rebase the kit's source, not the customized effective property.
            // Otherwise an imported property without origin marks conflicts
            // with the very source it extends.
            for (entity, entries) in &layer.source {
                for (key, source) in entries {
                    if let Some(current) = contribution(self, entity, key)
                        && let Some(owner) = current.get("kit").and_then(Value::as_str)
                    {
                        anyhow::ensure!(owner == slug, "{entity}.{key} belongs to kit {owner}");
                    }
                    if !contribution(self, entity, key).is_some_and(held) {
                        put(&mut next, entity, key, Some(source.clone()));
                    }
                }
            }
        }
        let mut change = kit_overlay::sync(&mut next, slug, version, overlay, inhabited)?;
        if previous.is_none() && overlay.is_none() {
            *self = next;
            return Ok(change);
        }
        let mut layer = previous.cloned().unwrap_or_else(|| Layer {
            format: 1,
            version: version.into(),
            installed: false,
            overlay: KitOverlay::default(),
            source: Contributions::new(),
            overrides: Overrides::new(),
        });
        if let Some(overlay) = overlay {
            let source = snapshot(&next, slug);
            if previous.is_none() && carried.contains_key(slug) {
                // A known, same-version flat source can be adopted without
                // changing its effective properties. No historical source is
                // guessed when the versions differ.
                capture_overrides(self, &source, &mut overrides);
            }
            layer.version = version.into();
            layer.overlay = overlay.clone();
            layer.source = source;
        }
        apply_overrides(&mut next, slug, &overrides);
        if previous.is_none() && carried.contains_key(slug) && overlay.is_some() {
            let changed: Vec<_> = self
                .entities()
                .iter()
                .chain(next.entities())
                .filter_map(|e| e.get("id").and_then(Value::as_str))
                .filter(|id| self.entity(id) != next.entity(id))
                .collect::<std::collections::BTreeSet<_>>()
                .into_iter()
                .take(8)
                .collect();
            anyhow::ensure!(
                changed.is_empty(),
                "kit {slug} property-source adoption would change effective types {changed:?}; retained the legacy model; reconcile the exact pinned manifest and preserve entity overrides before retrying"
            );
        }
        layer.installed = overlay.is_some();
        layer.overrides = overrides;
        layers.insert(slug.into(), layer);
        next.doc[KEY] = json!(layers);
        // Report effective changes: a masked addition must not be described
        // as a field that was actually installed for the organization.
        let changed = |name: &String| reported(self, name) != reported(&next, name);
        change.added.retain(&changed);
        change.updated.retain(&changed);
        change.removed.retain(&changed);
        // A metadata-only adoption still needs one persisted, reversible head.
        if next.document() != self.document() && change.is_empty() {
            change.updated.push(format!("kit {slug} property layer"));
        }
        if next.document() == self.document() {
            return Ok(KitModelChange::default());
        }
        *self = next;
        Ok(change)
    }

    pub(in crate::domain_model) fn keep_kit_property_sources(&mut self, current: &Self) {
        if let Some(sources) = current.doc.get(KEY) {
            self.doc[KEY] = sources.clone();
        } else if let Some(doc) = self.doc.as_object_mut() {
            doc.remove(KEY);
        }
    }

    pub(in crate::domain_model) fn property_layer_versions(&self) -> BTreeMap<String, String> {
        self.doc
            .get(KEY)
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .filter(|(_, l)| l.get("installed").and_then(Value::as_bool) == Some(true))
            .filter_map(|(slug, l)| Some((slug.clone(), l.get("version")?.as_str()?.into())))
            .collect()
    }
}

const MARKS: &[&str] = &["origin", "kit", "kit_version", "left_by", "held_by"];

fn reported<'a>(o: &'a Ontology, name: &str) -> Option<&'a Value> {
    if let Some(id) = name.strip_prefix("type ") {
        return o.entity(id);
    }
    if name.starts_with("kit ") {
        return Some(o.document());
    }
    let (kind, name) = name
        .strip_prefix("lifecycle ")
        .map_or(("property", name), |n| ("lifecycle", n));
    let (entity, field) = name.split_once('.')?;
    contribution(o, entity, &format!("{kind}:{field}"))
}

fn content(value: &Value) -> Value {
    let mut value = value.clone();
    if let Some(object) = value.as_object_mut() {
        for key in MARKS {
            object.remove(*key);
        }
    }
    value
}

fn held(value: &Value) -> bool {
    value.get("held_by").is_some()
}

fn contribution<'a>(o: &'a Ontology, entity: &str, key: &str) -> Option<&'a Value> {
    let (kind, name) = key.split_once(':')?;
    let e = o.entity(entity)?;
    let (path, name_key) = match kind {
        "property" => ("/properties", "name"),
        "lifecycle" => ("/meta/lifecycles", "field"),
        _ => return None,
    };
    e.pointer(path)?
        .as_array()?
        .iter()
        .find(|p| p.get(name_key).and_then(Value::as_str) == Some(name))
}

fn put(o: &mut Ontology, entity: &str, key: &str, value: Option<Value>) {
    let Some((kind, name)) = key.split_once(':') else {
        return;
    };
    let Ok(e) = o.entity_mut(entity) else { return };
    let (list, name_key) = match kind {
        "property" => (&mut e["properties"], "name"),
        "lifecycle" => {
            if !e.get("meta").is_some_and(Value::is_object) {
                e["meta"] = json!({});
            }
            (&mut e["meta"]["lifecycles"], "field")
        }
        _ => return,
    };
    if !list.is_array() {
        *list = json!([]);
    }
    let list = list.as_array_mut().expect("made above");
    let at = list
        .iter()
        .position(|p| p.get(name_key).and_then(Value::as_str) == Some(name));
    match (at, value) {
        (Some(at), Some(value)) => list[at] = value,
        (Some(at), None) => {
            list.remove(at);
        }
        (None, Some(value)) => list.push(value),
        (None, None) => {}
    }
}

fn apply_overrides(o: &mut Ontology, slug: &str, overrides: &Overrides) {
    for (entity, entries) in overrides {
        for (key, delta) in entries {
            let Some(value) = contribution(o, entity, key).cloned() else {
                continue;
            };
            let owned = value.get("kit").and_then(Value::as_str) == Some(slug)
                || value.pointer("/left_by/kit").and_then(Value::as_str) == Some(slug);
            if !owned || held(&value) {
                continue;
            }
            let mut effective = Some(content(&value));
            apply(&mut effective, delta);
            let effective = effective.map(|mut v| {
                for mark in MARKS {
                    if let Some(mark_value) = value.get(*mark) {
                        v[*mark] = mark_value.clone();
                    }
                }
                v
            });
            put(o, entity, key, effective);
        }
    }
}

fn snapshot(o: &Ontology, slug: &str) -> Contributions {
    let mut out = Contributions::new();
    for e in o.entities() {
        let Some(id) = e.get("id").and_then(Value::as_str) else {
            continue;
        };
        for (kind, path, name_key) in [
            ("property", "/properties", "name"),
            ("lifecycle", "/meta/lifecycles", "field"),
        ] {
            for p in e
                .pointer(path)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if p.get("origin").and_then(Value::as_str) == Some("kit")
                    && p.get("kit").and_then(Value::as_str) == Some(slug)
                    && let Some(name) = p.get(name_key).and_then(Value::as_str)
                {
                    out.entry(id.into())
                        .or_default()
                        .insert(format!("{kind}:{name}"), p.clone());
                }
            }
        }
    }
    out
}

fn capture_overrides(o: &Ontology, source: &Contributions, overrides: &mut Overrides) {
    for (entity, entries) in source {
        for (key, value) in entries {
            let current = contribution(o, entity, key).map(content);
            let changes = diff(Some(&content(value)), current.as_ref());
            let entries = overrides.entry(entity.clone()).or_default();
            if let Some(changes) = changes {
                entries.insert(key.clone(), changes);
            } else {
                entries.remove(key);
            }
        }
    }
    overrides.retain(|_, entries| !entries.is_empty());
}

pub(super) fn diff(base: Option<&Value>, current: Option<&Value>) -> Option<Delta> {
    if base == current {
        return None;
    }
    match (base, current) {
        (_, None) => Some(Delta::Remove),
        (Some(Value::Object(base)), Some(Value::Object(current))) => {
            let keys: std::collections::BTreeSet<_> = base.keys().chain(current.keys()).collect();
            Some(Delta::Merge(
                keys.into_iter()
                    .filter_map(|key| {
                        diff(base.get(key), current.get(key)).map(|d| (key.clone(), d))
                    })
                    .collect(),
            ))
        }
        (_, Some(current)) => Some(Delta::Set(current.clone())),
    }
}

pub(super) fn apply(value: &mut Option<Value>, delta: &Delta) {
    match delta {
        Delta::Remove => *value = None,
        Delta::Set(next) => *value = Some(next.clone()),
        Delta::Merge(entries) => {
            let value = value.get_or_insert_with(|| json!({}));
            if !value.is_object() {
                *value = json!({});
            }
            let object = value.as_object_mut().expect("made above");
            for (key, delta) in entries {
                let mut entry = object.remove(key);
                apply(&mut entry, delta);
                if let Some(entry) = entry {
                    object.insert(key.clone(), entry);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    fn overlay(extra: bool) -> KitOverlay {
        let mut value = json!({"fields": [
            {"on": "project", "name": "effort", "type": "integer", "description": "Kit default"},
            {"on": "project", "name": "lead", "type": "string"}
        ], "tabs": [{"level": "project", "name": "effort_tab", "label": "Effort", "target": "project"}]});
        if extra {
            value["fields"]
                .as_array_mut()
                .unwrap()
                .push(json!({"on":"project", "name":"budget", "type":"integer"}));
        }
        serde_json::from_value(value).unwrap()
    }

    fn sync(o: &mut Ontology, version: &str, overlay: Option<&KitOverlay>) -> KitModelChange {
        o.sync_kit_properties("effort", version, overlay, &|_| false)
            .unwrap()
    }

    #[test]
    fn named_tombstones_and_partial_edits_survive_upgrade_and_new_source_fields_arrive() {
        let mut o = Ontology::load();
        sync(&mut o, "1", Some(&overlay(false)));
        put(&mut o, "project", "property:lead", None);
        put(&mut o, "project", "property:effort_tab", None);
        let props = o.entity_mut("project").unwrap()["properties"]
            .as_array_mut()
            .unwrap();
        let effort = props.iter_mut().find(|p| p["name"] == "effort").unwrap();
        effort["description"] = json!("Organization wording");
        let mut v2 = overlay(true);
        v2.fields[0].type_name = "number".into();
        sync(&mut o, "2", Some(&v2));
        assert!(contribution(&o, "project", "property:lead").is_none());
        assert!(contribution(&o, "project", "property:effort_tab").is_none());
        let effort = contribution(&o, "project", "property:effort").unwrap();
        assert_eq!(effort["description"], "Organization wording");
        assert_eq!(effort["type"], "number");
        assert_eq!(effort["kit_version"], "2");
        assert!(contribution(&o, "project", "property:budget").is_some());
        let before = o.document().clone();
        assert!(sync(&mut o, "2", Some(&v2)).is_empty());
        assert_eq!(*o.document(), before);
    }

    #[test]
    fn removals_survive_a_source_gap_uninstall_and_a_process_restart() {
        let mut o = Ontology::load();
        sync(&mut o, "1", Some(&overlay(false)));
        put(&mut o, "project", "property:lead", None);
        let mut gap = overlay(false);
        gap.fields.retain(|f| f.name != "lead");
        sync(&mut o, "2", Some(&gap));
        sync(&mut o, "2", None);
        let entities = o.entities().to_vec();
        o = Ontology::from_parts(o.model_document(), entities).unwrap();
        sync(&mut o, "3", Some(&overlay(true)));
        assert!(contribution(&o, "project", "property:lead").is_none());
        assert!(contribution(&o, "project", "property:budget").is_some());
    }

    #[test]
    fn an_organization_can_restore_the_source_value_and_drop_its_override() {
        let mut o = Ontology::load();
        sync(&mut o, "1", Some(&overlay(false)));
        let original = contribution(&o, "project", "property:effort")
            .unwrap()
            .clone();
        put(&mut o, "project", "property:effort", None);
        sync(&mut o, "1", Some(&overlay(false)));
        put(&mut o, "project", "property:effort", Some(original));
        sync(&mut o, "1", Some(&overlay(false)));
        assert!(
            o.doc[KEY]["effort"]["overrides"]
                .as_object()
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn a_same_version_legacy_source_is_adopted_without_changing_the_model() {
        let mut o = Ontology::load();
        kit_overlay::sync(&mut o, "effort", "1", Some(&overlay(false)), &|_| false).unwrap();
        put(&mut o, "project", "property:lead", None);
        let before = o.entities().to_vec();
        sync(&mut o, "1", Some(&overlay(false)));
        assert_eq!(o.entities(), before);
        sync(&mut o, "2", Some(&overlay(true)));
        assert!(contribution(&o, "project", "property:lead").is_none());
    }

    #[test]
    fn an_unknown_legacy_source_cannot_be_guessed_from_the_new_version() {
        let mut o = Ontology::load();
        kit_overlay::sync(&mut o, "effort", "1", Some(&overlay(false)), &|_| false).unwrap();
        let before = o.document().clone();
        let error = o
            .sync_kit_properties("effort", "2", Some(&overlay(true)), &|_| false)
            .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("reconcile its pinned 1 manifest")
        );
        assert_eq!(o.document(), &before);
    }

    #[test]
    fn legacy_adoption_aborts_atomically_if_entity_overrides_cannot_be_represented() {
        let mut o = Ontology::load();
        let source =
            serde_json::from_value(json!({"types":[{"name":"record", "label":"Kit record"}]}))
                .unwrap();
        kit_overlay::sync(&mut o, "effort", "1", Some(&source), &|_| false).unwrap();
        o.entity_mut("effort-record").unwrap()["name"] = json!("Organization name");
        let before = o.document().clone();
        let error = o
            .sync_kit_properties("effort", "1", Some(&source), &|_| false)
            .unwrap_err();
        assert!(error.to_string().contains("effort-record"));
        assert!(error.to_string().contains("retained the legacy model"));
        assert_eq!(o.document(), &before);
    }

    #[test]
    fn all_removed_properties_still_have_an_installed_source_and_uninstall_really_removes_it() {
        let mut o = Ontology::load();
        sync(&mut o, "1", Some(&overlay(false)));
        for name in ["lead", "effort", "effort_tab"] {
            put(&mut o, "project", &format!("property:{name}"), None);
        }
        sync(&mut o, "1", Some(&overlay(false)));
        assert_eq!(kit_overlay::carried(&o)["effort"], "1");
        sync(&mut o, "1", None);
        assert!(!kit_overlay::carried(&o).contains_key("effort"));
    }

    #[test]
    fn unknown_formats_and_cross_kit_conflicts_are_atomic() {
        let mut o = Ontology::load();
        sync(&mut o, "1", Some(&overlay(false)));
        let p = o.entity_mut("project").unwrap()["properties"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|p| p["name"] == "effort")
            .unwrap();
        p["kit"] = json!("other");
        let before = o.document().clone();
        assert!(
            o.sync_kit_properties("effort", "2", Some(&overlay(true)), &|_| false)
                .is_err()
        );
        assert_eq!(o.document(), &before);
        o.doc[KEY]["effort"]["format"] = json!(2);
        let before = o.document().clone();
        assert!(
            o.sync_kit_properties("effort", "2", Some(&overlay(true)), &|_| false)
                .is_err()
        );
        assert_eq!(o.document(), &before);
    }

    #[test]
    fn imported_changes_extend_trusted_sources_and_cannot_replace_their_provenance() {
        let mut current = Ontology::load();
        sync(&mut current, "1", Some(&overlay(false)));
        let mut imported = current.clone();
        imported.doc[KEY] = json!({"forged": {"installed": true}});
        imported.keep_kit_property_sources(&current);
        let mut value = content(contribution(&current, "project", "property:effort").unwrap());
        value["description"] = json!("Imported explanation");
        put(&mut imported, "project", "property:effort", Some(value));
        sync(&mut imported, "2", Some(&overlay(true)));
        let effort = contribution(&imported, "project", "property:effort").unwrap();
        assert_eq!(effort["description"], "Imported explanation");
        assert_eq!(effort["kit"], "effort");
        assert_eq!(effort["kit_version"], "2");
        assert!(imported.doc[KEY].get("forged").is_none());
    }

    #[test]
    fn lifecycle_removals_and_custom_extensions_remain_separate_from_the_kit_source() {
        let mut o = Ontology::load();
        let mut source = overlay(false);
        source.lifecycles = serde_json::from_value(json!([{"on":"project", "field":"lead", "states":["a","b"], "initial":"a", "transitions":[]}])).unwrap();
        sync(&mut o, "1", Some(&source));
        put(&mut o, "project", "lifecycle:lead", None);
        put(
            &mut o,
            "project",
            "property:organization_note",
            Some(json!({"name":"organization_note", "type":"string"})),
        );
        sync(&mut o, "2", Some(&source));
        assert!(contribution(&o, "project", "lifecycle:lead").is_none());
        assert!(contribution(&o, "project", "property:organization_note").is_some());
        assert!(
            o.doc[KEY]["effort"]["source"]["project"]
                .get("property:organization_note")
                .is_none()
        );
    }

    #[test]
    fn an_inhabited_dormant_type_keeps_organization_removals_while_held_fields_remain() {
        let mut o = Ontology::load();
        let source = serde_json::from_value(json!({"types":[{"name":"record", "fields":[
            {"name":"value", "type":"string"}, {"name":"key", "type":"string"}]}]}))
        .unwrap();
        sync(&mut o, "1", Some(&source));
        o.hold("effort-record", "studio-test", &["key".into()])
            .unwrap();
        put(&mut o, "effort-record", "property:value", None);
        o.sync_kit_properties("effort", "1", None, &|_| true)
            .unwrap();
        assert!(
            o.entity("effort-record")
                .unwrap()
                .pointer("/meta/left_by")
                .is_some()
        );
        assert!(contribution(&o, "effort-record", "property:value").is_none());
        assert!(contribution(&o, "effort-record", "property:key").is_some_and(held));
        sync(&mut o, "2", Some(&source));
        assert!(contribution(&o, "effort-record", "property:value").is_none());
        assert!(contribution(&o, "effort-record", "property:key").is_some_and(held));
    }
}
