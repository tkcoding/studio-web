//! A kit's lifecycle and the layered model of ADR-0070, end to end: the kit
//! installer (`studio-kits`) drives the organization's model through the
//! domain model's port, and what a person sees is asked of the REST handlers
//! (`/types`, `/query`, `/objects:mutate`) in process.
//!
//! Nothing here names a moved type or a kit: what moved is read from
//! `moved_to_kits` in `ontology.studio.json`, and which kit a type comes with
//! from there and from the built-in catalogue. A type moved out of the core
//! that no kit brings back, or a kit that lost a type it was given, fails here.

#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::Mutex;

use async_trait::async_trait;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use http_body_util::BodyExt;
use serde_json::{Value, json};
use uuid::Uuid;

use super::*;
use crate::domain_model::access::{AccessError, access_error};
use crate::domain_model::ontology::Ontology;
use crate::domain_model::port::Objects;
use crate::domain_model::service::{DomainModelService, WriteOptions};
use crate::domain_model::store::InMemoryDomainStore;
use crate::kit_registry::installed::{
    InstalledDocument, InstalledKit, InstalledStore, KitAuthority, KitInstaller, LEVEL_PROJECT,
    PLATFORM_TENANT, Refusal,
};
use crate::kit_registry::service::{
    KitDescriptor, OPT_IN_BUILTIN, SHELF_BUILTIN, builtin_catalogue, is_opt_in_builtin,
    official_catalogue,
};
use crate::org_scope::OrgCtx;

const ORG: Uuid = Uuid::from_u128(0x0c31d);
const PROJECT: Uuid = Uuid::from_u128(0x9a0e);
const ADMIN: Uuid = Uuid::from_u128(0x0a);
const MEMBER: Uuid = Uuid::from_u128(0x3e);
const PLATFORM_ADMIN: Uuid = Uuid::from_u128(0xad);

// ── What moved, read from the running build ────────────────────────────────

/// What moved out of the core to a kit, as `key -> kit`. A key the core
/// dropped is left by Studio itself: no kit brings it back.
fn kit_moves() -> BTreeMap<String, String> {
    Ontology::running_moves()
        .into_iter()
        .filter(|(_, kit)| kit != crate::domain_model::ontology::LEFT_BY_STUDIO)
        .collect()
}

/// Whole types that moved to a kit, with the kit.
fn moved_types() -> BTreeMap<String, String> {
    kit_moves()
        .into_iter()
        .filter(|(k, _)| !k.contains('.'))
        .collect()
}

/// Fields, relations and tabs of a core type that moved to a kit:
/// `(type, field, kit)`.
fn moved_fields() -> Vec<(String, String, String)> {
    kit_moves()
        .into_iter()
        .filter_map(|(k, kit)| {
            let (e, f) = k.split_once('.')?;
            Some((e.to_owned(), f.to_owned(), kit))
        })
        .collect()
}

fn library() -> Vec<KitDescriptor> {
    let mut all = builtin_catalogue();
    all.extend(official_catalogue());
    all
}

fn descriptor(slug: &str) -> KitDescriptor {
    library()
        .into_iter()
        .find(|k| k.slug == slug)
        .unwrap_or_else(|| panic!("`moved_to_kits` names `{slug}`, which the library lacks"))
}

/// A base kit by default: built in and not opt-in.
fn is_base(slug: &str) -> bool {
    descriptor(slug).shelf == SHELF_BUILTIN && !is_opt_in_builtin(slug)
}

/// The kits whole types moved to.
fn type_owners() -> BTreeSet<String> {
    moved_types().into_values().collect()
}

/// Every kit something moved to.
fn owners() -> BTreeSet<String> {
    kit_moves().into_values().collect()
}

// ── Doubles: where installations are kept, and who may do what ────────────

#[derive(Default)]
struct Installs {
    docs: Mutex<HashMap<Uuid, InstalledDocument>>,
}

#[async_trait]
impl InstalledStore for Installs {
    async fn read(&self, _: &SecurityContext, tenant: Uuid) -> anyhow::Result<InstalledDocument> {
        Ok(self
            .docs
            .lock()
            .unwrap()
            .get(&tenant)
            .cloned()
            .unwrap_or_default())
    }

