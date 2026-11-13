//! A gear's type stays the gear's, and stays extensible: an administrator adds
//! fields beside the gear's, people fill them in, and the gear's next write
//! keeps them; the gear's own fields cannot be renamed, dropped or set from
//! outside.

#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::sync::Arc;

use serde_json::{Map, Value, json};
use toolkit_security::SecurityContext;
use uuid::Uuid;

use super::ontology::{FieldEdit, FieldSpec};
use super::port::{DomainObjects, Objects, OwnedObject, TypeNeed};
use super::service::DomainModelService;
use super::store::InMemoryDomainStore;
use super::validate::ValidateMode;

fn ctx() -> SecurityContext {
    SecurityContext::builder()
        .subject_id(Uuid::from_u128(1))
        .subject_tenant_id(Uuid::from_u128(7))
        .token_scopes(vec!["*".to_string()])
        .build()
        .expect("test security context")
}

fn need() -> TypeNeed {
    TypeNeed {
        declared_by: "studio-test".to_owned(),
        id: "test-environment".into(),
        name: "Test Environment".into(),
        description: "A gear's record.".into(),
        extends: Some("record".into()),
        bucket: Some("operations".into()),
        fields: vec![("namespace".into(), "string".into(), String::new())],
        relations: Vec::new(),
        held_by: Some("studio-test".into()),
        searchable: false,
    }
}

