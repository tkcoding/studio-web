use std::collections::HashMap;
use std::sync::Mutex;

use super::*;
use crate::kit_registry::service::{BUILTIN_VERSION, builtin_catalogue, official_catalogue};

const ORG: Uuid = Uuid::from_u128(0xc31d);
const PROJECT: Uuid = Uuid::from_u128(0x9a0e);

fn catalogue() -> Vec<KitDescriptor> {
    let mut all = builtin_catalogue();
    all.extend(official_catalogue());
    all
}

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

/// Who is what, by subject.
struct Roles {
    platform_admins: Vec<Uuid>,
    org_admins: Vec<(Uuid, Uuid)>,
}

#[async_trait]
impl KitAuthority for Roles {
    async fn is_platform_admin(&self, ctx: &SecurityContext) -> bool {
        self.platform_admins.contains(&ctx.subject_id())
    }
    async fn may_manage(&self, ctx: &SecurityContext, org: Uuid) -> bool {
        self.platform_admins.contains(&ctx.subject_id())
            || self.org_admins.contains(&(ctx.subject_id(), org))
    }
}

const PLATFORM_ADMIN: Uuid = Uuid::from_u128(0xad);
const ORG_ADMIN: Uuid = Uuid::from_u128(0x0a);
const MEMBER: Uuid = Uuid::from_u128(0x3e);

fn caller(subject: Uuid, home: Uuid) -> SecurityContext {
    SecurityContext::builder()
        .subject_id(subject)
        .subject_type("user")
        .subject_tenant_id(home)
        .token_scopes(vec!["studio".into()])
        .build()
        .unwrap()
}

fn installer() -> (KitInstaller, Arc<Memory>) {
    let store = Arc::new(Memory::default());
    let roles = Arc::new(Roles {
        platform_admins: vec![PLATFORM_ADMIN],
        org_admins: vec![(ORG_ADMIN, ORG)],
    });
    (KitInstaller::new(catalogue(), store.clone(), roles), store)
}

fn slugs(kits: &[InstalledKit]) -> Vec<&str> {
    kits.iter().map(|k| k.kit_slug.as_str()).collect()
}

fn kit(slug: &str, version: &str, kind: &'static str, at: Option<&str>) -> InstalledKit {
    InstalledKit {
        kit_slug: slug.to_owned(),
        version: version.to_owned(),
        shelf: "official".to_owned(),
        kind,
        installed_by: at.map(|_| "someone".to_owned()),
        installed_at: at.map(str::to_owned),
        by_default: at.is_none(),
    }
}

#[tokio::test]
async fn every_builtin_kit_is_a_base_kit_until_the_platform_removes_it() {
    let (installer, _) = installer();
    let member = caller(MEMBER, ORG);
    let installed = installer.installed(&member, ORG).await.unwrap();
    assert_eq!(installed.organization_id, ORG);
    assert_eq!(
        slugs(&installed.base),
        [
            "assistant",
            "components",
            "org-connections",
            "org-costs",
            "org-infrastructure",
            "org-reports",
            "product-releases",
            "project-activity",
            "project-artifacts",
            "project-domain-model",
            "project-git",
            "project-issues",
            "project-lifecycle",
            "project-specs",
            "project-team",
            "project-tests",
            "studio-api-docs"
        ]
    );
    assert!(
        installed
            .base
            .iter()
            .all(|k| k.by_default && k.installed_by.is_none() && k.version == BUILTIN_VERSION)
    );
    assert!(installed.organization.is_empty());
    assert_eq!(installed.effective, installed.base);

    let admin = caller(PLATFORM_ADMIN, PLATFORM_TENANT);
    installer
        .uninstall_base(&admin, "project-tests")
        .await
        .unwrap();
    let installed = installer.installed(&member, ORG).await.unwrap();
    assert!(!slugs(&installed.effective).contains(&"project-tests"));
    // Removed means removed: a second removal finds nothing.
    assert!(matches!(
        installer.uninstall_base(&admin, "project-tests").await,
        Err(Refusal::NotFound(..))
    ));
    // And installing it again brings it back, now recorded.
    let back = installer
        .install_base(&admin, "project-tests", None)
        .await
        .unwrap();
    assert_eq!(back.kind, KIND_BASE);
    assert!(!back.by_default);
    let installed = installer.installed(&member, ORG).await.unwrap();
    let tests = installed
        .base
        .iter()
        .find(|k| k.kit_slug == "project-tests")
        .unwrap();
    assert_eq!(
        tests.installed_by.as_deref(),
        Some(&*PLATFORM_ADMIN.to_string())
    );
}