    async fn update(
        &self,
        tenant: Uuid,
        change: &mut (
                 dyn for<'d> FnMut(
            &'d mut InstalledDocument,
        ) -> Result<Option<InstalledKit>, Refusal>
                     + Send
             ),
    ) -> Result<Option<InstalledKit>, Refusal> {
        let mut docs = self.docs.lock().unwrap();
        let mut doc = docs.get(&tenant).cloned().unwrap_or_default();
        let answer = change(&mut doc)?;
        docs.insert(tenant, doc);
        Ok(answer)
    }

    async fn organization_of(&self, _: &SecurityContext, tenant: Uuid) -> Uuid {
        if tenant == PROJECT { ORG } else { tenant }
    }

    async fn is_project(&self, _: &SecurityContext, tenant: Uuid) -> bool {
        tenant == PROJECT
    }
}

struct KitAdmins;

#[async_trait]
impl KitAuthority for KitAdmins {
    async fn is_platform_admin(&self, ctx: &SecurityContext) -> bool {
        ctx.subject_id() == PLATFORM_ADMIN
    }
    async fn may_manage(&self, ctx: &SecurityContext, _: Uuid) -> bool {
        ctx.subject_id() == ADMIN || ctx.subject_id() == PLATFORM_ADMIN
    }
}

/// Only `ADMIN` administers the model (`domain.model`).
struct ModelAdmins;

#[async_trait]
impl crate::user_profile::OrgAuthority for ModelAdmins {
    async fn may_administer(&self, ctx: &SecurityContext, _: Uuid, _: &str) -> bool {
        ctx.subject_id() == ADMIN
    }
    async fn may_dispose(&self, _: &SecurityContext, _: Uuid) -> bool {
        false
    }
}

fn person(subject: Uuid) -> SecurityContext {
    SecurityContext::builder()
        .subject_id(subject)
        .subject_type("user")
        .subject_tenant_id(ORG)
        .token_scopes(vec!["*".into()])
        .build()
        .unwrap()
}

fn platform() -> SecurityContext {
    SecurityContext::builder()
        .subject_id(PLATFORM_ADMIN)
        .subject_type("user")
        .subject_tenant_id(PLATFORM_TENANT)
        .token_scopes(vec!["*".into()])
        .build()
        .unwrap()
}

fn off() -> WriteOptions<'static> {
    WriteOptions {
        validate: ValidateMode::Off,
        ..Default::default()
    }
}

/// A refusal as the client reads it: the status and the problem body.
async fn problem(e: impl IntoResponse) -> (StatusCode, String) {
    let response = e.into_response();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    (status, String::from_utf8_lossy(&body).into_owned())
}

// ── One organization: its model, its kits, one process of the backend ──────

struct Org {
    store: Arc<InMemoryDomainStore>,
    installs: Arc<Installs>,
    service: Arc<DomainModelService>,
    installer: KitInstaller,
}

impl Org {
    fn over(store: Arc<InMemoryDomainStore>, installs: Arc<Installs>) -> Self {
        let service = Arc::new(DomainModelService::new(store.clone()));
        let installer = KitInstaller::new(library(), installs.clone(), Arc::new(KitAdmins))
            .with_model_port(Arc::new(Objects(service.clone())));
        Self {
            store,
            installs,
            service,
            installer,
        }
    }

    /// An organization just created: its model prepared, nothing else.
    async fn created() -> Self {
        let org = Self::over(Arc::default(), Arc::default());
        org.service.prepare_model(&person(ADMIN)).await.unwrap();
        org
    }

    /// Created, and its base kits brought into the model, as the first read
    /// of its installed kits does.
    async fn with_base_kits() -> Self {
        let org = Self::created().await;
        let problems = org.installer.reconcile_models(ORG).await.unwrap();
        assert!(problems.is_empty(), "{problems:?}");
        org
    }

    /// The next process: the same stores, nothing cached.
    fn restart(&self) -> Self {
        Self::over(self.store.clone(), self.installs.clone())
    }

    fn handle(&self) -> Handle {
        Handle(self.service.clone(), Some(Arc::new(ModelAdmins)))
    }

    async fn doc(&self) -> Value {
        self.service
            .ontology_document(&person(ADMIN))
            .await
            .unwrap()
    }

