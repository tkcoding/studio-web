//! An organization's own kits (ADR-0068 §4 and phase 7): the `organization`
//! shelf of the library.
//!
//! An organization registers a kit source — a repository one of its own
//! connections reaches, a directory in it and a ref. Studio reads the kit's
//! manifest there ([`super::manifest`]: `kit.json`, else
//! `.cf-studio-kit.toml`), pins it to the newest commit that touched that
//! directory at the ref, checks it, and keeps the manifest as it was at that
//! commit on the organization's installed-kits document. Describing the kit
//! afterwards reads nothing; refreshing reads the ref again and re-pins.
//!
//! The shelf is the organization's alone: nobody else's catalogue lists it,
//! and its slugs may not shadow a built-in or official kit
//! ([`KIT_SLUG_TAKEN`]). Adding, refreshing and removing need the same
//! authority as installing (`kit.manage`); a kit the organization has
//! installed is not removed from its shelf ([`KIT_INSTALLED`]). Installing and
//! uninstalling go through the installer like any other kit's.

use std::sync::Arc;

use anyhow::anyhow;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use toolkit_security::SecurityContext;
use uuid::Uuid;

use super::installed::{KitInstaller, Refusal, service_context};
use super::manifest::{
    CF_STUDIO_KIT_TOML, KIT_JSON, KitManifest, MANIFEST_FILES, read_cf_studio_kit, read_kit_json,
};
use super::service::{KitDescriptor, SHELF_ORGANIZATION, normalize_version, now_rfc3339};

/// The `failed_precondition` kind for a shelf kit whose slug a built-in or
/// official kit already has.
pub const KIT_SLUG_TAKEN: &str = "KIT_SLUG_TAKEN";
/// The `failed_precondition` kind for removing from the shelf a kit the
/// organization has installed.
pub const KIT_INSTALLED: &str = "KIT_INSTALLED";

/// One kit on an organization's shelf, as stored.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShelfKit {
    /// Its catalogue entry: shelf `organization`, `default_version` the pinned
    /// commit, `manifest_path` the file it was read from.
    pub kit: KitDescriptor,
    pub origin: KitOrigin,
    /// The manifest at the pinned commit.
    pub manifest: KitManifest,
}

/// Where a shelf kit came from.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct KitOrigin {
    pub connection_id: Uuid,
    pub provider: String,
    /// `owner/name`.
    pub repository: String,
    /// The kit's directory in the repository; empty for its root.
    pub path: String,
    /// The ref it follows; `None` is the default branch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_ref: Option<String>,
    /// The commit it is pinned to.
    pub commit: String,
    /// [`KIT_JSON`] or [`CF_STUDIO_KIT_TOML`].
    pub manifest_file: String,
    pub added_by: String,
    pub added_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refreshed_at: Option<String>,
}

/// What a caller names to add a kit: where it is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourceInput {
    pub connection_id: Uuid,
    pub repository: String,
    pub path: String,
    pub git_ref: Option<String>,
    /// Which kit of a multi-kit `.cf-studio-kit.toml`.
    pub slug: Option<String>,
}

/// A manifest read from a repository, at the commit it was pinned to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Fetched {
    pub provider: String,
    pub commit: String,
    /// [`KIT_JSON`] or [`CF_STUDIO_KIT_TOML`].
    pub file: &'static str,
    pub body: String,
    /// A web address of the repository, when the provider has a known one.
    pub repository_url: String,
}

/// Reads a kit's manifest through one of the organization's connections.
#[async_trait]
pub trait KitSourceReader: Send + Sync {
    /// Pin `input` to a commit and read its manifest there, as `ctx` acting
    /// in `org`.
    async fn fetch(
        &self,
        ctx: &SecurityContext,
        org: Uuid,
        input: &SourceInput,
    ) -> Result<Fetched, Refusal>;

    /// One file of the kit's repository at the commit `origin` is pinned to
    /// (`path` from the repository's root), text or not: a built bundle's
    /// chunk ([`super::shelf_bundles`]). `None` when there is no such file.
    async fn read_file(
        &self,
        ctx: &SecurityContext,
        org: Uuid,
        origin: &KitOrigin,
        path: &str,
    ) -> Result<Option<Vec<u8>>, Refusal> {
        let _ = (ctx, org, origin, path);
        Err(Refusal::Internal(anyhow!(
            "this reader cannot read a kit's files"
        )))
    }
}

