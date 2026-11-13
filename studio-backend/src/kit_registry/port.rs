//! What another gear asks studio-kits for, through the ClientHub.
//!
//! - [`ProjectKitRequests`]: the kits a project asked for, and a request for
//!   one more -- what a project's creation run (studio-organizations,
//!   `organizations.project_create`) records for the kits picked when it was
//!   created. The same desired-state write `POST
//!   /studio-kits/v1/projects/{project_id}/installations` makes; materializing
//!   stays `cfs`'s job.
//! - [`KitPresence`]: whether a kit applies to an organization or a project --
//!   what a gear asks before it does what only a kit brings (ADR-0070 §7,
//!   decision 5: `KIT_NOT_INSTALLED`). studio-environments asks for the
//!   Constructor Research kit ([`CONSTRUCTOR_RESEARCH_KIT`]).

use std::sync::Arc;

use async_trait::async_trait;
use toolkit_security::SecurityContext;
use uuid::Uuid;

use super::installed::KitInstaller;
pub use super::service::CONSTRUCTOR_RESEARCH_KIT;
use super::service::KitRegistryService;

#[async_trait]
pub trait ProjectKitRequests: Send + Sync + 'static {
    /// The slugs of the kits the project asked for.
    async fn requested(
        &self,
        ctx: &SecurityContext,
        project_id: Uuid,
    ) -> anyhow::Result<Vec<String>>;

    /// Ask for `kit_slug` at `version` (its catalogue default when `None`),
    /// copied into all of the project's repositories. A kit the catalogue does
    /// not offer is refused.
    async fn request(
        &self,
        ctx: &SecurityContext,
        project_id: Uuid,
        kit_slug: &str,
        version: Option<&str>,
    ) -> anyhow::Result<()>;
}

/// studio-kits' [`ProjectKitRequests`].
pub struct KitRequests {
    service: Arc<KitRegistryService>,
}

impl KitRequests {
    pub(super) fn new(service: Arc<KitRegistryService>) -> Self {
        Self { service }
    }
}

#[async_trait]
impl ProjectKitRequests for KitRequests {
    async fn requested(
        &self,
        ctx: &SecurityContext,
        project_id: Uuid,
    ) -> anyhow::Result<Vec<String>> {
        Ok(self
            .service
            .list_installations(ctx, project_id)
            .await?
            .into_iter()
            .map(|i| i.kit_slug)
            .collect())
    }

    async fn request(
        &self,
        ctx: &SecurityContext,
        project_id: Uuid,
        kit_slug: &str,
        version: Option<&str>,
    ) -> anyhow::Result<()> {
        let default = self
            .service
            .installable()
            .into_iter()
            .find(|k| k.slug == kit_slug)
            .map(|k| k.default_version)
            .ok_or_else(|| anyhow::anyhow!("the catalogue offers no kit `{kit_slug}`"))?;
        self.service
            .request_installation(
                ctx,
                project_id,
                kit_slug,
                version.unwrap_or(&default),
                "copy",
                "all-repositories",
            )
            .await
            .map(|_| ())
    }
}

/// Whether a kit applies where a gear is asked to act.
#[async_trait]
pub trait KitPresence: Send + Sync + 'static {
    /// Does `kit_slug` apply where `tenant` is? For a project: its effective
    /// kits, base ∪ organization ∪ the project's own. For an organization (or
    /// any other tenant of one): base ∪ the organization's own. The caller has
    /// already been shown to reach `tenant`; the installations are read as
    /// this gear's service.
    async fn applies(
        &self,
        ctx: &SecurityContext,
        tenant: Uuid,
        kit_slug: &str,
    ) -> anyhow::Result<bool>;

    /// The slugs of every kit that applies where `tenant` is, as
    /// [`Self::applies`] reads them: what a reader of several kits' signals
    /// asks once (studio-organizations' project status and Overview).
    async fn effective(&self, ctx: &SecurityContext, tenant: Uuid) -> anyhow::Result<Vec<String>>;
}

/// studio-kits' [`KitPresence`]: the same answer `GET /installed-kits` gives.
pub struct InstalledKits {
    installer: Arc<KitInstaller>,
}

impl InstalledKits {
    pub(crate) fn new(installer: Arc<KitInstaller>) -> Self {
        Self { installer }
    }
}

#[async_trait]
impl KitPresence for InstalledKits {
    async fn applies(
        &self,
        ctx: &SecurityContext,
        tenant: Uuid,
        kit_slug: &str,
    ) -> anyhow::Result<bool> {
        Ok(self
            .effective(ctx, tenant)
            .await?
            .iter()
            .any(|k| k == kit_slug))
    }

    async fn effective(&self, ctx: &SecurityContext, tenant: Uuid) -> anyhow::Result<Vec<String>> {
        let installed = if self.installer.store().is_project(ctx, tenant).await {
            self.installer.installed_in_project(ctx, tenant).await
        } else {
            self.installer.installed(ctx, tenant).await
        }
        .map_err(|refusal| anyhow::anyhow!("the installed kits could not be read: {refusal:?}"))?;
        Ok(installed
            .effective
            .into_iter()
            .map(|k| k.kit_slug)
            .collect())
    }
}