    async fn versions(&self) -> Vec<String> {
        self.service
            .revisions(&person(ADMIN))
            .await
            .unwrap()
            .into_iter()
            .map(|r| format!("{} {} {}", r.version, r.op, r.target))
            .collect()
    }

    async fn reconcile(&self) {
        let problems = self.installer.reconcile_models(ORG).await.unwrap();
        assert!(problems.is_empty(), "{problems:?}");
    }

    /// `GET /types` as `who`.
    async fn types(&self, who: Uuid, dormant: bool) -> Value {
        let q = TypesQuery {
            include: dormant.then(|| "dormant".to_owned()),
        };
        match list_types(OrgCtx(person(who)), Extension(self.handle()), Query(q)).await {
            Ok(body) => body.0.ontology,
            Err(e) => panic!("/types refused: {:?}", problem(e).await),
        }
    }

    /// `POST /query` of every object of `type_ref`, as `who`.
    async fn query(&self, who: Uuid, type_ref: &str) -> Result<Vec<Value>, (StatusCode, String)> {
        let req: QueryObjectsRequest = serde_json::from_value(json!({"type": type_ref})).unwrap();
        match query_objects(OrgCtx(person(who)), Extension(self.handle()), Json(req)).await {
            Ok(body) => Ok(body.0.items),
            Err(e) => Err(problem(e).await),
        }
    }

    /// `POST /objects:mutate` with one upsert, as `who`.
    async fn mutate_upsert(
        &self,
        who: Uuid,
        type_ref: &str,
        key: &str,
    ) -> Result<(), (StatusCode, String)> {
        let req: MutateObjectsRequest = serde_json::from_value(json!({
            "operations": [{"op": "upsert", "type": type_ref, "key": key, "value": {}}],
            "validate": "off",
        }))
        .unwrap();
        match mutate_objects(OrgCtx(person(who)), Extension(self.handle()), Json(req)).await {
            Ok(_) => Ok(()),
            Err(e) => Err(problem(e).await),
        }
    }

    async fn create(&self, type_ref: &str, key: &str) -> anyhow::Result<String> {
        Ok(self
            .service
            .create_object(&person(ADMIN), type_ref, key, off(), json!({}))
            .await?
            .instance_id)
    }

    /// The ids of `type_ref`'s objects, as the model's administrator reads them.
    async fn ids(&self, type_ref: &str) -> BTreeSet<String> {
        self.service
            .list_objects(&person(ADMIN), Some(type_ref), None)
            .await
            .unwrap()
            .into_iter()
            .map(|n| n.instance_id)
            .collect()
    }

    async fn dormant(&self, type_ref: &str) -> Option<String> {
        self.service
            .dormant_kit(&person(ADMIN), type_ref)
            .await
            .unwrap()
    }
}

fn entity<'a>(doc: &'a Value, id: &str) -> Option<&'a Value> {
    doc["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == id)
}

fn field<'a>(doc: &'a Value, e: &str, name: &str) -> Option<&'a Value> {
    entity(doc, e)?["properties"]
        .as_array()?
        .iter()
        .find(|p| p["name"] == name)
}

fn type_ids(doc: &Value) -> BTreeSet<String> {
    doc["entities"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|e| e["id"].as_str().map(str::to_owned))
        .collect()
}

/// Can a person create an object of it at all (a concrete type)?
fn concrete(doc: &Value, id: &str) -> bool {
    entity(doc, id).is_some_and(|e| e["abstract"] != true && e.pointer("/meta/held_by").is_none())
}

fn not_installed(answer: &Result<Vec<Value>, (StatusCode, String)>, kit: &str) -> bool {
    matches!(answer, Err((StatusCode::NOT_FOUND, body))
        if body.contains(&format!("DOMAIN_TYPE_NOT_INSTALLED:{kit}")))
}

/// Strip what a kit wrote on a type or a field: the old core wrote neither.
fn unmarked(mut v: Value) -> Value {
    if let Some(m) = v.get_mut("meta").and_then(Value::as_object_mut) {
        for k in ["origin", "kit", "kit_version", "left_by"] {
            m.remove(k);
        }
    }
    if let Some(ps) = v.get_mut("properties").and_then(Value::as_array_mut) {
        for p in ps {
            if p.get("origin").and_then(Value::as_str) == Some("kit") {
                let o = p.as_object_mut().unwrap();
                for k in ["origin", "kit", "kit_version"] {
                    o.remove(k);
                }
            }
        }
    }
    v
}