/// No connector in this assembly: every source is unreadable.
pub struct NoReader;

#[async_trait]
impl KitSourceReader for NoReader {
    async fn fetch(
        &self,
        _: &SecurityContext,
        _: Uuid,
        _: &SourceInput,
    ) -> Result<Fetched, Refusal> {
        Err(Refusal::Internal(anyhow!(
            "studio-connector is not running here, so no repository can be read"
        )))
    }
}

/// Check what a caller named, before anything is read.
pub fn normalize_input(mut input: SourceInput) -> Result<SourceInput, Refusal> {
    let repository = input.repository.trim().trim_matches('/').to_owned();
    let parts: Vec<&str> = repository.split('/').collect();
    let well_formed = parts.len() >= 2
        && repository.len() <= 200
        && parts.iter().all(|p| {
            !p.is_empty()
                && *p != "."
                && *p != ".."
                && p.chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        });
    if !well_formed {
        return Err(Refusal::Invalid(format!(
            "`repository` is `owner/name`, not `{}`",
            input.repository
        )));
    }
    let path = input.path.trim().trim_matches('/').to_owned();
    if path.len() > 200
        || path.split('/').any(|p| p == ".." || p == ".")
        || path.chars().any(|c| c.is_control() || c == '\\')
    {
        return Err(Refusal::Invalid(format!(
            "`path` is a directory of the repository, not `{}`",
            input.path
        )));
    }
    let git_ref = match input
        .git_ref
        .as_deref()
        .map(str::trim)
        .filter(|r| !r.is_empty())
    {
        Some(r) => Some(normalize_version(r).map_err(|e| Refusal::Invalid(format!("`ref`: {e}")))?),
        None => None,
    };
    input.repository = repository;
    input.path = path;
    input.git_ref = git_ref;
    input.slug = input
        .slug
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty());
    Ok(input)
}

/// A shelf kit and what it brings, as the library describes a kit.
pub fn detail(kit: &ShelfKit) -> super::contents::KitDetail {
    super::contents::KitDetail {
        kit: kit.kit.clone(),
        contents: super::manifest::contents_of(&kit.manifest),
        manifest: Some(if kit.origin.manifest_file == KIT_JSON {
            super::contents::MANIFEST_KIT_JSON
        } else {
            super::contents::MANIFEST_CF_STUDIO_KIT
        }),
    }
}

/// The shelf kit a fetched manifest makes: read, checked, its catalogue
/// entry built. `taken` says whether the library already has a slug.
pub fn shelf_kit(
    input: &SourceInput,
    fetched: Fetched,
    by: String,
    at: String,
    taken: &dyn Fn(&str) -> bool,
) -> Result<ShelfKit, Refusal> {
    let manifest = match fetched.file {
        KIT_JSON => read_kit_json(&fetched.body),
        _ => read_cf_studio_kit(&fetched.body, input.slug.as_deref()),
    }
    .map_err(Refusal::Invalid)?;
    if let Some(want) = &input.slug
        && *want != manifest.slug
    {
        return Err(Refusal::Invalid(format!(
            "the manifest describes `{}`, not `{want}`",
            manifest.slug
        )));
    }
    if taken(&manifest.slug) {
        return Err(Refusal::SlugTaken(manifest.slug));
    }
    let commit = normalize_version(&fetched.commit)
        .map_err(|e| Refusal::Internal(anyhow!("the pinned commit: {e}")))?;
    let manifest_path = if input.path.is_empty() {
        fetched.file.to_owned()
    } else {
        format!("{}/{}", input.path, fetched.file)
    };
    let levels = if manifest.levels.is_empty() {
        vec!["organization".to_owned()]
    } else {
        manifest.levels.clone()
    };
    Ok(ShelfKit {
        kit: KitDescriptor {
            slug: manifest.slug.clone(),
            name: manifest.name.trim().to_owned(),
            description: manifest.description.clone(),
            publisher: manifest.publisher.clone(),
            visibility: "private".to_owned(),
            source: fetched.provider.clone(),
            repository_url: fetched.repository_url,
            default_version: commit.clone(),
            manifest_path,
            shelf: SHELF_ORGANIZATION.to_owned(),
            levels,
        },
        origin: KitOrigin {
            connection_id: input.connection_id,
            provider: fetched.provider,
            repository: input.repository.clone(),
            path: input.path.clone(),
            git_ref: input.git_ref.clone(),
            commit,
            manifest_file: fetched.file.to_owned(),
            added_by: by,
            added_at: at,
            refreshed_at: None,
        },
        manifest,
    })
}

