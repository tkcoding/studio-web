//! The model part of a kit (ADR-0067 §6, ADR-0068 §5): installing a kit for
//! an organization imports its overlay into the organization's Studio domain
//! model; uninstalling removes it; installing another version applies the
//! difference. Done through the domain model's port
//! (`DomainObjects::sync_kit_model`), as this gear's service identity in the
//! organization, after the installer has checked the caller.
//!
//! Which overlay a kit has: a built-in kit's compiled-in `kit.json`
//! ([`super::manifest::builtin_manifest`]), an organization's own kit's
//! manifest at the commit its shelf pins, and none for an official kit
//! (`.cf-studio-kit.toml` brings working material only).
//!
//! The model is the organization's, so only kits that apply to the whole
//! organization — base kits and the organization's own — bring theirs
//! ([`KitInstaller::reconcile_models`]). A kit that brings a model is not
//! installed for one project (`MODEL_KIT_NOT_FOR_PROJECT`).
//!
//! **The overlay is copied into each organization's stored model** (marked
//! with its origin), not layered over a shared one. See
//! `docs/design/studio-kits.md` §3.10 for why, and for the gap it leaves.

use std::sync::Arc;

use toolkit::client_hub::ClientHub;
use toolkit_security::SecurityContext;
use uuid::Uuid;

use super::installed::{InstalledKit, KitInstaller, PLATFORM_TENANT, Refusal, service_context};
use super::manifest::{builtin_manifest, overlay_of};
use super::service::{KitDescriptor, SHELF_BUILTIN, SHELF_ORGANIZATION};
use crate::domain_model::port::{DomainObjects, KitModelError, KitOverlay};

/// The `failed_precondition` kind for an overlay the organization's model
/// already has parts of from somebody else.
pub const KIT_MODEL_CONFLICT: &str = "KIT_MODEL_CONFLICT";
/// The `failed_precondition` kind for installing a model-bearing kit in one
/// project: the model is the organization's.
pub const MODEL_KIT_NOT_FOR_PROJECT: &str = "MODEL_KIT_NOT_FOR_PROJECT";

/// Where the domain model's port is.
pub trait ModelPort: Send + Sync {
    fn get(&self) -> Option<Arc<dyn DomainObjects>>;
}

/// The port the domain model publishes on the ClientHub, looked up when
/// used: it registers in its REST phase.
pub struct HubModels(pub Arc<ClientHub>);

impl ModelPort for HubModels {
    fn get(&self) -> Option<Arc<dyn DomainObjects>> {
        self.0.get::<dyn DomainObjects>().ok()
    }
}

/// One port, always (tests).
#[cfg(test)]
pub struct FixedModels(pub Arc<dyn DomainObjects>);

#[cfg(test)]
impl ModelPort for FixedModels {
    fn get(&self) -> Option<Arc<dyn DomainObjects>> {
        Some(self.0.clone())
    }
}

/// What a kit at one version brings into the model.
pub enum KitModel {
    /// This overlay.
    Overlay(KitOverlay),
    /// Nothing.
    Nothing,
    /// Not known here (an organization's kit whose shelf now pins another
    /// commit than the one installed): what the model carries stays.
    Unknown,
}

/// Turn a model refusal into the installer's.
fn refusal(e: anyhow::Error) -> Refusal {
    match e.downcast_ref::<KitModelError>() {
        Some(KitModelError::Conflict(m)) => Refusal::ModelConflict(m.clone()),
        Some(KitModelError::Invalid(m)) => Refusal::Invalid(m.clone()),
        None => Refusal::Internal(e),
    }
}