/// A model stored before anything moved out of the core: the running core
/// with every moved type and field as the core used to write it (the kit's
/// definition, without the kit's marks), no core layer and no kits.
async fn legacy_document() -> Value {
    let kits = Org::with_base_kits().await.doc().await;
    let mut doc = Ontology::load().document().clone();
    doc.as_object_mut().unwrap().remove("core_layer");
    for t in moved_types().keys() {
        let e = entity(&kits, t)
            .unwrap_or_else(|| panic!("no base kit brought `{t}` back"))
            .clone();
        let e = unmarked(e);
        let bucket = e["bucket"].clone();
        doc["entities"].as_array_mut().unwrap().push(e);
        if let Some(b) = doc["buckets"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|b| b["id"] == bucket)
            && let Some(order) = b["entity_order"].as_array_mut()
        {
            order.push(json!(t));
        }
    }
    for (e, f, _) in moved_fields() {
        let Some(p) = field(&kits, &e, &f).cloned() else {
            continue;
        };
        let mut p = p;
        for k in ["origin", "kit", "kit_version"] {
            p.as_object_mut().unwrap().remove(k);
        }
        if let Some(on) = doc["entities"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|x| x["id"] == e.as_str())
        {
            on["properties"].as_array_mut().unwrap().push(p);
        }
    }
    doc
}

/// A legacy organization with one object of every moved concrete type,
/// stored by the build before; answers the objects' ids by type.
async fn legacy_org() -> (Org, BTreeMap<String, BTreeSet<String>>) {
    let old = Org::over(Arc::default(), Arc::default());
    let doc = legacy_document().await;
    old.service
        .store_legacy_for_test(&person(ADMIN), doc.clone())
        .await
        .unwrap();
    let mut objects = BTreeMap::new();
    for t in moved_types().keys().filter(|t| concrete(&doc, t)) {
        old.create(t, "legacy-1").await.unwrap();
        objects.insert(t.clone(), old.ids(t).await);
    }
    assert!(!objects.is_empty(), "no moved type takes objects");
    (old.restart(), objects)
}

// ── 1. A new organization ──────────────────────────────────────────────────

#[tokio::test]
async fn a_new_organization_has_a_moved_type_only_while_its_kit_is_installed() {
    let moved = moved_types();
    assert!(!moved.is_empty(), "nothing has moved to a kit");

    // Created: the core alone.
    let org = Org::created().await;
    let types = type_ids(&org.types(MEMBER, false).await);
    for t in moved.keys() {
        assert!(!types.contains(t), "`{t}` came with the core");
    }

    // The base kits bring their types and fields back, as theirs.
    org.reconcile().await;
    let shown = org.types(MEMBER, false).await;
    for (t, kit) in moved.iter().filter(|(_, k)| is_base(k)) {
        let e = entity(&shown, t).unwrap_or_else(|| panic!("{kit} did not bring `{t}`"));
        assert_eq!(e["meta"]["kit"], kit.as_str(), "{t}");
        assert!(org.query(MEMBER, t).await.is_ok(), "{t}");
    }
    for (e, f, kit) in moved_fields().iter().filter(|(_, _, k)| is_base(k)) {
        if entity(&shown, e).is_none() {
            continue;
        }
        let p = field(&shown, e, f).unwrap_or_else(|| panic!("{kit} did not bring `{e}.{f}`"));
        assert_eq!(p["kit"], kit.as_str(), "{e}.{f}");
    }

    // Without the kit: absent for everybody, and the query says which kit.
    for kit in owners().into_iter().filter(|k| is_base(k)) {
        let org = Org::with_base_kits().await;
        org.installer
            .uninstall_base(&platform(), &kit)
            .await
            .unwrap();
        org.reconcile_tolerant().await;
        let member = org.types(MEMBER, false).await;
        let admin = org.types(ADMIN, true).await;
        for (t, _) in moved.iter().filter(|(_, k)| **k == kit) {
            assert!(entity(&member, t).is_none(), "{kit} gone, `{t}` shown");
            assert!(entity(&admin, t).is_none(), "{kit} gone, `{t}` kept");
            let answer = org.query(MEMBER, t).await;
            assert!(not_installed(&answer, &kit), "{t}: {answer:?}");
            let answer = org.query(ADMIN, t).await;
            assert!(not_installed(&answer, &kit), "{t}: {answer:?}");
        }
        for (e, f, _) in moved_fields().iter().filter(|(_, _, k)| *k == kit) {
            assert!(
                field(&member, e, f).is_none(),
                "{kit} gone, `{e}.{f}` shown"
            );
        }
    }
}