impl KitInstaller {
    /// The organization `tenant` belongs to's shelf. The caller has been
    /// shown to reach it.
    pub async fn shelf(
        &self,
        ctx: &SecurityContext,
        tenant: Uuid,
    ) -> Result<Vec<ShelfKit>, Refusal> {
        let org = self.store().organization_of(ctx, tenant).await;
        if org == super::installed::PLATFORM_TENANT {
            return Ok(Vec::new());
        }
        Ok(self.store().read(&service_context(org)?, org).await?.shelf)
    }

    /// One kit of `org`'s shelf.
    pub async fn shelf_kit(
        &self,
        ctx: &SecurityContext,
        tenant: Uuid,
        slug: &str,
    ) -> Result<Option<ShelfKit>, Refusal> {
        Ok(self
            .shelf(ctx, tenant)
            .await?
            .into_iter()
            .find(|k| k.kit.slug == slug))
    }

    /// Read a source without keeping it: what adding it would add.
    pub async fn preview_shelf_kit(
        &self,
        ctx: &SecurityContext,
        tenant: Uuid,
        input: SourceInput,
    ) -> Result<ShelfKit, Refusal> {
        let org = self.require_shelf_admin(ctx, tenant).await?;
        let input = normalize_input(input)?;
        self.read_source(
            ctx,
            org,
            &input,
            ctx.subject_id().to_string(),
            now_rfc3339()?,
        )
        .await
    }

    /// Read a source and put its kit on the organization's shelf, replacing
    /// a kit of the same slug.
    pub async fn add_shelf_kit(
        &self,
        ctx: &SecurityContext,
        tenant: Uuid,
        input: SourceInput,
    ) -> Result<ShelfKit, Refusal> {
        let org = self.require_shelf_admin(ctx, tenant).await?;
        let input = normalize_input(input)?;
        let kit = self
            .read_source(
                ctx,
                org,
                &input,
                ctx.subject_id().to_string(),
                now_rfc3339()?,
            )
            .await?;
        self.put_on_shelf(org, kit.clone()).await?;
        Ok(kit)
    }

    /// Read a shelf kit's source again at its ref and re-pin it. An
    /// organization that installed it keeps the version it installed until it
    /// installs it again.
    pub async fn refresh_shelf_kit(
        &self,
        ctx: &SecurityContext,
        tenant: Uuid,
        slug: &str,
    ) -> Result<ShelfKit, Refusal> {
        let org = self.require_shelf_admin(ctx, tenant).await?;
        let Some(old) = self.shelf_kit(ctx, org, slug).await? else {
            return Err(Refusal::NotFound(
                slug.to_owned(),
                "the organization's shelf has no such kit".into(),
            ));
        };
        let input = SourceInput {
            connection_id: old.origin.connection_id,
            repository: old.origin.repository.clone(),
            path: old.origin.path.clone(),
            git_ref: old.origin.git_ref.clone(),
            slug: Some(old.kit.slug.clone()),
        };
        let mut kit = self
            .read_source(
                ctx,
                org,
                &input,
                old.origin.added_by.clone(),
                old.origin.added_at.clone(),
            )
            .await?;
        kit.origin.refreshed_at = Some(now_rfc3339()?);
        self.put_on_shelf(org, kit.clone()).await?;
        Ok(kit)
    }

    /// Take a kit off the organization's shelf. Refused while the
    /// organization has it installed.
    pub async fn remove_shelf_kit(
        &self,
        ctx: &SecurityContext,
        tenant: Uuid,
        slug: &str,
    ) -> Result<(), Refusal> {
        let org = self.require_shelf_admin(ctx, tenant).await?;
        let slug = slug.trim().to_ascii_lowercase();
        self.store()
            .update(org, &mut |doc| {
                if doc.kits.iter().any(|k| k.kit_slug == slug) {
                    return Err(Refusal::KitInstalled(slug.clone()));
                }
                let before = doc.shelf.len();
                doc.shelf.retain(|k| k.kit.slug != slug);
                if doc.shelf.len() == before {
                    return Err(Refusal::NotFound(
                        slug.clone(),
                        "the organization's shelf has no such kit".into(),
                    ));
                }
                doc.shelf_versions.retain(|k| k.kit.slug != slug);
                Ok(None)
            })
            .await?;
        Ok(())
    }

