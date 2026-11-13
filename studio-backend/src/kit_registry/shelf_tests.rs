use std::collections::HashMap;
use std::sync::Mutex;

use super::*;
use crate::kit_registry::installed::{
    InstalledDocument, InstalledKit, InstalledStore, KitAuthority, KitInstaller, Refusal,
};
use crate::kit_registry::service::{builtin_catalogue, official_catalogue};

const ORG: Uuid = Uuid::from_u128(0xc31d);
const OTHER_ORG: Uuid = Uuid::from_u128(0xc31e);
const PROJECT: Uuid = Uuid::from_u128(0x9a0e);
const ADMIN: Uuid = Uuid::from_u128(0x0a);
const MEMBER: Uuid = Uuid::from_u128(0x3e);
const CONNECTION: Uuid = Uuid::from_u128(0xc0);

#[derive(Default)]
struct Memory {
    docs: Mutex<HashMap<Uuid, InstalledDocument>>,
}

#[async_trait]
impl InstalledStore for Memory {
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

struct Admins;

#[async_trait]
impl KitAuthority for Admins {
    async fn is_platform_admin(&self, _: &SecurityContext) -> bool {
        false
    }
    async fn may_manage(&self, ctx: &SecurityContext, org: Uuid) -> bool {
        ctx.subject_id() == ADMIN && (org == ORG || org == OTHER_ORG)
    }
}

/// A repository that answers one manifest, pinned to whatever commit the
/// test sets.
struct Repo {
    body: Mutex<String>,
    commit: Mutex<String>,
}

#[async_trait]
impl KitSourceReader for Repo {
    async fn fetch(
        &self,
        _: &SecurityContext,
        _: Uuid,
        _: &SourceInput,
    ) -> Result<Fetched, Refusal> {
        Ok(Fetched {
            provider: "github".into(),
            commit: self.commit.lock().unwrap().clone(),
            file: KIT_JSON,
            body: self.body.lock().unwrap().clone(),
            repository_url: "https://github.com/acme/kits".into(),
        })
    }
}

fn manifest(slug: &str) -> String {
    format!(
        r#"{{"slug": "{slug}", "name": "Ops", "levels": ["organization", "project"],
            "screens": [{{"kind": "tab", "level": "project", "label": "Runbooks"}}]}}"#
    )
}

const C1: &str = "1111111111111111111111111111111111111111";
const C2: &str = "2222222222222222222222222222222222222222";

fn setup(slug: &str) -> (KitInstaller, Arc<Repo>) {
    let mut library = builtin_catalogue();
    library.extend(official_catalogue());
    let repo = Arc::new(Repo {
        body: Mutex::new(manifest(slug)),
        commit: Mutex::new(C1.into()),
    });
    let installer = KitInstaller::new(library, Arc::new(Memory::default()), Arc::new(Admins))
        .with_reader(repo.clone());
    (installer, repo)
}

fn caller(subject: Uuid, home: Uuid) -> SecurityContext {
    SecurityContext::builder()
        .subject_id(subject)
        .subject_type("user")
        .subject_tenant_id(home)
        .token_scopes(vec!["studio".into()])
        .build()
        .unwrap()
}

fn source() -> SourceInput {
    SourceInput {
        connection_id: CONNECTION,
        repository: "acme/kits".into(),
        path: "/ops/".into(),
        git_ref: Some("main".into()),
        slug: None,
    }
}

#[tokio::test]
async fn an_organization_adds_a_kit_from_its_repository_and_installs_it() {
    let (installer, _) = setup("ops");
    let admin = caller(ADMIN, ORG);
    let added = installer
        .add_shelf_kit(&admin, ORG, source())
        .await
        .unwrap();
    assert_eq!(added.kit.shelf, "organization");
    assert_eq!(added.kit.default_version, C1, "pinned to the commit read");
    assert_eq!(added.kit.manifest_path, "ops/kit.json");
    assert_eq!(added.origin.repository, "acme/kits");
    assert_eq!(added.origin.path, "ops");
    assert_eq!(added.origin.commit, C1);

    // Visible to the organization only.
    let member = caller(MEMBER, ORG);
    assert_eq!(installer.shelf(&member, ORG).await.unwrap().len(), 1);
    assert!(
        installer
            .shelf(&member, OTHER_ORG)
            .await
            .unwrap()
            .is_empty()
    );

    // Installed like any kit, at its pin.
    let kit = installer
        .install_for_organization(&admin, ORG, "ops", None)
        .await
        .unwrap();
    assert_eq!(
        (kit.version.as_str(), kit.shelf.as_str()),
        (C1, "organization")
    );
    let installed = installer.installed(&member, ORG).await.unwrap();
    assert!(installed.effective.iter().any(|k| k.kit_slug == "ops"));
    // Another commit than the pin is the shelf's to move.
    assert!(matches!(
        installer
            .install_for_organization(&admin, ORG, "ops", Some(C2))
            .await,
        Err(Refusal::Invalid(_))
    ));
    // And for a project of the organization.
    installer
        .install_for_project(&admin, PROJECT, "ops", None)
        .await
        .unwrap();

    // Another organization does not have it.
    let other = caller(ADMIN, OTHER_ORG);
    assert!(matches!(
        installer
            .install_for_organization(&other, OTHER_ORG, "ops", None)
            .await,
        Err(Refusal::NotFound(..))
    ));
}

