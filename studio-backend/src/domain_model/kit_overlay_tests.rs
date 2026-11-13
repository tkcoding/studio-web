use serde_json::{Value, json};

use super::*;

#[test]
fn kits_extend_files_and_leave_the_core_file_when_uninstalled() {
    let mut model = Ontology::load();
    let files = overlay(json!({"types": [{"name": "design-file", "extends": "file",
        "fields": [{"name": "design_tool", "type": "string"}]}]}));
    sync(&mut model, "design", "1", Some(&files), &|_| false).unwrap();
    assert!(
        model
            .ancestors("design-design-file")
            .contains(&"file".to_owned())
    );
    let fields = model.effective_properties("design-design-file");
    assert!(
        fields
            .iter()
            .any(|p| p.name == "media_type" && p.declared_by == "file")
    );
    assert!(fields.iter().any(|p| p.name == "design_tool"));
    sync(&mut model, "design", "1", None, &|_| false).unwrap();
    assert!(model.has_entity("file"));
    assert!(!model.has_entity("design-design-file"));
}

#[test]
fn a_kit_declares_a_type_studio_already_has_and_keeps_its_ids_and_holds() {
    // Issue #1025: a core type moves into the kit that brings its screens.
    let mut o = Ontology::load();
    o.hold("template", "studio-planning", &["name".to_owned()])
        .unwrap();
    let declare = overlay(json!({
        "types": [{"name": "template", "id": "template",
                   "fields": [{"name": "name", "type": "string"},
                              {"name": "phase_gate", "type": "boolean?"}]}]
    }));
    let change = sync(&mut o, SLUG, "1", Some(&declare), &|_| false).unwrap();
    assert!(
        change.added.contains(&"template.phase_gate".to_owned()),
        "{change:?}"
    );
    let m = o.entity("template").unwrap();
    assert_eq!(m["meta"]["kit"], SLUG);
    // The same ids: stored objects keep matching.
    assert_eq!(m["meta"]["gts"], "gts.cf.studio.domain.template.v1~");
    // The gear still holds it, and its own fields stay.
    assert_eq!(m["meta"]["held_by"], "studio-planning");
    assert_eq!(prop(&o, "template", "name").unwrap()["kit"], SLUG);
    assert_eq!(
        prop(&o, "template", "name").unwrap()["held_by"],
        "studio-planning"
    );
    assert!(prop(&o, "template", "status").is_some());
    // A declared field of another type is still a conflict.
    let mut fresh = Ontology::load();
    let retype = overlay(json!({
        "types": [{"name": "template", "id": "template",
                   "fields": [{"name": "name", "type": "integer"}]}]
    }));
    assert!(matches!(
        sync(&mut fresh, SLUG, "1", Some(&retype), &|_| false),
        Err(KitModelError::Conflict(_))
    ));
    // Uninstalled, a held type stays (left by the kit), with what the gear writes.
    let gone = sync(&mut o, SLUG, "1", None, &|_| false).unwrap();
    assert_eq!(gone.kept, ["template".to_owned()]);
    assert!(o.entity("template").is_some());
}

fn overlay(v: Value) -> KitOverlay {
    serde_json::from_value(v).unwrap()
}

fn lifecycle_v1() -> KitOverlay {
    overlay(json!({
        "types": [{"name": "phase", "label": "Phase", "description": "A phase a project moves through",
                   "fields": [{"name": "order", "type": "integer"}]}],
        "fields": [
            {"on": "project", "name": "phase", "type": "idea | discovery | build | run"},
            {"on": "project", "name": "phase_owner", "type": "string?"}
        ],
        "relations": [{"on": "project", "name": "phase_record", "target": "phase"}],
        "tabs": [{"level": "project", "name": "phases", "label": "Phases", "target": "phase"}],
        "lifecycles": [{"on": "project", "field": "phase", "states": ["idea", "discovery", "build", "run"],
                        "initial": "idea",
                        "transitions": [{"name": "discover", "from": ["idea"], "to": "discovery"}]}]
    }))
}

fn prop<'a>(o: &'a Ontology, entity: &str, name: &str) -> Option<&'a Value> {
    o.entity(entity)?
        .get("properties")?
        .as_array()?
        .iter()
        .find(|p| p["name"] == name)
}

const SLUG: &str = "project-lifecycle";
const TYPE: &str = "project-lifecycle-phase";