#[tokio::test]
async fn a_project_reads_its_organization_s_kits() {
    let (installer, _) = installer();
    let installed = installer
        .installed(&caller(MEMBER, PROJECT), PROJECT)
        .await
        .unwrap();
    assert_eq!(installed.organization_id, ORG);
}

#[tokio::test]
async fn only_a_platform_administrator_changes_the_base_kits() {
    let (installer, store) = installer();
    for who in [caller(ORG_ADMIN, ORG), caller(MEMBER, ORG)] {
        assert!(matches!(
            installer.install_base(&who, "sdlc", None).await,
            Err(Refusal::Forbidden(PLATFORM_ADMIN_REQUIRED))
        ));
        assert!(matches!(
            installer.uninstall_base(&who, "project-issues").await,
            Err(Refusal::Forbidden(PLATFORM_ADMIN_REQUIRED))
        ));
    }
    assert!(store.docs.lock().unwrap().is_empty(), "a refusal wrote");
    let admin = caller(PLATFORM_ADMIN, PLATFORM_TENANT);
    let sdlc = installer.install_base(&admin, "sdlc", None).await.unwrap();
    assert_eq!(sdlc.version, official_catalogue()[0].default_version);
    assert_eq!(sdlc.shelf, "official");
}

#[tokio::test]
async fn only_an_organization_administrator_changes_its_kits() {
    let (installer, store) = installer();
    assert!(matches!(
        installer
            .install_for_organization(&caller(MEMBER, ORG), ORG, "sdlc", None)
            .await,
        Err(Refusal::Forbidden(KIT_ADMIN_REQUIRED))
    ));
    // An administrator of one organization is nobody in another.
    let other = Uuid::from_u128(0x07e7);
    assert!(matches!(
        installer
            .install_for_organization(&caller(ORG_ADMIN, other), other, "sdlc", None)
            .await,
        Err(Refusal::Forbidden(KIT_ADMIN_REQUIRED))
    ));
    assert!(store.docs.lock().unwrap().is_empty(), "a refusal wrote");

    let mine = installer
        .install_for_organization(&caller(ORG_ADMIN, ORG), ORG, "compete", Some("v1.0.0"))
        .await
        .unwrap();
    assert_eq!(mine.kind, KIND_ORGANIZATION);
    assert_eq!(mine.version, "v1.0.0");
    // A platform administrator may, too.
    installer
        .install_for_organization(&caller(PLATFORM_ADMIN, PLATFORM_TENANT), ORG, "sdlc", None)
        .await
        .unwrap();
    let installed = installer
        .installed(&caller(MEMBER, ORG), ORG)
        .await
        .unwrap();
    assert_eq!(slugs(&installed.organization), ["compete", "sdlc"]);
    assert!(slugs(&installed.effective).contains(&"compete"));
    // Only for the organization that installed them.
    let elsewhere = installer
        .installed(&caller(MEMBER, other), other)
        .await
        .unwrap();
    assert!(elsewhere.organization.is_empty());
    assert!(!slugs(&elsewhere.effective).contains(&"compete"));
}

#[tokio::test]
async fn an_organization_cannot_uninstall_a_base_kit() {
    let (installer, _) = installer();
    let admin = caller(ORG_ADMIN, ORG);
    assert!(matches!(
        installer
            .uninstall_for_organization(&admin, ORG, "project-issues")
            .await,
        Err(Refusal::BaseKit(slug)) if slug == "project-issues"
    ));
    // Its own installation of a base kit is its own to remove; the base
    // kit stays.
    installer
        .install_for_organization(&admin, ORG, "project-issues", None)
        .await
        .unwrap();
    installer
        .uninstall_for_organization(&admin, ORG, "project-issues")
        .await
        .unwrap();
    let installed = installer.installed(&admin, ORG).await.unwrap();
    assert!(slugs(&installed.effective).contains(&"project-issues"));
    // A kit it never had is not there.
    assert!(matches!(
        installer
            .uninstall_for_organization(&admin, ORG, "sdlc")
            .await,
        Err(Refusal::NotFound(..))
    ));
}