    async fn put_on_shelf(&self, org: Uuid, kit: ShelfKit) -> Result<(), Refusal> {
        self.store()
            .update(org, &mut |doc| {
                // Refreshing the shelf does not upgrade its installations. Keep
                // their pinned manifests, including Inbox sources and overlays.
                if let Some(old) = doc.shelf.iter().find(|k| {
                    k.kit.slug == kit.kit.slug && k.kit.default_version != kit.kit.default_version
                }) {
                    let old = old.clone();
                    if doc
                        .kits
                        .iter()
                        .any(|k| k.kit_slug == old.kit.slug && k.version == old.kit.default_version)
                        && !doc.shelf_versions.iter().any(|k| {
                            k.kit.slug == old.kit.slug
                                && k.kit.default_version == old.kit.default_version
                        })
                    {
                        doc.shelf_versions.push(old);
                    }
                }
                doc.shelf.retain(|k| k.kit.slug != kit.kit.slug);
                doc.shelf.push(kit.clone());
                doc.shelf.sort_by(|a, b| a.kit.slug.cmp(&b.kit.slug));
                Ok(None)
            })
            .await?;
        Ok(())
    }

    /// The manifest at the installed commit, even after a shelf refresh.
    pub(super) async fn pinned_manifest(
        &self,
        org: Uuid,
        slug: &str,
        version: &str,
    ) -> Result<Option<KitManifest>, Refusal> {
        Ok(self
            .shelf_kit_at(org, slug, version)
            .await?
            .map(|k| k.manifest))
    }

    /// `org`'s shelf kit `slug` at `version` (its pinned commit): the
    /// shelf's current one, or one kept for an installation after a refresh.
    pub(super) async fn shelf_kit_at(
        &self,
        org: Uuid,
        slug: &str,
        version: &str,
    ) -> Result<Option<ShelfKit>, Refusal> {
        if org == super::installed::PLATFORM_TENANT || org.is_nil() {
            return Ok(None);
        }
        let doc = self.store().read(&service_context(org)?, org).await?;
        Ok(doc
            .shelf
            .into_iter()
            .chain(doc.shelf_versions)
            .find(|k| k.kit.slug == slug && k.kit.default_version == version))
    }

    async fn read_source(
        &self,
        ctx: &SecurityContext,
        org: Uuid,
        input: &SourceInput,
        by: String,
        at: String,
    ) -> Result<ShelfKit, Refusal> {
        let fetched = self.reader().fetch(ctx, org, input).await?;
        let library = self.library();
        shelf_kit(input, fetched, by, at, &|slug: &str| {
            library.iter().any(|k| k.slug == slug)
        })
    }

    /// The organization `tenant` is, when the caller may manage its kits.
    async fn require_shelf_admin(
        &self,
        ctx: &SecurityContext,
        tenant: Uuid,
    ) -> Result<Uuid, Refusal> {
        self.require_org_admin_pub(ctx, tenant).await
    }
}

/// Reads a source through the connector service.
pub struct ConnectorSourceReader(pub crate::connectors::sdk::Connectors);

impl ConnectorSourceReader {
    /// The connector service and the provider of `connection_id`, when it
    /// is a connection the organization `org` holds and shares: an
    /// organization's kit is read through nothing else.
    async fn organization_connection(
        &self,
        ctx: &SecurityContext,
        org: Uuid,
        connection_id: Uuid,
    ) -> Result<(Arc<crate::connectors::sdk::ConnectorService>, String), Refusal> {
        use crate::connectors::sdk::holder_of_row;
        let service = self.0.get().ok_or_else(|| {
            Refusal::Internal(anyhow!(
                "studio-connector is not running here, so no repository can be read"
            ))
        })?;
        let Some((found, connection)) = service.nearest_by_id(ctx, org, connection_id).await else {
            return Err(Refusal::Invalid(format!(
                "the organization has no connection {connection_id}"
            )));
        };
        let holder = holder_of_row(&connection, found);
        if holder != org {
            return Err(Refusal::Invalid(format!(
                "connection {connection_id} is held by {holder}, not by the organization: an \
                 organization's kit is read through one of its own connections"
            )));
        }
        if connection.scope.trim().eq_ignore_ascii_case("personal") {
            return Err(Refusal::Invalid(format!(
                "connection {connection_id} is personal: an organization's kit is read through \
                 a connection the organization shares"
            )));
        }
        Ok((service, connection.provider))
    }
}