#[test]
fn installing_adds_what_the_overlay_says_marked_with_the_kit() {
    let mut o = Ontology::load();
    let change = sync(&mut o, SLUG, "1.0.0", Some(&lifecycle_v1()), &|_| false).unwrap();
    assert!(change.added.contains(&format!("type {TYPE}")));
    assert!(change.added.contains(&"project.phase".to_owned()));

    let t = o.entity(TYPE).unwrap();
    assert_eq!(t["meta"]["origin"], "kit");
    assert_eq!(t["meta"]["kit"], SLUG);
    assert_eq!(t["meta"]["kit_version"], "1.0.0");
    assert_eq!(
        t["meta"]["gts"],
        "gts.cf.studio.kit.project_lifecycle.phase.v1~"
    );
    assert_eq!(prop(&o, TYPE, "order").unwrap()["kit"], SLUG);

    let phase = prop(&o, "project", "phase").unwrap();
    assert_eq!(
        (phase["origin"].as_str(), phase["kit"].as_str()),
        (Some("kit"), Some(SLUG))
    );
    let tab = prop(&o, "project", "phases").unwrap();
    assert_eq!(tab["relationType"], "shows");
    assert_eq!(tab["relation"], TYPE);
    let rel = prop(&o, "project", "phase_record").unwrap();
    assert_eq!(rel["relationType"], "references");
    let cycles = o.entity("project").unwrap()["meta"]["lifecycles"].clone();
    assert_eq!(cycles[0]["field"], "phase");
    assert_eq!(cycles[0]["kit"], SLUG);

    assert_eq!(carried(&o).get(SLUG).map(String::as_str), Some("1.0.0"));
    // The same version again changes nothing.
    let again = sync(&mut o, SLUG, "1.0.0", Some(&lifecycle_v1()), &|_| false).unwrap();
    assert!(again.is_empty(), "{again:?}");
}

#[test]
fn uninstalling_removes_what_the_kit_brought_and_keeps_an_inhabited_type() {
    let mut o = Ontology::load();
    let before = o.entity("project").unwrap().clone();
    sync(&mut o, SLUG, "1.0.0", Some(&lifecycle_v1()), &|_| false).unwrap();

    // The type has objects: kept, marked left by the kit, with its fields.
    let gone = sync(&mut o, SLUG, "1.0.0", None, &|id| id == TYPE).unwrap();
    assert_eq!(gone.kept, [TYPE.to_owned()]);
    assert!(gone.removed.contains(&"project.phase".to_owned()));
    assert_eq!(
        o.entity("project").unwrap(),
        &before,
        "the project type is as it was"
    );
    let left = o.entity(TYPE).unwrap();
    assert_eq!(left["meta"]["left_by"]["kit"], SLUG);
    assert_eq!(left["meta"]["left_by"]["version"], "1.0.0");
    assert!(left["meta"].get("kit").is_none());
    assert_eq!(prop(&o, TYPE, "order").unwrap()["left_by"]["kit"], SLUG);
    assert!(!carried(&o).contains_key(SLUG));

    // Installed again, the kit takes its type back.
    let back = sync(&mut o, SLUG, "1.0.0", Some(&lifecycle_v1()), &|_| true).unwrap();
    assert!(back.updated.contains(&format!("type {TYPE}")), "{back:?}");
    assert_eq!(o.entity(TYPE).unwrap()["meta"]["kit"], SLUG);
    assert!(o.entity(TYPE).unwrap()["meta"].get("left_by").is_none());
    assert_eq!(prop(&o, TYPE, "order").unwrap()["kit"], SLUG);

    // With no objects, uninstalling takes the type out too.
    let gone = sync(&mut o, SLUG, "1.0.0", None, &|_| false).unwrap();
    assert!(gone.removed.contains(&format!("type {TYPE}")));
    assert!(o.entity(TYPE).is_none());
    assert_eq!(o.entity("project").unwrap(), &before);
}

#[test]
fn upgrading_applies_the_difference() {
    let mut o = Ontology::load();
    sync(&mut o, SLUG, "1.0.0", Some(&lifecycle_v1()), &|_| false).unwrap();
    let mut v2 = lifecycle_v1();
    v2.fields.retain(|f| f.name != "phase_owner");
    v2.fields.push(OverlayField {
        on: "project".into(),
        name: "phase_since".into(),
        type_name: "timestamp?".into(),
        description: None,
        required: false,
    });
    v2.fields[0].description = Some("Where the project is".into());
    let change = sync(&mut o, SLUG, "2.0.0", Some(&v2), &|_| false).unwrap();
    assert!(change.removed.contains(&"project.phase_owner".to_owned()));
    assert!(change.added.contains(&"project.phase_since".to_owned()));
    assert!(change.updated.contains(&"project.phase".to_owned()));
    assert!(prop(&o, "project", "phase_owner").is_none());
    assert_eq!(
        prop(&o, "project", "phase").unwrap()["kit_version"],
        "2.0.0"
    );
    assert_eq!(carried(&o).get(SLUG).map(String::as_str), Some("2.0.0"));
}