// ── 2. A legacy organization ───────────────────────────────────────────────

#[tokio::test]
async fn a_legacy_organization_keeps_its_moved_objects_dormant_until_the_kit_adopts_them() {
    let moved = moved_types();
    let (org, objects) = legacy_org().await;

    // The next start migrates it onto the core layer.
    org.service.prepare_model(&person(ADMIN)).await.unwrap();
    let versions = org.versions().await;
    assert_eq!(
        versions
            .iter()
            .filter(|v| v.contains("core-layer-migration"))
            .count(),
        1,
        "{versions:?}"
    );

    let member_types = org.types(MEMBER, false).await;
    let admin_types = org.types(ADMIN, true).await;
    for (t, ids) in &objects {
        let kit = &moved[t];
        assert_eq!(org.dormant(t).await.as_deref(), Some(kit.as_str()), "{t}");
        // Read: the administrator, with the same ids.
        assert_eq!(&org.ids(t).await, ids, "{t}");
        let read = org.query(ADMIN, t).await.unwrap();
        assert_eq!(read.len(), ids.len(), "{t}");
        // Not for a member, not on the screens.
        let answer = org.query(MEMBER, t).await;
        assert!(not_installed(&answer, kit), "{t}: {answer:?}");
        assert!(entity(&member_types, t).is_none(), "{t}");
        assert!(entity(&admin_types, t).is_some(), "{t}");
        // Written by nobody.
        let refused = org.create(t, "new").await.unwrap_err();
        assert!(
            matches!(access_error(&refused), Some(AccessError::Dormant { kit: k, .. }) if k == kit),
            "{t}: {refused:#}"
        );
        let (status, body) = org.mutate_upsert(ADMIN, t, "new").await.unwrap_err();
        assert_eq!(status, StatusCode::BAD_REQUEST, "{t}: {body}");
        assert!(body.contains("DOMAIN_TYPE_DORMANT"), "{t}: {body}");
    }
    for (e, f, kit) in moved_fields() {
        if let Some(p) = field(&admin_types, &e, &f) {
            assert_eq!(p["left_by"]["kit"], kit.as_str(), "{e}.{f}");
            assert!(field(&member_types, &e, &f).is_none(), "{e}.{f}");
        }
    }

    // The base kits adopt them: the same types, the same objects, writable.
    org.reconcile().await;
    let doc = org.doc().await;
    for (t, ids) in &objects {
        let kit = &moved[t];
        assert_eq!(org.dormant(t).await, None, "{t}");
        assert_eq!(entity(&doc, t).unwrap()["meta"]["kit"], kit.as_str(), "{t}");
        assert_eq!(&org.ids(t).await, ids, "{t}");
        assert_eq!(org.query(MEMBER, t).await.unwrap().len(), ids.len(), "{t}");
        org.create(t, "new").await.unwrap();
        org.mutate_upsert(MEMBER, t, "newer").await.unwrap();
    }
    for (e, f, kit) in moved_fields() {
        if let Some(p) = field(&doc, &e, &f) {
            assert!(p.get("left_by").is_none(), "{e}.{f}");
            assert_eq!(p["kit"], kit.as_str(), "{e}.{f}");
        }
    }

    // And the next start changes nothing.
    let before = org.versions().await;
    let next = org.restart();
    next.service.prepare_model(&person(ADMIN)).await.unwrap();
    next.reconcile().await;
    assert_eq!(next.versions().await, before);
}

// ── 3. Uninstalling and installing again ───────────────────────────────────