#[async_trait]
impl KitSourceReader for ConnectorSourceReader {
    async fn read_file(
        &self,
        ctx: &SecurityContext,
        org: Uuid,
        origin: &KitOrigin,
        path: &str,
    ) -> Result<Option<Vec<u8>>, Refusal> {
        use crate::connectors::sdk::Repository;
        let (service, provider) = self
            .organization_connection(ctx, org, origin.connection_id)
            .await?;
        let at_commit = Repository::open(
            &service,
            ctx,
            org,
            Some(origin.connection_id),
            &provider,
            &origin.repository,
            Some(&origin.commit),
        )
        .await
        .map_err(Refusal::Internal)?;
        at_commit.read_bytes(path).await.map_err(Refusal::Internal)
    }

    async fn fetch(
        &self,
        ctx: &SecurityContext,
        org: Uuid,
        input: &SourceInput,
    ) -> Result<Fetched, Refusal> {
        use crate::connectors::sdk::Repository;
        let (service, provider) = self
            .organization_connection(ctx, org, input.connection_id)
            .await?;
        let holder = org;
        let unreadable = |e: anyhow::Error| {
            Refusal::Invalid(format!(
                "{} cannot be read through connection {}: {e:#}",
                input.repository, input.connection_id
            ))
        };
        let at_ref = Repository::open(
            &service,
            ctx,
            holder,
            Some(input.connection_id),
            &provider,
            &input.repository,
            input.git_ref.as_deref(),
        )
        .await
        .map_err(unreadable)?;
        // The pin: the newest commit that touched the kit's directory at the
        // ref. The directory reads the same there as at the ref.
        let commit = match at_ref.history(&input.path, 1).await {
            Ok(commits) if !commits.is_empty() => commits[0].sha.clone(),
            _ => {
                let branch = match input.git_ref.as_deref() {
                    Some(r) => r.to_owned(),
                    None => at_ref.default_branch().await.map_err(unreadable)?,
                };
                if branch.len() == 40 && branch.chars().all(|c| c.is_ascii_hexdigit()) {
                    branch
                } else {
                    at_ref
                        .head_of(&branch)
                        .await
                        .map_err(unreadable)?
                        .ok_or_else(|| {
                            Refusal::Invalid(format!(
                                "{} has no branch `{branch}` (a tag or a commit is named by \
                                 the commit it points at)",
                                input.repository
                            ))
                        })?
                }
            }
        };
        let pinned = Repository::open(
            &service,
            ctx,
            holder,
            Some(input.connection_id),
            &provider,
            &input.repository,
            Some(&commit),
        )
        .await
        .map_err(unreadable)?;
        for file in MANIFEST_FILES {
            let path = if input.path.is_empty() {
                file.to_owned()
            } else {
                format!("{}/{file}", input.path)
            };
            if let Some(found) = pinned.read_file(&path).await.map_err(unreadable)? {
                let repository_url = if provider == "github" {
                    format!("https://github.com/{}", input.repository)
                } else {
                    String::new()
                };
                return Ok(Fetched {
                    provider: provider.clone(),
                    commit,
                    file,
                    body: found.text,
                    repository_url,
                });
            }
        }
        Err(Refusal::Invalid(format!(
            "{}/{} has neither {KIT_JSON} nor {CF_STUDIO_KIT_TOML} at {commit}",
            input.repository, input.path
        )))
    }
}

/// The reader this assembly has.
pub fn reader(hub: Arc<toolkit::client_hub::ClientHub>) -> Arc<dyn KitSourceReader> {
    Arc::new(ConnectorSourceReader(
        crate::connectors::sdk::Connectors::new(hub),
    ))
}

#[cfg(test)]
#[path = "shelf_tests.rs"]
mod tests;