#[tokio::test]
async fn a_gear_declaration_is_persisted_separately_and_repeated_calls_write_nothing() {
    let store = Arc::new(InMemoryDomainStore::default());
    let service = Arc::new(DomainModelService::new(store.clone()));
    let port = Objects(service.clone());
    port.ensure_type(&ctx(), &need()).await.unwrap();
    let before = service.ontology_document(&ctx()).await.unwrap();
    let revisions = service.revisions(&ctx()).await.unwrap().len();
    port.ensure_type(&ctx(), &need()).await.unwrap();
    assert_eq!(service.revisions(&ctx()).await.unwrap().len(), revisions);
    let restored = DomainModelService::new(store)
        .ontology_document(&ctx())
        .await
        .unwrap();
    assert_eq!(restored, before);
    assert_eq!(
        restored["gear_declarations"]["studio-test"]["test-environment"]["held_by"],
        "studio-test"
    );
    let entity = restored["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == "test-environment")
        .unwrap();
    assert_eq!(entity["meta"]["origin"], "gear");
}

#[tokio::test]
async fn declaring_an_existing_open_type_keeps_its_effective_definition() {
    let service = Arc::new(DomainModelService::new(Arc::new(
        InMemoryDomainStore::default(),
    )));
    let port = Objects(service.clone());
    let before = service.ontology_document(&ctx()).await.unwrap();
    let open = TypeNeed {
        declared_by: "studio-open".into(),
        id: "project".into(),
        ..Default::default()
    };
    port.ensure_type(&ctx(), &open).await.unwrap();
    let after = service.ontology_document(&ctx()).await.unwrap();
    assert_eq!(before["entities"], after["entities"]);
    assert!(after["gear_declarations"]["studio-open"]["project"]["held_by"].is_null());
    let revisions = service.revisions(&ctx()).await.unwrap().len();
    port.ensure_type(&ctx(), &open).await.unwrap();
    assert_eq!(service.revisions(&ctx()).await.unwrap().len(), revisions);
}

#[tokio::test]
async fn a_different_gear_cannot_take_over_the_holder_or_its_fields() {
    let (service, port, _) = rig().await;
    let before = service.ontology_document(&ctx()).await.unwrap();
    let other = TypeNeed {
        declared_by: "studio-other".into(),
        held_by: Some("studio-other".into()),
        ..need()
    };
    assert!(
        port.ensure_type(&ctx(), &other)
            .await
            .unwrap_err()
            .to_string()
            .contains("already held")
    );
    assert_eq!(service.ontology_document(&ctx()).await.unwrap(), before);
}

#[tokio::test]
async fn a_kit_and_gear_keep_separate_declarations_through_uninstall_and_sync() {
    let (service, port, _) = rig().await;
    let overlay = serde_json::from_value(
        json!({"types":[{"name":"environment", "id":"test-environment",
        "fields":[{"name":"namespace", "type":"string"}]}]}),
    )
    .unwrap();
    service
        .sync_kit_model(&ctx(), "test-kit", "1", Some(&overlay))
        .await
        .unwrap();
    port.ensure_type(&ctx(), &need()).await.unwrap();
    service
        .sync_kit_model(&ctx(), "test-kit", "1", None)
        .await
        .unwrap();
    let before = service.ontology_document(&ctx()).await.unwrap();
    port.ensure_type(&ctx(), &need()).await.unwrap();
    let after = service.ontology_document(&ctx()).await.unwrap();
    assert_eq!(
        before, after,
        "a sync does not reinstall or clear the dormant mark"
    );
    let entity = after["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == "test-environment")
        .unwrap();
    assert_eq!(entity["meta"]["left_by"]["kit"], "test-kit");
    assert_eq!(entity["meta"]["held_by"], "studio-test");
    port.put_objects(
        &ctx(),
        "test-environment",
        vec![OwnedObject {
            id: "env-2".into(),
            scope: String::new(),
            payload: json!({"namespace":"staging"}),
        }],
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn an_import_cannot_replace_trusted_gear_requirements() {
    let (service, _, _) = rig().await;
    let mut imported = super::ontology::Ontology::load().document().clone();
    imported["gear_declarations"] = json!({"forged": {"type": {"held_by":"forged"}}});
    service.import_model(&ctx(), imported).await.unwrap();
    let after = service.ontology_document(&ctx()).await.unwrap();
    assert!(after["gear_declarations"].get("forged").is_none());
    assert_eq!(
        after["gear_declarations"]["studio-test"]["test-environment"]["held_by"],
        "studio-test"
    );
}

#[tokio::test]
async fn an_open_gear_type_can_be_written_after_uninstall_without_reinstalling_its_kit() {
    let service = Arc::new(DomainModelService::new(Arc::new(
        InMemoryDomainStore::default(),
    )));
    let port = Objects(service.clone());
    let open = TypeNeed {
        declared_by: "studio-artifact-ingest".into(),
        id: "work-item".into(),
        name: "Work Item".into(),
        extends: Some("managed-object".into()),
        fields: vec![("sync_marker".into(), "string".into(), String::new())],
        ..Default::default()
    };
    port.ensure_type(&ctx(), &open).await.unwrap();
    let overlay =
        serde_json::from_value(json!({"types":[{"name":"work-item", "id":"work-item"}]})).unwrap();
    service
        .sync_kit_model(&ctx(), "project-issues", "1", Some(&overlay))
        .await
        .unwrap();
    service
        .sync_kit_model(&ctx(), "project-issues", "1", None)
        .await
        .unwrap();
    port.ensure_type(&ctx(), &open).await.unwrap();
    assert!(service.kit_models(&ctx()).await.unwrap().is_empty());
    let doc = service.ontology_document(&ctx()).await.unwrap();
    let entity = doc["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == "work-item")
        .unwrap();
    assert_eq!(entity["meta"]["origin"], "gear");
    assert_eq!(entity["meta"]["kit"], "project-issues");
    assert!(entity["meta"].get("held_by").is_none());
    port.put_objects(
        &ctx(),
        "work-item",
        vec![OwnedObject {
            id: "source-1".into(),
            scope: String::new(),
            payload: json!({"sync_marker":"fresh"}),
        }],
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn a_partial_declaration_does_not_erase_previously_declared_relations() {
    let (service, port, _) = rig().await;
    let full = TypeNeed {
        relations: vec![("for_project".into(), "project".into(), "references".into())],
        ..need()
    };
    port.ensure_type(&ctx(), &full).await.unwrap();
    let before = service.ontology_document(&ctx()).await.unwrap();
    port.ensure_type(&ctx(), &need()).await.unwrap();
    assert_eq!(service.ontology_document(&ctx()).await.unwrap(), before);
}

async fn rig() -> (Arc<DomainModelService>, Objects, String) {
    let service = Arc::new(DomainModelService::new(Arc::new(
        InMemoryDomainStore::default(),
    )));
    let port = Objects(Arc::clone(&service));
    port.ensure_type(&ctx(), &need()).await.unwrap();
    port.put_objects(
        &ctx(),
        "test-environment",
        vec![OwnedObject {
            id: "env-1".into(),
            scope: String::new(),
            payload: json!({"namespace": "dev"}),
        }],
    )
    .await
    .unwrap();
    let (rows, _) = port
        .query(&ctx(), json!({"type": "test-environment"}))
        .await
        .unwrap();
    let id = rows[0].instance_id.clone();
    (service, port, id)
}

fn set(field: &str, value: Value) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert(field.into(), value);
    m
}

#[tokio::test]
async fn an_added_field_is_filled_in_by_people_and_kept_by_the_gears_next_write() {
    let (service, port, id) = rig().await;
    service
        .add_field(
            &ctx(),
            "test-environment",
            FieldSpec {
                name: "owner".into(),
                type_name: "string?".into(),
                description: None,
                required: false,
            },
        )
        .await
        .unwrap();
    service
        .patch_object(
            &ctx(),
            &id,
            set("owner", json!("Ann")),
            &[],
            ValidateMode::Warn,
        )
        .await
        .unwrap();

    // The gear writes its record again, knowing nothing of `owner`.
    port.put_objects(
        &ctx(),
        "test-environment",
        vec![OwnedObject {
            id: "env-1".into(),
            scope: String::new(),
            payload: json!({"namespace": "prod"}),
        }],
    )
    .await
    .unwrap();
    let (rows, _) = port
        .query(&ctx(), json!({"type": "test-environment"}))
        .await
        .unwrap();
    assert_eq!(rows[0].payload["namespace"], "prod");
    assert_eq!(
        rows[0].payload["owner"], "Ann",
        "the person's value survives"
    );
}

#[tokio::test]
async fn the_gears_own_fields_are_not_changed_from_outside() {
    let (service, _, id) = rig().await;
    let e = service
        .patch_object(
            &ctx(),
            &id,
            set("namespace", json!("x")),
            &[],
            ValidateMode::Warn,
        )
        .await
        .unwrap_err();
    assert!(e.to_string().contains("kept by studio-test"), "{e}");

    let e = service
        .remove_field(&ctx(), "test-environment", "namespace")
        .await
        .unwrap_err();
    assert!(e.to_string().contains("written by studio-test"), "{e}");
    let e = service
        .edit_field(
            &ctx(),
            "test-environment",
            "namespace",
            FieldEdit {
                rename_to: Some("ns".into()),
                ..FieldEdit::default()
            },
            true,
        )
        .await
        .unwrap_err();
    assert!(e.to_string().contains("written by studio-test"), "{e}");
}

#[tokio::test]
async fn a_revert_never_takes_a_gears_type_away() {
    let (service, port, _) = rig().await;
    let revisions = service.revisions(&ctx()).await.unwrap();
    let created = revisions
        .iter()
        .filter(|r| r.target == "test-environment")
        .map(|r| r.version)
        .min()
        .expect("the gear's type was recorded");
    service.revert(&ctx(), created - 1).await.unwrap();

    let (rows, _) = port
        .query(
            &ctx(),
            json!({"type": "test-environment", "where": {"namespace": {"_eq": "dev"}}}),
        )
        .await
        .unwrap();
    assert_eq!(
        rows.len(),
        1,
        "the type, its field and its records are still there"
    );
    let e = service
        .remove_field(&ctx(), "test-environment", "namespace")
        .await
        .unwrap_err();
    assert!(
        e.to_string().contains("written by studio-test"),
        "still held: {e}"
    );
}

#[tokio::test]
async fn concurrent_cold_declarations_write_one_version() {
    // What one declaration writes, for comparison.
    let alone = Arc::new(DomainModelService::new(Arc::new(
        InMemoryDomainStore::default(),
    )));
    Objects(alone.clone())
        .ensure_type(&ctx(), &need())
        .await
        .unwrap();
    let expected = alone.revisions(&ctx()).await.unwrap().len();

    let service = Arc::new(DomainModelService::new(Arc::new(
        InMemoryDomainStore::default(),
    )));
    let calls = (0..16).map(|_| {
        let port = Objects(service.clone());
        async move { port.ensure_type(&ctx(), &need()).await }
    });
    for result in futures_util::future::join_all(calls).await {
        result.unwrap();
    }
    assert_eq!(service.revisions(&ctx()).await.unwrap().len(), expected);
}

#[tokio::test]
async fn a_type_its_kit_left_keeps_its_objects_read_only_and_out_of_the_installed_model() {
    use super::access::{AccessError, access_error};
    use super::ontology::Ontology;
    use super::service::WriteOptions;

    let service = Arc::new(DomainModelService::new(Arc::new(
        InMemoryDomainStore::default(),
    )));
    let notes = serde_json::from_value(json!({
        "types": [{"name": "note", "fields": [{"name": "text", "type": "string"}]}],
        "fields": [{"on": "project", "name": "note_count", "type": "integer?"}]
    }))
    .unwrap();
    service
        .sync_kit_model(&ctx(), "team-notes", "1", Some(&notes))
        .await
        .unwrap();
    let written = WriteOptions {
        validate: ValidateMode::Off,
        ..Default::default()
    };
    let id = service
        .create_object(
            &ctx(),
            "team-notes-note",
            "n1",
            written,
            json!({"text": "kept"}),
        )
        .await
        .unwrap()
        .instance_id;
    assert_eq!(
        service
            .dormant_kit(&ctx(), "team-notes-note")
            .await
            .unwrap(),
        None
    );

    // Uninstalled with an object of the type: dormant, not absent.
    let gone = service
        .sync_kit_model(&ctx(), "team-notes", "1", None)
        .await
        .unwrap();
    assert_eq!(gone.kept, ["team-notes-note".to_owned()]);
    assert_eq!(
        service
            .dormant_kit(&ctx(), "team-notes-note")
            .await
            .unwrap()
            .as_deref(),
        Some("team-notes")
    );

    // People cannot write it any more: not a new object, not a change, not a
    // deletion. The refusal names the kit.
    let written = WriteOptions {
        validate: ValidateMode::Off,
        ..Default::default()
    };
    let refused = service
        .create_object(
            &ctx(),
            "team-notes-note",
            "n2",
            written,
            json!({"text": "new"}),
        )
        .await
        .unwrap_err();
    assert!(matches!(
        access_error(&refused),
        Some(AccessError::Dormant { kit, .. }) if kit == "team-notes"
    ));
    let mut set = Map::new();
    set.insert("text".into(), json!("changed"));
    let refused = service
        .patch_object(&ctx(), &id, set, &[], ValidateMode::Off)
        .await
        .unwrap_err();
    assert!(matches!(
        access_error(&refused),
        Some(AccessError::Dormant { .. })
    ));
    let refused = service.delete_object(&ctx(), &id).await.unwrap_err();
    assert!(matches!(
        access_error(&refused),
        Some(AccessError::Dormant { .. })
    ));
    assert!(super::port::is_refusal(&refused));

    // The installed model leaves it out; the administrator's view keeps it.
    let doc = service.ontology_document(&ctx()).await.unwrap();
    let installed = Ontology::without_dormant(&doc);
    let has = |d: &Value, id: &str| {
        d["entities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["id"] == id)
    };
    assert!(has(&doc, "team-notes-note"));
    assert!(!has(&installed, "team-notes-note"));
    assert!(installed["buckets"].as_array().unwrap().iter().all(|b| {
        !b["entity_order"]
            .as_array()
            .is_some_and(|o| o.contains(&json!("team-notes-note")))
    }));

    // Reinstalling brings it back under the same id, writable again.
    service
        .sync_kit_model(&ctx(), "team-notes", "1", Some(&notes))
        .await
        .unwrap();
    assert_eq!(
        service
            .dormant_kit(&ctx(), "team-notes-note")
            .await
            .unwrap(),
        None
    );
    let mut set = Map::new();
    set.insert("text".into(), json!("changed"));
    service
        .patch_object(&ctx(), &id, set, &[], ValidateMode::Off)
        .await
        .unwrap();
}