#[tokio::test]
async fn an_uninstalled_kit_leaves_its_inhabited_types_dormant_and_a_reinstall_adopts_them() {
    let moved = moved_types();
    for kit in type_owners().into_iter().filter(|k| is_base(k)) {
        let org = Org::with_base_kits().await;
        let doc = org.doc().await;
        let mut objects = BTreeMap::new();
        for (t, _) in moved
            .iter()
            .filter(|(t, k)| **k == kit && concrete(&doc, t))
        {
            org.create(t, "o-1").await.unwrap();
            objects.insert(t.clone(), org.ids(t).await);
        }
        if objects.is_empty() {
            continue;
        }

        // The platform removes the base kit.
        org.installer
            .uninstall_base(&platform(), &kit)
            .await
            .unwrap();
        org.reconcile_tolerant().await;
        for (t, ids) in &objects {
            assert_eq!(org.dormant(t).await.as_deref(), Some(kit.as_str()), "{t}");
            assert_eq!(&org.ids(t).await, ids, "{t}");
            assert!(org.create(t, "o-2").await.is_err(), "{t}");
        }

        // Installed again as a base kit.
        org.installer
            .install_base(&platform(), &kit, None)
            .await
            .unwrap();
        org.reconcile().await;
        for (t, ids) in &objects {
            assert_eq!(org.dormant(t).await, None, "{kit}: {t}");
            assert_eq!(&org.ids(t).await, ids, "{t}");
        }

        // The same through the organization's own installation.
        org.installer
            .uninstall_base(&platform(), &kit)
            .await
            .unwrap();
        org.reconcile_tolerant().await;
        org.installer
            .install_for_organization(&person(ADMIN), ORG, &kit, None)
            .await
            .unwrap();
        for (t, ids) in &objects {
            assert_eq!(org.dormant(t).await, None, "{kit}: {t}");
            assert_eq!(&org.ids(t).await, ids, "{t}");
            org.create(t, "o-3").await.unwrap();
        }
        org.installer
            .uninstall_for_organization(&person(ADMIN), ORG, &kit)
            .await
            .unwrap();
        for t in objects.keys() {
            assert_eq!(org.dormant(t).await.as_deref(), Some(kit.as_str()), "{t}");
            assert_eq!(org.ids(t).await.len(), 2, "{t}: nothing lost");
        }
    }
}

impl Org {
    /// Reconcile after a kit went: another kit that extends one of its types
    /// may not apply now, which is reported and not fatal.
    async fn reconcile_tolerant(&self) {
        let problems = self.installer.reconcile_models(ORG).await.unwrap();
        if !problems.is_empty() {
            eprintln!("reconcile left: {problems:?}");
        }
    }
}

// ── 4. A model kit in one project ──────────────────────────────────────────

#[tokio::test]
async fn a_project_installs_a_model_kit_only_as_screens_over_the_organization_s_model() {
    let project_kits: Vec<String> = owners()
        .into_iter()
        .filter(|k| is_base(k) && descriptor(k).levels.iter().any(|l| l == LEVEL_PROJECT))
        .collect();
    assert!(
        !project_kits.is_empty(),
        "no project-level kit brings a model"
    );
    for kit in project_kits {
        // The organization's model carries it: the project adds screens only.
        let org = Org::with_base_kits().await;
        let doc = org.doc().await;
        let versions = org.versions().await;
        org.installer
            .install_for_project(&person(ADMIN), PROJECT, &kit, None)
            .await
            .unwrap_or_else(|e| panic!("{kit}: {e:?}"));
        assert_eq!(org.doc().await, doc, "{kit} changed the model");
        assert_eq!(org.versions().await, versions, "{kit}");
        let installed = org
            .installer
            .installed_in_project(&person(ADMIN), PROJECT)
            .await
            .unwrap();
        assert!(installed.project.iter().any(|k| k.kit_slug == kit), "{kit}");

        // It does not: refused, the model is the organization's.
        let org = Org::with_base_kits().await;
        org.installer
            .uninstall_base(&platform(), &kit)
            .await
            .unwrap();
        org.reconcile_tolerant().await;
        let refused = org
            .installer
            .install_for_project(&person(ADMIN), PROJECT, &kit, None)
            .await
            .unwrap_err();
        assert!(
            matches!(&refused, Refusal::ModelKitNotForProject(s) if *s == kit),
            "{kit}: {refused:?}"
        );
    }

    // A model kit that is not a project kit at all.
    for kit in owners()
        .into_iter()
        .filter(|k| !descriptor(k).levels.iter().any(|l| l == LEVEL_PROJECT))
    {
        let org = Org::with_base_kits().await;
        let refused = org
            .installer
            .install_for_project(&person(ADMIN), PROJECT, &kit, None)
            .await
            .unwrap_err();
        assert!(
            matches!(&refused, Refusal::NotAProjectKit(_)),
            "{kit}: {refused:?}"
        );
    }
}