#[tokio::test]
async fn kits_are_installed_for_an_organization_not_a_project_or_the_platform() {
    let (installer, _) = installer();
    let admin = caller(PLATFORM_ADMIN, PLATFORM_TENANT);
    assert!(matches!(
        installer
            .install_for_organization(&admin, PROJECT, "sdlc", None)
            .await,
        Err(Refusal::Invalid(_))
    ));
    assert!(matches!(
        installer
            .install_for_organization(&admin, PLATFORM_TENANT, "sdlc", None)
            .await,
        Err(Refusal::Invalid(_))
    ));
}

#[tokio::test]
async fn an_unknown_or_malformed_kit_is_refused() {
    let (installer, _) = installer();
    let admin = caller(PLATFORM_ADMIN, PLATFORM_TENANT);
    assert!(matches!(
        installer.install_base(&admin, "no-such-kit", None).await,
        Err(Refusal::NotFound(..))
    ));
    assert!(matches!(
        installer.install_base(&admin, "sdlc; rm", None).await,
        Err(Refusal::Invalid(_))
    ));
    assert!(matches!(
        installer
            .install_base(&admin, "sdlc", Some("../main"))
            .await,
        Err(Refusal::Invalid(_))
    ));
    // A built-in kit comes at Studio's version and no other.
    assert!(matches!(
        installer
            .install_base(&admin, "project-issues", Some("9.9.9"))
            .await,
        Err(Refusal::Invalid(_))
    ));
    installer
        .install_base(&admin, "project-issues", Some(BUILTIN_VERSION))
        .await
        .unwrap();
}

#[test]
fn the_newer_version_wins_and_one_entry_is_left_per_kit() {
    let base = vec![
        kit("a", "1.2.0", KIND_BASE, Some("2026-01-01T00:00:00Z")),
        kit("b", "v2.0", KIND_BASE, Some("2026-01-01T00:00:00Z")),
        kit("c", "1.0.0", KIND_BASE, Some("2026-01-01T00:00:00Z")),
    ];
    let org = vec![
        kit(
            "a",
            "1.10.0",
            KIND_ORGANIZATION,
            Some("2025-01-01T00:00:00Z"),
        ),
        kit("b", "1.9", KIND_ORGANIZATION, Some("2027-01-01T00:00:00Z")),
        kit(
            "c",
            "1.0.0",
            KIND_ORGANIZATION,
            Some("2027-01-01T00:00:00Z"),
        ),
        kit("d", "main", KIND_ORGANIZATION, Some("2027-01-01T00:00:00Z")),
    ];
    let all = effective(&base, &org);
    assert_eq!(slugs(&all), ["a", "b", "c", "d"]);
    // By number, not by text and not by date.
    assert_eq!(
        (all[0].version.as_str(), all[0].kind),
        ("1.10.0", KIND_ORGANIZATION)
    );
    assert_eq!((all[1].version.as_str(), all[1].kind), ("v2.0", KIND_BASE));
    // The same version is the base kit's.
    assert_eq!(all[2].kind, KIND_BASE);
    assert_eq!(all[3].kind, KIND_ORGANIZATION);
}

#[test]
fn versions_without_an_order_go_by_when_they_were_installed() {
    let older = kit("a", "5c5b85c", KIND_BASE, Some("2026-01-01T00:00:00Z"));
    let later = kit(
        "a",
        "fbd2f5c",
        KIND_ORGANIZATION,
        Some("2026-02-01T00:00:00Z"),
    );
    assert_eq!(newer(&older, &later), Ordering::Less);
    assert_eq!(newer(&later, &older), Ordering::Greater);
    // A default installation was nobody's, so any record is later.
    let default = kit("a", "5c5b85c", KIND_BASE, None);
    assert_eq!(newer(&default, &later), Ordering::Less);
}

