//! What studio-organizations tells the portal when a tenant on screen
//! changes (`docs/events-catalog.md`, the `tenant` section): a rename, a new
//! logo, a deletion, a changed grant. A prompt (rule E5): the path bar, the
//! Team and People screens read again; nothing is carried but what changed.

use std::sync::Arc;

use serde_json::Value;
use toolkit::client_hub::ClientHub;
use uuid::Uuid;

use crate::studio_events::{StudioEvent, StudioEventPublisher};

/// An organization or a workspace was renamed.
pub const RENAMED: &str = "tenant.renamed";
/// A tenant's logo was set or removed.
pub const LOGO_CHANGED: &str = "tenant.logo_changed";
/// An organization was deleted.
pub const DELETED: &str = "tenant.deleted";
/// A grant of the organization's access config changed.
pub const ACCESS_CHANGED: &str = "tenant.access_changed";
/// Every kind this gear publishes, for the catalogue check.
#[cfg(test)]
pub const KINDS: [&str; 4] = [RENAMED, LOGO_CHANGED, DELETED, ACCESS_CHANGED];

const SOURCE: &str = "studio-organizations";
const SUBJECT: &str = "tenant";

/// Publish `kind` about `tenant` on `org`'s channel, when studio-events runs.
pub fn publish(hub: &Arc<ClientHub>, org: Uuid, tenant: Uuid, kind: &str, mut payload: Value) {
    let Ok(p) = hub.get::<dyn StudioEventPublisher>() else {
        return;
    };
    if let Some(obj) = payload.as_object_mut() {
        obj.insert("tenant_id".into(), Value::String(tenant.to_string()));
        obj.insert("organization_id".into(), Value::String(org.to_string()));
    }
    p.publish(
        StudioEvent::new(org, kind, SUBJECT, tenant.to_string(), SOURCE).with_payload(payload),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tenant_kinds_are_the_ones_the_catalogue_lists() {
        let published: std::collections::BTreeSet<String> =
            KINDS.into_iter().map(str::to_owned).collect();
        assert_eq!(
            published,
            crate::api_contract::events::documented_kinds("tenant."),
            "docs/events-catalog.md and studio-organizations disagree on the `tenant.*` kinds"
        );
    }
}