#[tokio::test]
async fn only_kit_administrators_change_the_shelf() {
    let (installer, _) = setup("ops");
    let member = caller(MEMBER, ORG);
    assert!(matches!(
        installer.add_shelf_kit(&member, ORG, source()).await,
        Err(Refusal::Forbidden(_))
    ));
    assert!(matches!(
        installer.preview_shelf_kit(&member, ORG, source()).await,
        Err(Refusal::Forbidden(_))
    ));
}

#[tokio::test]
async fn a_preview_keeps_nothing() {
    let (installer, _) = setup("ops");
    let admin = caller(ADMIN, ORG);
    let kit = installer
        .preview_shelf_kit(&admin, ORG, source())
        .await
        .unwrap();
    assert_eq!(kit.kit.slug, "ops");
    assert!(installer.shelf(&admin, ORG).await.unwrap().is_empty());
}

#[tokio::test]
async fn a_shelf_kit_may_not_shadow_the_library() {
    let (installer, _) = setup("sdlc");
    let admin = caller(ADMIN, ORG);
    assert!(matches!(
        installer.add_shelf_kit(&admin, ORG, source()).await,
        Err(Refusal::SlugTaken(slug)) if slug == "sdlc"
    ));
}

#[tokio::test]
async fn refresh_re_pins_and_an_installed_kit_stays_on_the_shelf() {
    let (installer, repo) = setup("ops");
    let admin = caller(ADMIN, ORG);
    installer
        .add_shelf_kit(&admin, ORG, source())
        .await
        .unwrap();
    installer
        .install_for_organization(&admin, ORG, "ops", None)
        .await
        .unwrap();

    *repo.commit.lock().unwrap() = C2.into();
    let fresh = installer
        .refresh_shelf_kit(&admin, ORG, "ops")
        .await
        .unwrap();
    assert_eq!(fresh.kit.default_version, C2);
    assert!(fresh.origin.refreshed_at.is_some());
    // The installation keeps the commit it was installed at.
    let installed = installer.installed(&admin, ORG).await.unwrap();
    assert_eq!(installed.organization[0].version, C1);

    assert!(matches!(
        installer.remove_shelf_kit(&admin, ORG, "ops").await,
        Err(Refusal::KitInstalled(_))
    ));
    installer
        .uninstall_for_organization(&admin, ORG, "ops")
        .await
        .unwrap();
    installer
        .remove_shelf_kit(&admin, ORG, "ops")
        .await
        .unwrap();
    assert!(installer.shelf(&admin, ORG).await.unwrap().is_empty());
    assert!(matches!(
        installer.remove_shelf_kit(&admin, ORG, "ops").await,
        Err(Refusal::NotFound(..))
    ));
}

#[test]
fn a_source_is_checked_before_anything_is_read() {
    let bad = |repository: &str, path: &str, git_ref: Option<&str>| {
        normalize_input(SourceInput {
            connection_id: CONNECTION,
            repository: repository.into(),
            path: path.into(),
            git_ref: git_ref.map(str::to_owned),
            slug: None,
        })
        .is_err()
    };
    assert!(!bad("acme/kits", "", None));
    assert!(!bad("group/sub/kits", "a/b", Some("v1.2")));
    assert!(bad("kits", "", None));
    assert!(bad("acme/../x", "", None));
    assert!(bad("acme/kits", "../etc", None));
    assert!(bad("acme/kits", "", Some("--upload-pack")));
}

#[tokio::test]
async fn refreshing_the_shelf_keeps_the_installed_manifest_until_upgrade() {
    let (installer, repo) = setup("ops");
    let admin = caller(ADMIN, ORG);
    let mut first: serde_json::Value = serde_json::from_str(&manifest("ops")).unwrap();
    first["inbox"] = serde_json::json!([{
        "id": "waiting", "label": "Waiting", "query": {"type": "project"}
    }]);
    first["model"] = serde_json::json!({"types": [{"name": "runbook"}]});
    *repo.body.lock().unwrap() = first.to_string();
    installer
        .add_shelf_kit(&admin, ORG, source())
        .await
        .unwrap();
    installer
        .install_for_organization(&admin, ORG, "ops", None)
        .await
        .unwrap();

    *repo.commit.lock().unwrap() = C2.into();
    *repo.body.lock().unwrap() = manifest("ops");
    installer
        .refresh_shelf_kit(&admin, ORG, "ops")
        .await
        .unwrap();
    let sources = installer.inbox_sources(&admin, ORG).await.unwrap();
    let source = sources.iter().find(|s| s.kit_slug == "ops").unwrap();
    assert_eq!(source.kit_version, C1);
    assert_eq!(source.source.id, "waiting");
    let kit = installer.kit_for(ORG, "ops").await.unwrap();
    assert!(matches!(
        installer.model_of(ORG, &kit, C1).await.unwrap(),
        crate::kit_registry::models::KitModel::Overlay(_)
    ));

    installer
        .install_for_organization(&admin, ORG, "ops", None)
        .await
        .unwrap();
    assert!(
        installer
            .inbox_sources(&admin, ORG)
            .await
            .unwrap()
            .iter()
            .all(|s| s.kit_slug != "ops")
    );
    assert!(matches!(
        installer.model_of(ORG, &kit, C2).await.unwrap(),
        crate::kit_registry::models::KitModel::Nothing
    ));
}