#[test]
fn a_stored_builtin_kit_takes_the_version_this_image_ships() {
    let doc = InstalledDocument {
        kits: vec![
            InstalledRecord {
                kit_slug: "project-issues".into(),
                version: "0.0.1".into(),
                shelf: "builtin".into(),
                installed_by: "x".into(),
                installed_at: "2026-01-01T00:00:00Z".into(),
            },
            // Dropped from this image: it cannot apply.
            InstalledRecord {
                kit_slug: "project-gone".into(),
                version: "0.0.1".into(),
                shelf: "builtin".into(),
                installed_by: "x".into(),
                installed_at: "2026-01-01T00:00:00Z".into(),
            },
        ],
        removed_builtin: vec![],
        shelf: vec![],
        shelf_versions: vec![],
    };
    let base = base_kits(&doc, &catalogue());
    let issues = base
        .iter()
        .find(|k| k.kit_slug == "project-issues")
        .unwrap();
    assert_eq!(issues.version, BUILTIN_VERSION);
    assert!(!issues.by_default);
    assert!(!slugs(&base).contains(&"project-gone"));
}

#[test]
fn the_document_reads_without_the_removed_list() {
    let doc: InstalledDocument = serde_json::from_value(serde_json::json!({"kits": []})).unwrap();
    assert!(doc.removed_builtin.is_empty());
    assert_eq!(
        serde_json::to_value(&doc).unwrap(),
        serde_json::json!({"kits": []})
    );
}

#[tokio::test]
async fn a_project_has_three_layers_and_the_newest_version_wins() {
    let (installer, _) = installer();
    let platform = caller(PLATFORM_ADMIN, PLATFORM_TENANT);
    let org_admin = caller(ORG_ADMIN, ORG);
    installer
        .install_base(&platform, "sdlc", Some("1.0.0"))
        .await
        .unwrap();
    installer
        .install_for_organization(&org_admin, ORG, "sdlc", Some("1.2.0"))
        .await
        .unwrap();
    installer
        .install_for_organization(&org_admin, ORG, "compete", Some("2.0.0"))
        .await
        .unwrap();
    // The project's sdlc is the newest; its compete is older than the
    // organization's, which keeps it.
    let mine = installer
        .install_for_project(&org_admin, PROJECT, "sdlc", Some("1.10.0"))
        .await
        .unwrap();
    assert_eq!(mine.kind, KIND_PROJECT);
    installer
        .install_for_project(&org_admin, PROJECT, "compete", Some("1.0.0"))
        .await
        .unwrap();

    let installed = installer
        .installed_in_project(&caller(MEMBER, PROJECT), PROJECT)
        .await
        .unwrap();
    assert_eq!(installed.organization_id, ORG);
    assert_eq!(installed.project_id, Some(PROJECT));
    assert_eq!(slugs(&installed.project), ["compete", "sdlc"]);
    let at = |slug: &str| {
        installed
            .effective
            .iter()
            .find(|k| k.kit_slug == slug)
            .map(|k| (k.version.clone(), k.kind))
            .unwrap()
    };
    assert_eq!(at("sdlc"), ("1.10.0".to_owned(), KIND_PROJECT));
    assert_eq!(at("compete"), ("2.0.0".to_owned(), KIND_ORGANIZATION));
    // The built-in base kits still apply, once each.
    assert!(slugs(&installed.effective).contains(&"project-tests"));
    let mut seen = slugs(&installed.effective);
    seen.dedup();
    assert_eq!(seen.len(), installed.effective.len());

    // The organization's answer is unchanged by the project's kits.
    let org = installer.installed(&org_admin, ORG).await.unwrap();
    assert!(org.project.is_empty());
    assert_eq!(org.project_id, None);
    assert_eq!(
        org.effective
            .iter()
            .find(|k| k.kit_slug == "sdlc")
            .unwrap()
            .version,
        "1.2.0"
    );
}

#[tokio::test]
async fn only_the_organization_s_kit_administrators_change_a_project_s_kits() {
    let (installer, store) = installer();
    assert!(matches!(
        installer
            .install_for_project(&caller(MEMBER, PROJECT), PROJECT, "sdlc", None)
            .await,
        Err(Refusal::Forbidden(KIT_ADMIN_REQUIRED))
    ));
    assert!(matches!(
        installer
            .uninstall_for_project(&caller(MEMBER, PROJECT), PROJECT, "sdlc")
            .await,
        Err(Refusal::Forbidden(KIT_ADMIN_REQUIRED))
    ));
    assert!(store.docs.lock().unwrap().is_empty(), "a refusal wrote");
    // A platform administrator may, and so may the organization's.
    installer
        .install_for_project(
            &caller(PLATFORM_ADMIN, PLATFORM_TENANT),
            PROJECT,
            "sdlc",
            None,
        )
        .await
        .unwrap();
    installer
        .uninstall_for_project(&caller(ORG_ADMIN, ORG), PROJECT, "sdlc")
        .await
        .unwrap();
}