// ── 5. Opt-in built-in kits ────────────────────────────────────────────────

#[tokio::test]
async fn an_opt_in_kit_installs_itself_nowhere_and_its_endpoint_sources_list_once() {
    assert!(!OPT_IN_BUILTIN.is_empty());
    for &slug in OPT_IN_BUILTIN {
        let org = Org::with_base_kits().await;
        let member = person(MEMBER);
        let installed = org.installer.installed(&member, ORG).await.unwrap();
        assert!(installed.base.iter().all(|k| k.kit_slug != slug), "{slug}");
        assert!(
            installed.effective.iter().all(|k| k.kit_slug != slug),
            "{slug}"
        );
        assert!(
            !org.service
                .kit_models(&member)
                .await
                .unwrap()
                .contains_key(slug),
            "{slug}"
        );

        let ids = |sources: Vec<(String, String, String)>| {
            let mine: Vec<_> = sources.iter().filter(|s| s.0 == slug).collect();
            assert!(
                mine.iter().all(|s| s.1 == "endpoint"),
                "{slug}: only endpoint sources list where it is not installed"
            );
            let ids: Vec<String> = mine.iter().map(|s| s.2.clone()).collect();
            let unique: BTreeSet<&String> = ids.iter().collect();
            assert_eq!(unique.len(), ids.len(), "{slug}: listed twice: {ids:?}");
            ids
        };
        let sources = || async {
            org.installer
                .inbox_sources(&member, ORG)
                .await
                .unwrap()
                .into_iter()
                .map(|s| {
                    (
                        s.kit_slug.clone(),
                        s.source.kind().to_owned(),
                        s.source.id.clone(),
                    )
                })
                .collect::<Vec<_>>()
        };
        let before = ids(sources().await);

        // A project installs it for itself: still not the organization's.
        if descriptor(slug).levels.iter().any(|l| l == LEVEL_PROJECT) {
            org.installer
                .install_for_project(&person(ADMIN), PROJECT, slug, None)
                .await
                .unwrap();
            let at_org = org.installer.installed(&member, ORG).await.unwrap();
            assert!(at_org.effective.iter().all(|k| k.kit_slug != slug));
            let in_project = org
                .installer
                .installed_in_project(&member, PROJECT)
                .await
                .unwrap();
            assert!(in_project.effective.iter().any(|k| k.kit_slug == slug));
            assert_eq!(ids(sources().await), before);
        }

        // The organization installs it.
        org.installer
            .install_for_organization(&person(ADMIN), ORG, slug, None)
            .await
            .unwrap();
        let installed = org.installer.installed(&member, ORG).await.unwrap();
        assert!(installed.effective.iter().any(|k| k.kit_slug == slug));
        let mut after: Vec<String> = sources()
            .await
            .into_iter()
            .filter(|s| s.0 == slug && s.1 == "endpoint")
            .map(|s| s.2)
            .collect();
        let mut before = before;
        after.sort();
        before.sort();
        assert_eq!(after, before, "{slug}: each endpoint source once");
    }
}

// ── 6. Starting again, and starting at once ────────────────────────────────

