//! Inbox sources from kits (ADR-0068 §6, phase 4).
//!
//! A kit declares, in its manifest's `inbox`, what waits on whom. Two kinds:
//!
//! - `query` (the default): a query over its objects. `query` is the body
//!   `POST /studio-domain-model/v1/query` takes, with the string `"$me"`
//!   standing for the person whose Inbox is read; `title` names an item
//!   (`{field}` is a field of the row); `workspace_field` names the field that
//!   holds the workspace an item is in.
//! - `endpoint`: a gear's route (`path`, which the kit's `permissions.reads`
//!   names) that answers `{items: [{id, title?, …}]}` for whoever calls it,
//!   from records that are not domain objects -- a deploy, a sign-in.
//! - `studio`: one of the sources studio-user's Inbox reads itself
//!   (`review-requests`, `pull-requests`), which a built-in kit owns
//!   (project-specs, project-git; ADR-0070 §7). Listed only while the kit
//!   applies to the whole organization, so an organization without it has no
//!   such items. A project's own installation does not turn it on: the Inbox
//!   reads by workspace, not by project.
//!
//! This gear only says which sources apply to an organization -- those of the
//! kits installed for the whole of it (base and its own), at the version
//! installed. A built-in kit that may also be installed for one project
//! brings its `endpoint` sources to every organization: its route answers only
//! for the projects that have the kit, which this gear cannot list. A `query`
//! source of a project's own kit is not listed (it would need the project's
//! PDP scope). studio-user's Inbox runs them as the person
//! (`GET /studio-user/v1/me/inbox`), so the PDP and the route decide what each
//! person sees.

use toolkit_security::SecurityContext;
use uuid::Uuid;

use super::installed::{KitInstaller, LEVEL_PROJECT, Refusal};
use super::manifest::{
    INBOX_KIND_ENDPOINT, INBOX_KIND_STUDIO, ManifestInboxSource, builtin_manifest,
};
use super::service::{SHELF_BUILTIN, SHELF_ORGANIZATION};

/// One source, with the kit it comes from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KitInboxSource {
    pub kit_slug: String,
    pub kit_name: String,
    pub kit_version: String,
    pub source: ManifestInboxSource,
}

impl KitInstaller {
    /// The Inbox sources of the kits that apply to the organization `org`.
    /// The caller has been shown to reach it. The kits' models are brought
    /// up to date first, so the fields the sources query exist.
    pub async fn inbox_sources(
        &self,
        ctx: &SecurityContext,
        org: Uuid,
    ) -> Result<Vec<KitInboxSource>, Refusal> {
        let installed = self.installed(ctx, org).await?;
        let org = installed.organization_id;
        self.reconcile_models(org).await?;
        let mut out = Vec::new();
        for kit in &installed.effective {
            let Ok(descriptor) = self.kit_for(org, &kit.kit_slug).await else {
                continue;
            };
            let manifest = match descriptor.shelf.as_str() {
                SHELF_BUILTIN => builtin_manifest(&kit.kit_slug),
                SHELF_ORGANIZATION => {
                    self.pinned_manifest(org, &kit.kit_slug, &kit.version)
                        .await?
                }
                _ => None,
            };
            for source in manifest.into_iter().flat_map(|m| m.inbox) {
                if source.kind() == INBOX_KIND_STUDIO {
                    // Only a built-in kit turns one of Studio's own on.
                    if descriptor.shelf != SHELF_BUILTIN {
                        continue;
                    }
                } else if source.kind() != INBOX_KIND_ENDPOINT && source.query.is_none() {
                    continue;
                }
                out.push(KitInboxSource {
                    kit_slug: kit.kit_slug.clone(),
                    kit_name: descriptor.name.clone(),
                    kit_version: kit.version.clone(),
                    source,
                });
            }
        }
        // A built-in kit a project may have on its own: its `endpoint`
        // sources, which answer only where the kit applies.
        for kit in self.library().iter().filter(|k| {
            k.shelf == SHELF_BUILTIN
                && k.levels.iter().any(|l| l == LEVEL_PROJECT)
                && !installed.effective.iter().any(|e| e.kit_slug == k.slug)
        }) {
            for source in builtin_manifest(&kit.slug)
                .into_iter()
                .flat_map(|m| m.inbox)
                .filter(|s| s.kind() == INBOX_KIND_ENDPOINT)
            {
                out.push(KitInboxSource {
                    kit_slug: kit.slug.clone(),
                    kit_name: kit.name.clone(),
                    kit_version: kit.default_version.clone(),
                    source,
                });
            }
        }
        Ok(out)
    }
}