impl KitInstaller {
    /// What `kit` at `version` brings into `org`'s model.
    pub(super) async fn model_of(
        &self,
        org: Uuid,
        kit: &KitDescriptor,
        version: &str,
    ) -> Result<KitModel, Refusal> {
        let manifest = match kit.shelf.as_str() {
            SHELF_BUILTIN => builtin_manifest(&kit.slug),
            SHELF_ORGANIZATION => match self.pinned_manifest(org, &kit.slug, version).await? {
                Some(manifest) => Some(manifest),
                None => return Ok(KitModel::Unknown),
            },
            _ => None,
        };
        Ok(match manifest.map(|m| overlay_of(&m)).transpose() {
            Ok(Some(Some(overlay))) => KitModel::Overlay(overlay),
            Ok(_) => KitModel::Nothing,
            Err(e) => return Err(Refusal::Invalid(e)),
        })
    }

    /// Apply `kit`'s overlay at `version` to `org`'s model before the
    /// installation is recorded: a conflict refuses the install and nothing
    /// is recorded.
    pub(super) async fn apply_model(
        &self,
        org: Uuid,
        kit: &KitDescriptor,
        version: &str,
    ) -> Result<(), Refusal> {
        let Some(port) = self.models() else {
            return Ok(());
        };
        if let KitModel::Overlay(overlay) = self.model_of(org, kit, version).await? {
            port.sync_kit_model(&service_context(org)?, &kit.slug, version, Some(&overlay))
                .await
                .map_err(refusal)?;
        }
        Ok(())
    }

    /// Make `org`'s model carry the overlays of the kits that apply to the
    /// whole organization (base and its own), at their versions, and nothing
    /// of a kit that no longer applies. Answers what could not be applied,
    /// one sentence each: a read of the installed kits does not fail for it.
    pub async fn reconcile_models(&self, org: Uuid) -> Result<Vec<String>, Refusal> {
        let Some(port) = self.models() else {
            return Ok(Vec::new());
        };
        if org == PLATFORM_TENANT {
            return Ok(Vec::new());
        }
        let ctx = service_context(org)?;
        let installed = self.installed(&ctx, org).await?;
        let carried = port.kit_models(&ctx).await.map_err(Refusal::Internal)?;
        let mut keep: Vec<String> = Vec::new();
        let mut problems = Vec::new();
        for kit in &installed.effective {
            let Ok(descriptor) = self.kit_for(org, &kit.kit_slug).await else {
                continue;
            };
            match self.model_of(org, &descriptor, &kit.version).await? {
                KitModel::Overlay(overlay) => {
                    keep.push(kit.kit_slug.clone());
                    // Same-version sync is idempotent and adopts the known
                    // legacy property source before any future upgrade.
                    // It also captures organization tombstones after edits.
                    if let Err(e) = port
                        .sync_kit_model(&ctx, &kit.kit_slug, &kit.version, Some(&overlay))
                        .await
                    {
                        problems.push(format!("{}: {e:#}", kit.kit_slug));
                    }
                }
                KitModel::Unknown => keep.push(kit.kit_slug.clone()),
                KitModel::Nothing => {}
            }
        }
        for slug in carried.keys().filter(|s| !keep.contains(*s)) {
            if let Err(e) = port.sync_kit_model(&ctx, slug, "", None).await {
                problems.push(format!("{slug}: {e:#}"));
            }
        }
        for p in &problems {
            tracing::warn!(organization_id = %org, problem = %p, "studio-kits: a kit's model was not applied");
        }
        Ok(problems)
    }

    /// Whether a kit applies to `project` (base, its organization's or its
    /// own), and at which version.
    pub async fn applies_to_project(
        &self,
        ctx: &SecurityContext,
        project: Uuid,
        slug: &str,
    ) -> Result<Option<InstalledKit>, Refusal> {
        Ok(self
            .installed_in_project(ctx, project)
            .await?
            .effective
            .into_iter()
            .find(|k| k.kit_slug == slug))
    }
}

#[cfg(test)]
impl KitInstaller {
    /// Import kits' models through `port`: for a test outside this gear,
    /// which cannot name [`ModelPort`].
    pub fn with_model_port(self, port: Arc<dyn DomainObjects>) -> Self {
        self.with_models(Arc::new(FixedModels(port)))
    }
}