#[tokio::test]
async fn a_project_cannot_remove_what_its_organization_or_the_platform_installed() {
    let (installer, _) = installer();
    let admin = caller(ORG_ADMIN, ORG);
    assert!(matches!(
        installer
            .uninstall_for_project(&admin, PROJECT, "project-issues")
            .await,
        Err(Refusal::BaseKit(slug)) if slug == "project-issues"
    ));
    installer
        .install_for_organization(&admin, ORG, "compete", None)
        .await
        .unwrap();
    assert!(matches!(
        installer
            .uninstall_for_project(&admin, PROJECT, "compete")
            .await,
        Err(Refusal::OrganizationKit(slug)) if slug == "compete"
    ));
    assert!(matches!(
        installer
            .uninstall_for_project(&admin, PROJECT, "sdlc")
            .await,
        Err(Refusal::NotFound(..))
    ));
}

#[tokio::test]
async fn only_a_project_level_kit_goes_in_a_project() {
    let (installer, store) = installer();
    let admin = caller(ORG_ADMIN, ORG);
    // `org-costs` is installed on organizations only.
    assert!(matches!(
        installer
            .install_for_project(&admin, PROJECT, "org-costs", None)
            .await,
        Err(Refusal::NotAProjectKit(slug)) if slug == "org-costs"
    ));
    // An organization is not a project.
    assert!(matches!(
        installer
            .install_for_project(&admin, ORG, "sdlc", None)
            .await,
        Err(Refusal::Invalid(_))
    ));
    assert!(matches!(
        installer.installed_in_project(&admin, ORG).await,
        Err(Refusal::Invalid(_))
    ));
    assert!(store.docs.lock().unwrap().is_empty(), "a refusal wrote");
    // A kit whose levels name `project` and that brings no model does.
    installer
        .install_for_project(&admin, PROJECT, "constructor-research", None)
        .await
        .unwrap();
    // Unless it brings a model, which is the organization's (ADR-0067 §6).
    assert!(matches!(
        installer
            .install_for_project(&admin, PROJECT, "project-lifecycle", None)
            .await,
        Err(Refusal::ModelKitNotForProject(slug)) if slug == "project-lifecycle"
    ));
}

#[tokio::test]
async fn an_opt_in_builtin_kit_applies_only_where_someone_installs_it() {
    use crate::kit_registry::service::CONSTRUCTOR_RESEARCH_KIT as RESEARCH;
    let (installer, store) = installer();
    let member = caller(MEMBER, ORG);
    // In the library, built in, and installed nowhere by default.
    assert!(
        installer
            .library()
            .iter()
            .any(|k| k.slug == RESEARCH && k.shelf == SHELF_BUILTIN)
    );
    let installed = installer.installed(&member, ORG).await.unwrap();
    assert!(!slugs(&installed.base).contains(&RESEARCH));
    assert!(!slugs(&installed.effective).contains(&RESEARCH));
    // Not a base kit, so there is no base kit to remove, and trying leaves no
    // "removed" mark behind.
    let platform = caller(PLATFORM_ADMIN, PLATFORM_TENANT);
    assert!(matches!(
        installer.uninstall_base(&platform, RESEARCH).await,
        Err(Refusal::NotFound(..))
    ));
    assert!(
        store
            .docs
            .lock()
            .unwrap()
            .get(&PLATFORM_TENANT)
            .is_none_or(|doc| doc.removed_builtin.is_empty())
    );

    // An organization installs it for itself, at Studio's version, and
    // removes it again: it is its own, not the platform's.
    let admin = caller(ORG_ADMIN, ORG);
    let own = installer
        .install_for_organization(&admin, ORG, RESEARCH, None)
        .await
        .unwrap();
    assert_eq!(
        (own.kind, own.version.as_str()),
        (KIND_ORGANIZATION, BUILTIN_VERSION)
    );
    let installed = installer.installed(&member, ORG).await.unwrap();
    assert!(slugs(&installed.effective).contains(&RESEARCH));
    installer
        .uninstall_for_organization(&admin, ORG, RESEARCH)
        .await
        .unwrap();
    let installed = installer.installed(&member, ORG).await.unwrap();
    assert!(!slugs(&installed.effective).contains(&RESEARCH));

    // A platform administrator makes it a base kit for everyone, and takes
    // it back.
    installer
        .install_base(&platform, RESEARCH, None)
        .await
        .unwrap();
    let installed = installer.installed(&member, ORG).await.unwrap();
    let base = installed
        .base
        .iter()
        .find(|k| k.kit_slug == RESEARCH)
        .unwrap();
    assert!(!base.by_default);
    installer.uninstall_base(&platform, RESEARCH).await.unwrap();
    let installed = installer.installed(&member, ORG).await.unwrap();
    assert!(!slugs(&installed.effective).contains(&RESEARCH));
    assert!(
        store.docs.lock().unwrap()[&PLATFORM_TENANT]
            .removed_builtin
            .is_empty()
    );
}

