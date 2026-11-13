//! What the installer tells the portal when a kit starts or stops applying,
//! over studio-events (`docs/events-catalog.md`, the `kit` section).
//!
//! A prompt (rule E5), not the data: the shell reads the installed kits again
//! (`GET /installed-kits`, `GET /mfe-manifests`) and registers or unloads the
//! kit's screens, so another person's install shows without a reload, also
//! for a kit that brings no model (whose install publishes no
//! `domain.model_changed`).

use std::sync::Arc;

use serde_json::json;
use toolkit::client_hub::ClientHub;
use uuid::Uuid;

use crate::studio_events::{StudioEvent, StudioEventPublisher};

/// A kit was installed, or installed at another version.
pub const INSTALLED: &str = "kit.installed";
/// A kit stopped applying where it was installed.
pub const UNINSTALLED: &str = "kit.uninstalled";
/// Every kind this gear publishes, for the catalogue check.
#[cfg(test)]
pub const KINDS: [&str; 2] = [INSTALLED, UNINSTALLED];

const SOURCE: &str = "studio-kits";
const SUBJECT: &str = "kit";

/// Where a kit was installed or uninstalled.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    /// A base kit: every organization's. Heard on the platform's channel.
    Base,
    Organization(Uuid),
    /// A project of an organization: heard on the organization's channel.
    Project {
        org: Uuid,
        project: Uuid,
    },
}

/// One change, as published.
pub fn event(kind: &str, level: Level, slug: &str, version: Option<&str>) -> StudioEvent {
    let (tenant, level_name, org, project) = match level {
        Level::Base => (super::installed::PLATFORM_TENANT, "base", None, None),
        Level::Organization(org) => (org, "organization", Some(org), None),
        Level::Project { org, project } => (org, "project", Some(org), Some(project)),
    };
    StudioEvent::new(tenant, kind, SUBJECT, slug, SOURCE).with_payload(json!({
        "kit_slug": slug,
        "version": version,
        "level": level_name,
        "organization_id": org.map(|o| o.to_string()),
        "project_id": project.map(|p| p.to_string()),
    }))
}

/// The studio-events publisher, resolved per publish: studio-events may come
/// up after this gear, and a build without it publishes nothing.
pub struct HubEvents(pub Arc<ClientHub>);

impl StudioEventPublisher for HubEvents {
    fn publish(&self, event: StudioEvent) {
        if let Ok(p) = self.0.get::<dyn StudioEventPublisher>() {
            p.publish(event);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The kinds this gear publishes are the ones the events catalogue lists.
    #[test]
    fn the_kit_kinds_are_the_ones_the_catalogue_lists() {
        let published: std::collections::BTreeSet<String> =
            KINDS.into_iter().map(str::to_owned).collect();
        assert_eq!(
            published,
            crate::api_contract::events::documented_kinds("kit."),
            "docs/events-catalog.md and studio-kits disagree on the `kit.*` kinds"
        );
    }

    #[test]
    fn a_project_install_is_heard_in_its_organization() {
        let org = Uuid::new_v4();
        let project = Uuid::new_v4();
        let e = event(
            INSTALLED,
            Level::Project { org, project },
            "hello-kit",
            Some("0.1.0"),
        );
        assert_eq!(e.tenant_id, org);
        assert_eq!(e.subject_type, "kit");
        assert_eq!(e.subject_id, "hello-kit");
        assert_eq!(e.payload["level"], "project");
        assert_eq!(e.payload["project_id"], project.to_string());
        let base = event(UNINSTALLED, Level::Base, "hello-kit", None);
        assert_eq!(base.tenant_id, super::super::installed::PLATFORM_TENANT);
        assert!(base.payload["version"].is_null());
    }
}