#[test]
fn a_kit_extends_and_never_takes_over() {
    let mut o = Ontology::load();
    let before = o.document().clone();
    // `project.status` is Studio's own.
    let retype =
        overlay(json!({"fields": [{"on": "project", "name": "status", "type": "integer"}]}));
    assert!(matches!(
        sync(&mut o, SLUG, "1", Some(&retype), &|_| false),
        Err(KitModelError::Conflict(_))
    ));
    // Another kit's field is not this one's either.
    sync(
        &mut o,
        "other-kit",
        "1",
        Some(&overlay(json!({
            "fields": [{"on": "project", "name": "phase", "type": "string"}]
        }))),
        &|_| false,
    )
    .unwrap();
    assert!(matches!(
        sync(&mut o, SLUG, "1", Some(&lifecycle_v1()), &|_| false),
        Err(KitModelError::Conflict(_))
    ));
    // Nothing of the refused overlay landed.
    assert!(o.entity(TYPE).is_none());
    // A type nobody has.
    let mut fresh = Ontology::load();
    assert!(matches!(
        sync(
            &mut fresh,
            SLUG,
            "1",
            Some(&overlay(json!({
                "fields": [{"on": "nonesuch", "name": "x", "type": "string"}]
            }))),
            &|_| false
        ),
        Err(KitModelError::Invalid(_))
    ));
    assert_eq!(fresh.document(), &before);
}

#[test]
fn an_overlay_that_does_not_check_is_refused() {
    let bad = |v: Value| validate(SLUG, &overlay(v)).is_err();
    assert!(bad(json!({"types": [{"name": "Phase"}]})));
    assert!(bad(json!({"types": [{"name": "a"}, {"name": "a"}]})));
    assert!(bad(
        json!({"fields": [{"on": "project", "name": "Phase", "type": "x"}]})
    ));
    assert!(bad(
        json!({"fields": [{"on": "project", "name": "a", "type": "x"},
                                  {"on": "project", "name": "a", "type": "y"}]})
    ));
    assert!(bad(
        json!({"relations": [{"on": "project", "name": "a", "target": "team", "verb": "shows"}]})
    ));
    assert!(bad(
        json!({"lifecycles": [{"on": "project", "field": "phase", "states": []}]})
    ));
    assert!(bad(
        json!({"lifecycles": [{"on": "project", "field": "phase", "states": ["a"], "initial": "b"}]})
    ));
    assert!(bad(
        json!({"lifecycles": [{"on": "project", "field": "phase", "states": ["a"],
                                       "transitions": [{"name": "t", "from": ["a"], "to": "z"}]}]})
    ));
    assert!(!bad(json!({})));
    // A kit never holds a type: the format has no way to say it.
    assert!(
        serde_json::from_value::<KitOverlay>(json!({"types": [{"name": "x", "held_by": "g"}]}))
            .is_err()
    );
}

#[test]
fn the_patches_undo_what_they_do() {
    let current = Ontology::load();
    let mut next = current.clone();
    sync(&mut next, SLUG, "1.0.0", Some(&lifecycle_v1()), &|_| false).unwrap();
    // And a removal in the same change: drop a type of the seed.
    let dropped = current.entities()[3]["id"].as_str().unwrap().to_owned();
    next.entities_mut()
        .unwrap()
        .retain(|e| e["id"] != dropped.as_str());

    let (forward, inverse) = entity_patches(current.entities(), next.entities());
    let mut doc = current.document().clone();
    json_patch::patch(
        &mut doc,
        &serde_json::from_value::<json_patch::Patch>(forward).unwrap(),
    )
    .unwrap();
    assert_eq!(&doc, next.document());
    json_patch::patch(
        &mut doc,
        &serde_json::from_value::<json_patch::Patch>(inverse).unwrap(),
    )
    .unwrap();
    assert_eq!(&doc, current.document());
}
