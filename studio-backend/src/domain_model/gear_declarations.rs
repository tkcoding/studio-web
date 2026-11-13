//! Trusted gear requirements, kept separately from kit and organization edits.
//! The effective entity is still projected for the flat-model reader during
//! ADR-0070 phase 2. Later composition consumes the same declarations.

use std::collections::BTreeMap;

use serde_json::{Value, json};

use super::{EntitySpec, FieldSpec, Ontology};
use crate::domain_model::port::TypeNeed;

impl Ontology {
    pub(in crate::domain_model) fn declare_gear_type(
        &mut self,
        need: &TypeNeed,
    ) -> anyhow::Result<bool> {
        anyhow::ensure!(
            !need.declared_by.trim().is_empty() && need.declared_by.trim() == need.declared_by,
            "a type requirement names its declaring gear"
        );
        let mut declarations: BTreeMap<String, BTreeMap<String, TypeNeed>> = self
            .doc
            .get("gear_declarations")
            .cloned()
            .map(serde_json::from_value)
            .transpose()?
            .unwrap_or_default();
        let types = declarations.entry(need.declared_by.clone()).or_default();
        let declaration = match types.get(&need.id) {
            Some(previous) => merged(previous, need),
            None => merged(&TypeNeed::default(), need),
        };
        let declaration_changed = types.get(&need.id) != Some(&declaration);
        types.insert(need.id.clone(), declaration.clone());
        let need = &declaration;
        if let Some(holder) = &need.held_by {
            anyhow::ensure!(
                holder == &need.declared_by,
                "a gear cannot declare another gear's hold"
            );
            if let Some(previous) = self.held_by(&need.id) {
                anyhow::ensure!(
                    previous == holder,
                    "{} is already held by {previous}",
                    need.id
                );
            }
        }

        let mut changed = false;
        if !self.has_entity(&need.id) {
            self.add_entity(EntitySpec {
                id: need.id.clone(),
                name: need.name.clone(),
                description: Some(need.description.clone()).filter(|d| !d.is_empty()),
                extends: need.extends.clone(),
                bucket: need.bucket.clone(),
                origin: Some("gear".into()),
            })?;
            self.entity_mut(&need.id)?["meta"]["declared_by"] = json!(need.declared_by);
            // Ownership is not installation. A gear-only definition must not
            // become a Studio type or claim that its kit is installed.
            // The owner is the seed's annotation, or the kit the type moved
            // to out of the core (ADR-0070 phase 5).
            let owner = Ontology::running_core()
                .iter()
                .find(|e| e.get("id").and_then(Value::as_str) == Some(need.id.as_str()))
                .and_then(|e| e.pointer("/meta/kit"))
                .filter(|v| v.is_string())
                .cloned()
                .or_else(|| {
                    Ontology::running_moves()
                        .get(&need.id)
                        .filter(|k| k.as_str() != crate::domain_model::ontology::LEFT_BY_STUDIO)
                        .map(|k| json!(k))
                });
            if let Some(owner) = owner {
                self.entity_mut(&need.id)?["meta"]["kit"] = owner;
            }
            changed = true;
        }
        let have: Vec<String> = self
            .effective_properties(&need.id)
            .into_iter()
            .map(|p| p.name)
            .collect();
        for (name, type_name, description) in &need.fields {
            if !have.contains(name) {
                self.add_field(
                    &need.id,
                    FieldSpec {
                        name: name.clone(),
                        type_name: type_name.clone(),
                        description: Some(description.clone()).filter(|d| !d.is_empty()),
                        required: false,
                    },
                )?;
                changed = true;
            }
        }
        for (name, target, verb) in &need.relations {
            changed |= self.add_relation(&need.id, name, target, verb)?;
        }
        if let Some(holder) = &need.held_by {
            changed |= self.hold(
                &need.id,
                holder,
                &need.fields.iter().map(|f| f.0.clone()).collect::<Vec<_>>(),
            )?;
            changed |= self.set_searchable(&need.id, need.searchable)?;
        }
        if declaration_changed {
            self.doc["gear_declarations"] = json!(declarations);
        }
        Ok(changed || declaration_changed)
    }
}

/// `ensure_type` is additive: catalogues first declare nodes, then their
/// relations. A later partial call must not erase the earlier requirements.
fn merged(previous: &TypeNeed, next: &TypeNeed) -> TypeNeed {
    let mut result = previous.clone();
    result.id.clone_from(&next.id);
    result.declared_by.clone_from(&next.declared_by);
    if !next.name.is_empty() {
        result.name.clone_from(&next.name);
    }
    if !next.description.is_empty() {
        result.description.clone_from(&next.description);
    }
    if next.extends.is_some() {
        result.extends.clone_from(&next.extends);
    }
    if next.bucket.is_some() {
        result.bucket.clone_from(&next.bucket);
    }
    if next.held_by.is_some() {
        result.held_by.clone_from(&next.held_by);
    }
    result.searchable |= next.searchable;
    let mut fields: BTreeMap<_, _> = result
        .fields
        .into_iter()
        .map(|f| (f.0.clone(), f))
        .collect();
    for field in &next.fields {
        fields.insert(field.0.clone(), field.clone());
    }
    result.fields = fields.into_values().collect();
    let mut relations: BTreeMap<_, _> = result
        .relations
        .into_iter()
        .map(|r| (r.0.clone(), r))
        .collect();
    for relation in &next.relations {
        relations.insert(relation.0.clone(), relation.clone());
    }
    result.relations = relations.into_values().collect();
    result
}
