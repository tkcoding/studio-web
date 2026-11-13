//! Constructor Studio kit registry.
//!
//! The first vertical slice deliberately keeps kit bytes in their canonical
//! Git repositories. This gear owns catalogue metadata and project-scoped
//! desired installations; `cfs` remains the only component that materializes
//! kit files into a checkout.

mod bundles;
mod contents;
mod events;
mod inbox;
pub(crate) mod installed;
mod manifest;
mod mcp;
mod models;
mod phase;
pub mod port;
mod rest;
pub(crate) mod service;
mod shelf;
mod shelf_bundles;

pub(crate) use installed::KITS_INSTALLED_METADATA_TYPE;
pub(crate) use mcp::tools as mcp_tools;

use std::sync::{Arc, OnceLock};

use account_management_sdk::AccountManagementClient;
use async_trait::async_trait;
use axum::Router;
use toolkit::api::OpenApiRegistry;
use toolkit::{Gear, GearCtx};

use installed::{AmInstalledStore, HubAuthority, KitInstaller};
use service::KitRegistryService;

#[toolkit::gear(
    name = "studio-kits",
    deps = [account_management],
    capabilities = [rest]
)]
#[derive(Default)]
pub struct StudioKitsGear {
    service: OnceLock<Arc<KitRegistryService>>,
    installer: OnceLock<Arc<KitInstaller>>,
    access: OnceLock<crate::org_scope::OrgAccess>,
}

#[async_trait]
impl Gear for StudioKitsGear {
    async fn init(&self, ctx: &GearCtx) -> anyhow::Result<()> {
        let account_management = ctx.client_hub().get::<dyn AccountManagementClient>()?;
        let service = Arc::new(KitRegistryService::new(
            crate::model_metadata::client_for(
                ctx,
                account_management.clone(),
                service::MODEL_KINDS,
            ),
            ctx.client_hub(),
        )?);
        // Which kits apply to an organization (ADR-0069 §4): plain tenant
        // metadata, written as the gear after it has checked who asks.
        let installer = Arc::new(
            KitInstaller::new(
                service.catalogue(),
                Arc::new(AmInstalledStore::new(account_management.clone())),
                Arc::new(HubAuthority::new(ctx.client_hub())),
            )
            // An organization's own kits are read through its connections
            // (ADR-0068 phase 7).
            .with_reader(shelf::reader(ctx.client_hub()))
            // A kit's model overlay goes into the organization's model through
            // the domain model's port (ADR-0067 §6).
            .with_models(Arc::new(models::HubModels(ctx.client_hub())))
            // `kit.installed` / `kit.uninstalled`, so the shell reads the kits
            // again when somebody else changes them.
            .with_events(Arc::new(events::HubEvents(ctx.client_hub()))),
        );
        // An organization's own kits' screens, read from its repository at the
        // pinned commit (ADR-0068 phases 5 and 7).
        service
            .bundles()
            .add_source(Arc::new(shelf_bundles::ShelfBundles::new(
                Arc::clone(&installer) as Arc<dyn shelf_bundles::ShelfLookup>,
            )));
        let access = crate::org_scope::OrgAccess(Arc::new(
            crate::studio_session::sdk::TenantMembership::new(account_management),
        ));
        // The kits a new project asked for, for its creation run
        // (studio-organizations, `organizations.project_create`).
        ctx.client_hub()
            .register::<dyn port::ProjectKitRequests>(Arc::new(port::KitRequests::new(Arc::clone(
                &service,
            )))
                as Arc<dyn port::ProjectKitRequests>);
        // Whether a kit applies to an organization, for the gears that act
        // only where a kit is installed (studio-environments: Research).
        ctx.client_hub()
            .register::<dyn port::KitPresence>(Arc::new(port::InstalledKits::new(Arc::clone(
                &installer,
            ))) as Arc<dyn port::KitPresence>);
        self.service
            .set(service)
            .map_err(|_| anyhow::anyhow!("studio-kits already initialized"))?;
        self.installer
            .set(installer)
            .map_err(|_| anyhow::anyhow!("studio-kits already initialized"))?;
        self.access
            .set(access)
            .map_err(|_| anyhow::anyhow!("studio-kits already initialized"))?;
        Ok(())
    }
}

#[async_trait]
impl toolkit::contracts::RestApiCapability for StudioKitsGear {
    fn register_rest(
        &self,
        _ctx: &GearCtx,
        router: Router,
        openapi: &dyn OpenApiRegistry,
    ) -> anyhow::Result<Router> {
        let service = self
            .service
            .get()
            .ok_or_else(|| anyhow::anyhow!("studio-kits not initialized"))?
            .clone();
        let installer = self
            .installer
            .get()
            .ok_or_else(|| anyhow::anyhow!("studio-kits not initialized"))?
            .clone();
        let access = self
            .access
            .get()
            .ok_or_else(|| anyhow::anyhow!("studio-kits not initialized"))?
            .clone();
        Ok(rest::register_routes(
            router, openapi, service, installer, access,
        ))
    }
}