#[tokio::test]
async fn starting_again_writes_no_version() {
    let org = Org::with_base_kits().await;
    let versions = org.versions().await;
    org.service.prepare_model(&person(ADMIN)).await.unwrap();
    assert_eq!(
        org.service
            .ensure_studio_types(&person(ADMIN))
            .await
            .unwrap(),
        0
    );
    assert!(
        org.service
            .sync_core_layer(
                &person(ADMIN),
                &Ontology::running_core(),
                &Ontology::running_moves()
            )
            .await
            .unwrap()
            .is_none()
    );
    org.reconcile().await;
    assert_eq!(org.versions().await, versions);

    let next = org.restart();
    next.service.prepare_model(&person(ADMIN)).await.unwrap();
    next.reconcile().await;
    next.service.prepare_model(&person(ADMIN)).await.unwrap();
    assert_eq!(next.versions().await, versions);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_cold_starts_write_one_version() {
    // One start, for comparison.
    let alone = Org::with_base_kits().await.versions().await.len();

    let org = Org::over(Arc::default(), Arc::default());
    let starts = (0..16).map(|_| {
        let service = org.service.clone();
        async move { service.prepare_model(&person(ADMIN)).await }
    });
    for r in futures_util::future::join_all(starts).await {
        r.unwrap();
    }
    let reconciles = (0..8).map(|_| org.installer.reconcile_models(ORG));
    for r in futures_util::future::join_all(reconciles).await {
        assert!(r.unwrap().is_empty());
    }
    let versions = org.versions().await;
    assert_eq!(versions.len(), alone, "{versions:?}");

    // A legacy organization: several requests at once find it first.
    let (legacy, _) = legacy_org().await;
    let migrations = (0..16).map(|_| {
        let service = legacy.service.clone();
        async move { service.prepare_model(&person(ADMIN)).await }
    });
    for r in futures_util::future::join_all(migrations).await {
        r.unwrap();
    }
    let versions = legacy.versions().await;
    assert_eq!(
        versions
            .iter()
            .filter(|v| v.contains("core-layer-migration"))
            .count(),
        1,
        "{versions:?}"
    );
    assert_eq!(
        versions.iter().filter(|v| v.contains(" core ")).count(),
        0,
        "{versions:?}"
    );
}

// ── 7. The organization's change to a core type ────────────────────────────

#[tokio::test]
async fn an_organization_s_change_to_a_core_field_survives_the_next_core() {
    let org = Org::with_base_kits().await;
    let admin = person(ADMIN);
    let moved = Ontology::running_moves();
    let mut core = Ontology::running_core();
    // Two plain fields of a core type that nothing moved: the first one the
    // organization changes, the second one only the core.
    let (on, ours, theirs) = core
        .iter()
        .find_map(|e| {
            let id = e["id"].as_str()?;
            let plain: Vec<String> = e["properties"]
                .as_array()?
                .iter()
                .filter(|p| p.get("extends").is_none())
                .filter_map(|p| p["name"].as_str().map(str::to_owned))
                .filter(|f| !moved.contains_key(&format!("{id}.{f}")))
                .collect();
            (plain.len() >= 2 && !moved.contains_key(id))
                .then(|| (id.to_owned(), plain[0].clone(), plain[1].clone()))
        })
        .unwrap();
    org.service
        .edit_field(
            &admin,
            &on,
            &ours,
            super::super::ontology::FieldEdit {
                description: Some("the organization's".into()),
                ..Default::default()
            },
            false,
        )
        .await
        .unwrap();
    let kits = org.service.kit_models(&admin).await.unwrap();

    // The next build's core changes both.
    for p in core.iter_mut().find(|e| e["id"] == on.as_str()).unwrap()["properties"]
        .as_array_mut()
        .unwrap()
    {
        if p["name"] == ours.as_str() || p["name"] == theirs.as_str() {
            p["description"] = json!("the next core's");
        }
    }
    org.service
        .sync_core_layer(&admin, &core, &moved)
        .await
        .unwrap()
        .expect("the next core changes the model");
    let doc = org.doc().await;
    assert_eq!(
        field(&doc, &on, &ours).unwrap()["description"],
        "the organization's"
    );
    assert_eq!(
        field(&doc, &on, &theirs).unwrap()["description"],
        "the next core's"
    );
    assert_eq!(org.service.kit_models(&admin).await.unwrap(), kits);
    for (t, kit) in moved_types().iter().filter(|(_, k)| is_base(k)) {
        assert_eq!(entity(&doc, t).unwrap()["meta"]["kit"], kit.as_str(), "{t}");
    }

    // Kept, not cached: the next process reads the same, and the same core
    // writes nothing more.
    let next = org.restart();
    assert_eq!(next.doc().await, doc);
    assert!(
        next.service
            .sync_core_layer(&admin, &core, &moved)
            .await
            .unwrap()
            .is_none()
    );
}