#[tokio::test]
async fn a_gear_asks_whether_a_kit_applies_to_an_organization_or_its_project() {
    use crate::kit_registry::port::{CONSTRUCTOR_RESEARCH_KIT, InstalledKits, KitPresence};
    let (installer, _) = installer();
    let installer = Arc::new(installer);
    let presence = InstalledKits::new(Arc::clone(&installer));
    let member = caller(MEMBER, ORG);
    // A base kit applies by default; the opt-in kit does not, yet.
    assert!(
        presence
            .applies(&member, ORG, "org-infrastructure")
            .await
            .unwrap()
    );
    assert!(
        !presence
            .applies(&member, ORG, CONSTRUCTOR_RESEARCH_KIT)
            .await
            .unwrap()
    );
    installer
        .install_for_organization(&caller(ORG_ADMIN, ORG), ORG, CONSTRUCTOR_RESEARCH_KIT, None)
        .await
        .unwrap();
    // The organization's answer is its projects' answer too.
    for tenant in [ORG, PROJECT] {
        assert!(
            presence
                .applies(&member, tenant, CONSTRUCTOR_RESEARCH_KIT)
                .await
                .unwrap(),
            "{tenant}"
        );
    }
    assert!(!presence.applies(&member, ORG, "no-such-kit").await.unwrap());
}

#[tokio::test]
async fn a_project_installs_constructor_research_on_its_own() {
    use crate::kit_registry::port::{CONSTRUCTOR_RESEARCH_KIT, InstalledKits, KitPresence};
    let (installer, _) = installer();
    let installer = Arc::new(installer);
    let presence = InstalledKits::new(Arc::clone(&installer));
    let admin = caller(ORG_ADMIN, ORG);
    let member = caller(MEMBER, ORG);
    // It brings no model, so one project may have it.
    let own = installer
        .install_for_project(&admin, PROJECT, CONSTRUCTOR_RESEARCH_KIT, None)
        .await
        .unwrap();
    assert_eq!(own.kind, KIND_PROJECT);
    let installed = installer
        .installed_in_project(&member, PROJECT)
        .await
        .unwrap();
    assert!(slugs(&installed.project).contains(&CONSTRUCTOR_RESEARCH_KIT));
    assert!(slugs(&installed.effective).contains(&CONSTRUCTOR_RESEARCH_KIT));
    // The project has it; its organization does not.
    assert!(
        presence
            .applies(&member, PROJECT, CONSTRUCTOR_RESEARCH_KIT)
            .await
            .unwrap()
    );
    assert!(
        !presence
            .applies(&member, ORG, CONSTRUCTOR_RESEARCH_KIT)
            .await
            .unwrap()
    );
    // And it goes again with the project's installation.
    installer
        .uninstall_for_project(&admin, PROJECT, CONSTRUCTOR_RESEARCH_KIT)
        .await
        .unwrap();
    assert!(
        !presence
            .applies(&member, PROJECT, CONSTRUCTOR_RESEARCH_KIT)
            .await
            .unwrap()
    );
}
