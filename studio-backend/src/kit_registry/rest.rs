use std::sync::Arc;

use axum::{Extension, Router, extract::Path, extract::Query};
use toolkit::api::canonical_prelude::*;
use toolkit::api::operation_builder::{CORE_GLOBAL_BASE_LICENSE_FEATURE, LicenseFeature};
use toolkit::api::{OpenApiRegistry, OperationBuilder};
use toolkit_canonical_errors::resource_error;
use toolkit_security::SecurityContext;
use uuid::Uuid;

use super::bundles::{KitBundles, KitMfeManifest};
use super::contents::{KitDetail, KitNamed};
use super::installed::{
    BASE_KIT, InstalledKit, KitInstaller, NOT_A_PROJECT_KIT, ORGANIZATION_KIT, Refusal,
};
use super::models::{KIT_MODEL_CONFLICT, MODEL_KIT_NOT_FOR_PROJECT};
use super::phase::{KIT_NOT_INSTALLED, NO_SUCH_TRANSITION};
use super::service::{
    KitDescriptor, KitInstallation, KitMaterialization, KitRegistryService, ProjectRepository,
};
use super::shelf::{KIT_INSTALLED, KIT_SLUG_TAKEN};
use crate::org_scope::{OrgAccess, OrgCtx};
use crate::pagination::{PageQuery, page_of};

#[resource_error(gts_id!("cf.studio.kits.registry.v1~"))]
pub struct KitRegistryError;

struct License;
impl AsRef<str> for License {
    fn as_ref(&self) -> &'static str {
        CORE_GLOBAL_BASE_LICENSE_FEATURE
    }
}
impl LicenseFeature for License {}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct KitDto {
    pub slug: String,
    pub name: String,
    pub description: String,
    pub publisher: String,
    pub visibility: String,
    pub source: String,
    pub repository_url: String,
    pub default_version: String,
    pub manifest_path: String,
    /// The library shelf: `builtin` (shipped in Studio's image; no
    /// repository, so `repository_url` is empty and `source` is `builtin`),
    /// `official` (Constructor's kits in their own repositories) or
    /// `organization` (an organization's own).
    pub shelf: String,
    /// The levels the kit may be installed on: `platform`, `organization`, `workspace`,
    /// `project`.
    pub levels: Vec<String>,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct KitListDto {
    pub items: Vec<KitDto>,
    /// Kits in the catalogue across every page, so a caller can show "N of M" and
    /// knows a next page exists exactly when `offset + items.len() < total`.
    pub total: u32,
}

/// A screen a kit brings (ADR-0068 §2).
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct KitScreenDto {
    /// `tab` (on a level's tab bar) or `section` (inside another screen).
    pub kind: String,
    /// The level it shows on: `platform`, `organization`, `workspace` or `project`.
    pub level: String,
    pub label: String,
    /// The portal route; null when the screen is not in the portal yet.
    pub route: Option<String>,
    /// For a section, the slot of the screen it goes in; null for a tab.
    pub slot: Option<String>,
    /// Domain types another kit brings that the screen shows (`milestone`):
    /// where one is not installed the shell hides the screen.
    pub needs: Vec<String>,
}

/// A GTS type a kit registers under its own namespace.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct KitTypeDto {
    pub gts: String,
    pub name: String,
    pub description: Option<String>,
}

/// A rule, a kit service or an MCP tool a kit brings.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct KitNamedDto {
    pub name: String,
    pub description: Option<String>,
}

/// A function a kit brings (ADR-0068 §8).
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct KitFunctionDto {
    pub name: String,
    /// `wasm` (the kit's own code) or `agent` (a prompt and the tools it may call).
    pub runtime: String,
    pub description: Option<String>,
}

/// A source of the person's Inbox a kit brings (ADR-0068 §6).
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct KitInboxSourceDto {
    pub id: String,
    pub label: String,
    /// Which screen and tool answer its items; null when it names none.
    pub destination: Option<KitInboxDestinationDto>,
}

/// Where a kit's Inbox item is answered (ADR-0068 §6).
#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(response)]
pub struct KitInboxDestinationDto {
    /// The portal route of the kit's screen that answers it.
    pub route: Option<String>,
    /// The kit's MCP tool that acts on it.
    pub mcp_tool: Option<String>,
}

impl From<super::manifest::ManifestInboxDestination> for KitInboxDestinationDto {
    fn from(d: super::manifest::ManifestInboxDestination) -> Self {
        Self {
            route: d.route,
            mcp_tool: d.mcp_tool,
        }
    }
}

/// What a kit's code and rules are held to.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct KitPermissionsDto {
    /// What it reads: GTS types, or for a built-in kit the gears' routes its
    /// screen calls (`METHOD /path`).
    pub reads: Vec<String>,
    pub writes: Vec<String>,
    /// Event kinds it listens to.
    pub listens: Vec<String>,
}

/// A file or directory `cfs` writes into a project's checkout.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct KitMaterialDto {
    /// Relative to the kit's directory in the checkout
    /// (`<cf-studio-path>/config/kits/<slug>/`); a directory ends in `/`.
    pub path: String,
    pub description: Option<String>,
}

/// What a kit brings, by the sections of its manifest (ADR-0068 §3, §8).
/// Every list is present, empty when the kit brings none.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct KitContentsDto {
    pub screens: Vec<KitScreenDto>,
    pub types: Vec<KitTypeDto>,
    pub rules: Vec<KitNamedDto>,
    pub functions: Vec<KitFunctionDto>,
    pub services: Vec<KitNamedDto>,
    pub inbox: Vec<KitInboxSourceDto>,
    pub mcp_tools: Vec<KitNamedDto>,
    pub permissions: KitPermissionsDto,
    pub material: Vec<KitMaterialDto>,
    /// The artifact kinds it brings templates and rules for (PRD, ADR, ...).
    pub kinds: Vec<String>,
    pub docs: Vec<String>,
    /// The built micro-frontends it carries (`mfe/<package>`), served to the
    /// shell at run time (`GET /mfe-manifests`).
    pub mfe: Vec<String>,
}

/// One kit of the library and what is inside it.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct KitDetailDto {
    /// The same entry `GET /catalog` lists.
    pub kit: KitDto,
    pub contents: KitContentsDto,
    /// Where `contents` came from: `built-in`, `.cf-studio-kit.toml`
    /// (a copy at the pinned version) or `kit.gdl`; null when nothing reliable
    /// describes the kit, and every list is empty.
    pub manifest: Option<String>,
    /// Where an organization's own kit came from (its shelf entry); null for
    /// a built-in or official kit.
    pub origin: Option<KitOriginDto>,
}

/// Where a kit of an organization's shelf came from: the repository a
/// connection of the organization reaches, the directory and ref, and the
/// commit it is pinned to.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct KitOriginDto {
    pub connection_id: String,
    /// The connection's provider (`github`, `gitlab`, ...).
    pub provider: String,
    /// `owner/name`.
    pub repository: String,
    /// The kit's directory; empty for the repository's root.
    pub path: String,
    /// The ref it follows; null is the default branch.
    pub git_ref: Option<String>,
    /// The commit it is pinned to.
    pub commit: String,
    /// `kit.json` or `.cf-studio-kit.toml`.
    pub manifest_file: String,
    pub added_by: String,
    pub added_at: String,
    /// When it was last re-pinned.
    pub refreshed_at: Option<String>,
}

/// The organization's shelf.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct ShelfListDto {
    pub items: Vec<KitDetailDto>,
    pub total: u32,
}

/// Where a kit is: a repository through one of the organization's
/// connections, a directory and a ref.
#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct ShelfSourceDto {
    pub connection_id: Uuid,
    /// `owner/name`.
    pub repository: String,
    /// The kit's directory; empty or absent for the repository's root.
    pub path: Option<String>,
    /// A branch, a tag or a commit; the default branch when absent.
    #[serde(rename = "ref")]
    pub git_ref: Option<String>,
    /// Which kit of a `.cf-studio-kit.toml` that lists several.
    pub slug: Option<String>,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct KitMaterializationDto {
    pub repository_id: String,
    pub repository_label: Option<String>,
    /// The version actually in this repository, which can lag the
    /// installation's `version` when a bump has not reached every target.
    pub version: String,
    /// "installed" or "failed", for this repository alone.
    pub status: String,
    pub materialized_at: String,
    pub failure_reason: Option<String>,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct KitInstallationDto {
    pub kit_slug: String,
    pub version: String,
    pub source: String,
    pub repository_url: String,
    pub install_mode: String,
    pub status: String,
    pub requested_by: String,
    pub requested_at: String,
    /// Where this kit belongs: "project" or "all-repositories". Intent, as
    /// opposed to `materializations`, which is where it actually is.
    pub scope: String,
    pub installed_at: Option<String>,
    /// The most recently materialized target, derived from `materializations`
    /// rather than stored. Kept because "install this again where it already
    /// is" is the common case and a caller should not have to sort the list to
    /// find it -- but it is a view of the list, so it cannot drift from it.
    pub repository_id: Option<String>,
    /// Every repository this kit has been materialized into, with its own
    /// version and outcome.
    pub materializations: Vec<KitMaterializationDto>,
    pub failure_reason: Option<String>,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct KitInstallationListDto {
    pub items: Vec<KitInstallationDto>,
    /// Installations on this project across every page, so a caller can show "N of M" and
    /// knows a next page exists exactly when `offset + items.len() < total`.
    pub total: u32,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct ProjectRepositoryDto {
    pub repository_id: String,
    pub label: String,
    /// "project" for the project's own repository (where `.cf-studio-kit.toml`
    /// lives, and the target the IDE picks when none is named), "source" for a
    /// checkout mounted below it.
    pub kind: String,
    pub git_mode: Option<String>,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct ProjectRepositoryListDto {
    pub items: Vec<ProjectRepositoryDto>,
    /// Repositories on this project across every page, so a caller can show "N of M" and
    /// knows a next page exists exactly when `offset + items.len() < total`.
    pub total: u32,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct RequestKitInstallationDto {
    pub kit_slug: String,
    pub version: String,
    pub install_mode: String,
    /// "project" (default) or "all-repositories". Omitted means project-only:
    /// rolling a kit into every checkout writes files, so it is opted into.
    pub scope: Option<String>,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct MaterializeKitInstallationDto {
    pub repository_id: Option<String>,
}

/// How an install the IDE ran itself went: a desktop, which the backend
/// cannot call (ADR-0027), installs into its own checkout and reports here.
#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct ReportKitMaterializationDto {
    pub repository_id: String,
    pub repository_label: Option<String>,
    /// "installed" or "failed".
    pub status: String,
    pub failure_reason: Option<String>,
}

impl From<KitDescriptor> for KitDto {
    fn from(value: KitDescriptor) -> Self {
        Self {
            slug: value.slug,
            name: value.name,
            description: value.description,
            publisher: value.publisher,
            visibility: value.visibility,
            source: value.source,
            repository_url: value.repository_url,
            default_version: value.default_version,
            manifest_path: value.manifest_path,
            shelf: value.shelf,
            levels: value.levels,
        }
    }
}

impl From<KitDetail> for KitDetailDto {
    fn from(value: KitDetail) -> Self {
        let named = |items: Vec<KitNamed>| {
            items
                .into_iter()
                .map(|n| KitNamedDto {
                    name: n.name,
                    description: n.description,
                })
                .collect()
        };
        let c = value.contents;
        Self {
            kit: value.kit.into(),
            contents: KitContentsDto {
                screens: c
                    .screens
                    .into_iter()
                    .map(|s| KitScreenDto {
                        kind: s.kind.to_owned(),
                        level: s.level,
                        label: s.label,
                        route: s.route,
                        slot: s.slot,
                        needs: s.needs,
                    })
                    .collect(),
                types: c
                    .types
                    .into_iter()
                    .map(|t| KitTypeDto {
                        gts: t.gts,
                        name: t.name,
                        description: t.description,
                    })
                    .collect(),
                rules: named(c.rules),
                functions: c
                    .functions
                    .into_iter()
                    .map(|f| KitFunctionDto {
                        name: f.name,
                        runtime: f.runtime.to_owned(),
                        description: f.description,
                    })
                    .collect(),
                services: named(c.services),
                inbox: c
                    .inbox
                    .into_iter()
                    .map(|i| KitInboxSourceDto {
                        id: i.id,
                        label: i.label,
                        destination: i.destination.map(Into::into),
                    })
                    .collect(),
                mcp_tools: named(c.mcp_tools),
                permissions: KitPermissionsDto {
                    reads: c.permissions.reads,
                    writes: c.permissions.writes,
                    listens: c.permissions.listens,
                },
                material: c
                    .material
                    .into_iter()
                    .map(|m| KitMaterialDto {
                        path: m.path,
                        description: m.description,
                    })
                    .collect(),
                kinds: c.kinds,
                docs: c.docs,
                mfe: c.mfe,
            },
            manifest: value.manifest.map(str::to_owned),
            origin: None,
        }
    }
}

impl From<super::shelf::KitOrigin> for KitOriginDto {
    fn from(o: super::shelf::KitOrigin) -> Self {
        Self {
            connection_id: o.connection_id.to_string(),
            provider: o.provider,
            repository: o.repository,
            path: o.path,
            git_ref: o.git_ref,
            commit: o.commit,
            manifest_file: o.manifest_file,
            added_by: o.added_by,
            added_at: o.added_at,
            refreshed_at: o.refreshed_at,
        }
    }
}

/// A shelf kit as the library describes it, with where it came from.
fn shelf_detail(kit: super::shelf::ShelfKit) -> KitDetailDto {
    let mut dto: KitDetailDto = super::shelf::detail(&kit).into();
    dto.origin = Some(kit.origin.into());
    dto
}

impl From<ProjectRepository> for ProjectRepositoryDto {
    fn from(value: ProjectRepository) -> Self {
        Self {
            repository_id: value.repository_id,
            label: value.label,
            kind: value.kind,
            git_mode: value.git_mode,
        }
    }
}

impl From<KitMaterialization> for KitMaterializationDto {
    fn from(value: KitMaterialization) -> Self {
        Self {
            repository_id: value.repository_id,
            repository_label: value.repository_label,
            version: value.version,
            status: value.status,
            materialized_at: value.materialized_at,
            failure_reason: value.failure_reason,
        }
    }
}

impl From<KitInstallation> for KitInstallationDto {
    fn from(value: KitInstallation) -> Self {
        // Timestamps are RFC 3339 UTC written by one writer, so the lexical
        // maximum is the chronological one.
        let repository_id = value
            .materializations
            .iter()
            .max_by(|left, right| left.materialized_at.cmp(&right.materialized_at))
            .map(|entry| entry.repository_id.clone());
        Self {
            kit_slug: value.kit_slug,
            version: value.version,
            source: value.source,
            repository_url: value.repository_url,
            install_mode: value.install_mode,
            status: value.status,
            requested_by: value.requested_by,
            requested_at: value.requested_at,
            scope: value.scope,
            installed_at: value.installed_at,
            repository_id,
            materializations: value.materializations.into_iter().map(Into::into).collect(),
            failure_reason: value.failure_reason,
        }
    }
}

/// `GET /catalog`'s query: a shelf, and the page.
#[derive(Debug, Default, serde::Deserialize)]
pub struct CatalogueQuery {
    #[serde(default)]
    pub shelf: Option<String>,
    /// List this organization's own kits too.
    #[serde(default)]
    pub organization_id: Option<Uuid>,
    #[serde(flatten)]
    pub page: PageQuery,
}

/// One installed kit (ADR-0069 §4).
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct InstalledKitDto {
    pub kit_slug: String,
    /// The version that applies. A built-in kit is always at Studio's own.
    pub version: String,
    /// `builtin`, `official` or `organization`: the library shelf.
    pub shelf: String,
    /// `base` (installed by the platform for every organization),
    /// `organization` (installed by the organization for itself) or `project`
    /// (installed for one project). In `effective`, the installation whose
    /// version won.
    pub kind: String,
    /// Who installed it: a subject id. Absent for a built-in kit installed by
    /// default, which nobody installed.
    pub installed_by: Option<String>,
    /// When, RFC 3339 UTC. Absent exactly when `installed_by` is.
    pub installed_at: Option<String>,
    /// A built-in kit installed because nobody removed it.
    pub by_default: bool,
}

/// The kits that apply to one organization, or to one project of it.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct InstalledKitsDto {
    /// The organization this is about (a project or workspace named in
    /// `organization_id` answers for its organization; so does `project_id`).
    pub organization_id: String,
    /// The project asked about with `project_id`; null for an organization.
    pub project_id: Option<String>,
    /// What the platform installed for every organization, built-in kits
    /// nobody removed included. An organization cannot uninstall these.
    pub base: Vec<InstalledKitDto>,
    /// What the organization installed for itself.
    pub organization: Vec<InstalledKitDto>,
    /// What was installed for the project alone; empty without `project_id`.
    pub project: Vec<InstalledKitDto>,
    /// What applies: `base`, `organization` and `project` together, one
    /// entry per kit, at the newest version.
    pub effective: Vec<InstalledKitDto>,
}

/// One micro-frontend package of a kit, for the shell to register
/// (ADR-0068 phase 5).
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct KitMfeManifestDto {
    pub kit_slug: String,
    /// The installed version the package was built as.
    pub version: String,
    /// The package: the `<package>` of the kit's `mfe/<package>`.
    pub package: String,
    /// Where the package's files are served, through the gateway, ending in
    /// `/`: the `publicPath` its manifest is loaded from. It carries the grant
    /// that lets the anonymous file route answer.
    pub base_path: String,
    /// The package's `mfe-manifest.json` as its build wrote it: the FrontX
    /// manifest, entries, extensions and schemas. Null when it does not read.
    pub config: Option<serde_json::Value>,
    /// Why `config` is null; null otherwise.
    pub error: Option<String>,
}

impl From<KitMfeManifest> for KitMfeManifestDto {
    fn from(value: KitMfeManifest) -> Self {
        Self {
            kit_slug: value.kit_slug,
            version: value.version,
            package: value.package,
            base_path: value.base_path,
            config: value.config,
            error: value.error,
        }
    }
}

/// The micro-frontends of the kits effective in one scope.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct KitMfeManifestListDto {
    /// The organization this is about.
    pub organization_id: String,
    /// The project asked about; null for an organization.
    pub project_id: Option<String>,
    pub items: Vec<KitMfeManifestDto>,
    /// Packages in `items`; the list is never paged.
    pub total: u32,
}

/// `?project_id=`: the project a project-kit route is about.
#[derive(Debug, serde::Deserialize)]
pub struct ProjectKitQuery {
    pub project_id: Uuid,
}

/// `GET /installed-kits`'s query: an organization, or a project.
#[derive(Debug, Default, serde::Deserialize)]
pub struct InstalledQuery {
    #[serde(default)]
    pub organization_id: Option<Uuid>,
    #[serde(default)]
    pub project_id: Option<Uuid>,
}

/// Install a kit: at `version`, or the kit's default when absent.
#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct InstallKitDto {
    /// A Git ref for an official kit. A built-in kit takes Studio's version
    /// only; another is refused.
    pub version: Option<String>,
}

impl From<InstalledKit> for InstalledKitDto {
    fn from(value: InstalledKit) -> Self {
        Self {
            kit_slug: value.kit_slug,
            version: value.version,
            shelf: value.shelf,
            kind: value.kind.to_owned(),
            installed_by: value.installed_by,
            installed_at: value.installed_at,
            by_default: value.by_default,
        }
    }
}

fn refused(refusal: Refusal) -> CanonicalError {
    match refusal {
        Refusal::Forbidden(reason) => KitRegistryError::permission_denied()
            .with_reason(reason)
            .create(),
        Refusal::Invalid(detail) => KitRegistryError::invalid_argument()
            .with_constraint(detail)
            .create(),
        Refusal::NotFound(slug, detail) => KitRegistryError::not_found(detail)
            .with_resource(slug)
            .create(),
        Refusal::BaseKit(slug) => KitRegistryError::failed_precondition()
            .with_precondition_violation(
                "kit",
                format!(
                    "`{slug}` is a base kit, installed by the platform for every organization; \
                     an organization or a project cannot uninstall it"
                ),
                BASE_KIT,
            )
            .create(),
        Refusal::OrganizationKit(slug) => KitRegistryError::failed_precondition()
            .with_precondition_violation(
                "kit",
                format!(
                    "`{slug}` is installed by the project's organization; a project cannot \
                     uninstall it"
                ),
                ORGANIZATION_KIT,
            )
            .create(),
        Refusal::NotAProjectKit(slug) => KitRegistryError::failed_precondition()
            .with_precondition_violation(
                "kit",
                format!("`{slug}` does not name `project` among its levels: it is not installed in a project"),
                NOT_A_PROJECT_KIT,
            )
            .create(),
        Refusal::SlugTaken(slug) => KitRegistryError::failed_precondition()
            .with_precondition_violation(
                "kit",
                format!(
                    "`{slug}` is a kit of Studio's own library; an organization's kit takes \
                     another slug"
                ),
                KIT_SLUG_TAKEN,
            )
            .create(),
        Refusal::KitInstalled(slug) => KitRegistryError::failed_precondition()
            .with_precondition_violation(
                "kit",
                format!(
                    "`{slug}` is installed for the organization; uninstall it before taking it \
                     off the shelf"
                ),
                KIT_INSTALLED,
            )
            .create(),
        Refusal::ModelConflict(detail) => KitRegistryError::failed_precondition()
            .with_precondition_violation("model", detail, KIT_MODEL_CONFLICT)
            .create(),
        Refusal::ModelKitNotForProject(slug) => KitRegistryError::failed_precondition()
            .with_precondition_violation(
                "kit",
                format!(
                    "`{slug}` brings a model, which is the organization's: install it for the \
                     organization, not for one project"
                ),
                MODEL_KIT_NOT_FOR_PROJECT,
            )
            .create(),
        Refusal::KitNotInstalled(slug) => KitRegistryError::failed_precondition()
            .with_precondition_violation(
                "kit",
                format!("`{slug}` is not installed where this was asked"),
                KIT_NOT_INSTALLED,
            )
            .create(),
        Refusal::NoSuchTransition(detail) => KitRegistryError::failed_precondition()
            .with_precondition_violation("phase", detail, NO_SUCH_TRANSITION)
            .create(),
        Refusal::Internal(error) => internal(error),
    }
}

/// What applies where the query points: a project named wins, and answers
/// for its organization as well.
async fn installed_for(
    ctx: &SecurityContext,
    access: &OrgAccess,
    installer: &KitInstaller,
    query: &InstalledQuery,
) -> Result<super::installed::Installed, CanonicalError> {
    match query.project_id {
        Some(project) => {
            let ctx = crate::org_scope::resolve(access.0.as_ref(), ctx, Some(project)).await?;
            installer.installed_in_project(&ctx, project).await
        }
        None => {
            let ctx =
                crate::org_scope::resolve(access.0.as_ref(), ctx, query.organization_id).await?;
            installer.installed(&ctx, ctx.subject_tenant_id()).await
        }
    }
    .map_err(refused)
}

async fn get_installed(
    Extension(ctx): Extension<SecurityContext>,
    Extension(access): Extension<OrgAccess>,
    Extension(installer): Extension<Arc<KitInstaller>>,
    Query(query): Query<InstalledQuery>,
) -> ApiResult<JsonBody<InstalledKitsDto>> {
    let installed = installed_for(&ctx, &access, &installer, &query).await?;
    // The model follows what is installed: a base kit reaches an
    // organization's model when the organization is first read after it
    // changed (docs/design/studio-kits.md §3.10). What cannot be applied is
    // logged; the read does not fail for it.
    if let Err(refusal) = installer.reconcile_models(installed.organization_id).await {
        tracing::warn!(organization_id = %installed.organization_id, ?refusal, "studio-kits: kit models not reconciled");
    }
    let list = |kits: Vec<InstalledKit>| kits.into_iter().map(Into::into).collect();
    Ok(Json(InstalledKitsDto {
        organization_id: installed.organization_id.to_string(),
        project_id: installed.project_id.map(|id| id.to_string()),
        base: list(installed.base),
        organization: list(installed.organization),
        project: list(installed.project),
        effective: list(installed.effective),
    }))
}

async fn list_mfe_manifests(
    Extension(ctx): Extension<SecurityContext>,
    Extension(access): Extension<OrgAccess>,
    Extension(installer): Extension<Arc<KitInstaller>>,
    Extension(bundles): Extension<Arc<KitBundles>>,
    Query(query): Query<InstalledQuery>,
) -> ApiResult<JsonBody<KitMfeManifestListDto>> {
    let installed = installed_for(&ctx, &access, &installer, &query).await?;
    let kits: Vec<(String, String)> = installed
        .effective
        .iter()
        .map(|kit| (kit.kit_slug.clone(), kit.version.clone()))
        .collect();
    let items: Vec<KitMfeManifestDto> = bundles
        .manifests(installed.organization_id, &kits)
        .await
        .into_iter()
        .map(Into::into)
        .collect();
    Ok(Json(KitMfeManifestListDto {
        organization_id: installed.organization_id.to_string(),
        project_id: installed.project_id.map(|id| id.to_string()),
        total: u32::try_from(items.len()).unwrap_or(u32::MAX),
        items,
    }))
}

/// One file of a kit's bundle. Anonymous: the shell's module loader sends no
/// token. The grant in the path is learned only from `list_mfe_manifests`,
/// and anything it does not cover answers 404, as a missing file does.
async fn get_mfe_file(
    Extension(bundles): Extension<Arc<KitBundles>>,
    Path((kit_slug, version, grant, package, file)): Path<(String, String, String, String, String)>,
) -> axum::response::Response {
    let read = bundles
        .file(&kit_slug, &version, &grant, &package, &file)
        .await;
    let pinned = KitBundles::is_org_grant(&grant);
    mfe_file_response(read, pinned, &kit_slug, &version, &package)
}

fn mfe_file_response(
    read: anyhow::Result<Option<(super::bundles::BundleFile, Vec<u8>)>>,
    pinned: bool,
    kit_slug: &str,
    version: &str,
    package: &str,
) -> axum::response::Response {
    use axum::http::{HeaderValue, header};
    use axum::response::IntoResponse;
    match read {
        Ok(Some((file, bytes))) => {
            let mut response = bytes.into_response();
            let headers = response.headers_mut();
            headers.insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static(file.content_type()),
            );
            // `assets/` is hashed by the build; the rest (`remoteEntry.js`,
            // the manifests) names it, so it is asked again every time.
            headers.insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static(if pinned || file.is_immutable() {
                    "private, max-age=31536000, immutable"
                } else {
                    "private, no-cache"
                }),
            );
            headers.insert(
                header::X_CONTENT_TYPE_OPTIONS,
                HeaderValue::from_static("nosniff"),
            );
            // Read by `fetch` and run as a module of the portal: never a page.
            headers.insert(
                header::CONTENT_SECURITY_POLICY,
                HeaderValue::from_static("default-src 'none'; sandbox"),
            );
            headers.insert(
                "cross-origin-resource-policy",
                HeaderValue::from_static("same-origin"),
            );
            response
        }
        Ok(None) => (StatusCode::NOT_FOUND, "no such file").into_response(),
        Err(error) => {
            tracing::warn!(kit = %kit_slug, %version, %package, "studio-kits: a bundle file could not be read: {error:#}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "the file could not be read",
            )
                .into_response()
        }
    }
}

async fn upsert_project_kit(
    Extension(ctx): Extension<SecurityContext>,
    Extension(access): Extension<OrgAccess>,
    Extension(installer): Extension<Arc<KitInstaller>>,
    Path(kit_slug): Path<String>,
    Query(query): Query<ProjectKitQuery>,
    Json(body): Json<InstallKitDto>,
) -> ApiResult<JsonBody<InstalledKitDto>> {
    let ctx = crate::org_scope::resolve(access.0.as_ref(), &ctx, Some(query.project_id)).await?;
    let kit = installer
        .install_for_project(&ctx, query.project_id, &kit_slug, body.version.as_deref())
        .await
        .map_err(refused)?;
    Ok(Json(kit.into()))
}

async fn delete_project_kit(
    Extension(ctx): Extension<SecurityContext>,
    Extension(access): Extension<OrgAccess>,
    Extension(installer): Extension<Arc<KitInstaller>>,
    Path(kit_slug): Path<String>,
    Query(query): Query<ProjectKitQuery>,
) -> ApiResult<StatusCode> {
    let ctx = crate::org_scope::resolve(access.0.as_ref(), &ctx, Some(query.project_id)).await?;
    installer
        .uninstall_for_project(&ctx, query.project_id, &kit_slug)
        .await
        .map_err(refused)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn upsert_base_kit(
    Extension(ctx): Extension<SecurityContext>,
    Extension(installer): Extension<Arc<KitInstaller>>,
    Path(kit_slug): Path<String>,
    Json(body): Json<InstallKitDto>,
) -> ApiResult<JsonBody<InstalledKitDto>> {
    let kit = installer
        .install_base(&ctx, &kit_slug, body.version.as_deref())
        .await
        .map_err(refused)?;
    Ok(Json(kit.into()))
}

async fn delete_base_kit(
    Extension(ctx): Extension<SecurityContext>,
    Extension(installer): Extension<Arc<KitInstaller>>,
    Path(kit_slug): Path<String>,
) -> ApiResult<StatusCode> {
    installer
        .uninstall_base(&ctx, &kit_slug)
        .await
        .map_err(refused)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn upsert_organization_kit(
    OrgCtx(ctx): OrgCtx,
    Extension(installer): Extension<Arc<KitInstaller>>,
    Path(kit_slug): Path<String>,
    Json(body): Json<InstallKitDto>,
) -> ApiResult<JsonBody<InstalledKitDto>> {
    let kit = installer
        .install_for_organization(
            &ctx,
            ctx.subject_tenant_id(),
            &kit_slug,
            body.version.as_deref(),
        )
        .await
        .map_err(refused)?;
    Ok(Json(kit.into()))
}

async fn delete_organization_kit(
    OrgCtx(ctx): OrgCtx,
    Extension(installer): Extension<Arc<KitInstaller>>,
    Path(kit_slug): Path<String>,
) -> ApiResult<StatusCode> {
    installer
        .uninstall_for_organization(&ctx, ctx.subject_tenant_id(), &kit_slug)
        .await
        .map_err(refused)?;
    Ok(StatusCode::NO_CONTENT)
}

/// The installer's routes (ADR-0069 §4).
fn register_installer_routes(mut router: Router, openapi: &dyn OpenApiRegistry) -> Router {
    router = OperationBuilder::get("/studio-kits/v1/installed-kits")
        .operation_id("studio_kits.get_installed_kits")
        .summary(
            "The kits that apply to an organization or a project: each level's, and all together",
        )
        .description(
            "Any member may read it. `base` is what the platform installed for every \
             organization (the built-in kits nobody removed among them), `organization` what \
             the organization installed for itself, `project` what was installed for the \
             project named in `project_id` (empty, and `project_id` null, without one), and \
             `effective` all of them together, one entry per kit at the newest version. A \
             project or workspace named in `organization_id` answers for its organization; \
             `project_id` wins over `organization_id`, and a tenant that is not a project there \
             is 400. One the caller does not reach is 404.",
        )
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .query_param_typed(
            crate::org_scope::PARAM,
            false,
            crate::org_scope::PARAM_DOC,
            "string",
        )
        .query_param_typed(
            "project_id",
            false,
            "A project: answer for it, its own kits included",
            "string",
        )
        .handler(get_installed)
        .json_response_with_schema::<InstalledKitsDto>(openapi, StatusCode::OK, "Installed kits")
        .error_400(openapi)
        .error_401(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    router = OperationBuilder::get("/studio-kits/v1/mfe-manifests")
        .operation_id("studio_kits.list_mfe_manifests")
        .summary("The micro-frontends of the kits that apply here, for the shell to load")
        .description(
            "Any member, for the scope `installed-kits` answers for (`project_id` wins over \
             `organization_id`; 400 and 404 the same way). One item per micro-frontend package \
             of each effective kit whose bundle is served at the installed version (ADR-0068 \
             phase 5): the package's `mfe-manifest.json` as its build wrote it, and \
             `base_path`, where its files are served. A kit with no bundle, or none at that \
             version, has no item; a bundle that does not read has one with `config` null and \
             `error` saying why. The shell registers these beside the screens it was built \
             with, so a kit's screen needs no portal rebuild.",
        )
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .query_param_typed(
            crate::org_scope::PARAM,
            false,
            crate::org_scope::PARAM_DOC,
            "string",
        )
        .query_param_typed(
            "project_id",
            false,
            "A project: its own kits count too",
            "string",
        )
        .handler(list_mfe_manifests)
        .json_response_with_schema::<KitMfeManifestListDto>(
            openapi,
            StatusCode::OK,
            "The kits' micro-frontend packages",
        )
        .error_400(openapi)
        .error_401(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    router = OperationBuilder::get(
        "/studio-kits/v1/kits/{kit_slug}/{version}/mfe/{grant}/{package}/{*file}",
    )
    .operation_id("studio_kits.get_mfe_file")
    .summary("One file of a kit's micro-frontend bundle")
    .description(
        "Anonymous, because the shell's module loader fetches a bundle's chunks with no \
         token: `grant` is learned only from `list_mfe_manifests`, which answers for kits \
         effective where the caller is a member, and a wrong one answers 404 like a missing \
         file. Serves only a bundle's own types (scripts, styles, JSON, images, fonts, wasm) \
         with their content type and `nosniff`; never an HTML page, a hidden file or \
         anything outside the package. `assets/` is cached as immutable, the rest revalidated. \
         An organization's own kit (`kit.json` `mfe`) has a grant naming the organization: its \
         files are read from the organization's repository through its connection at the \
         commit the kit is pinned to (`version`), kept in memory, and all cached as immutable.",
    )
    .tag("StudioKits")
    .anonymous()
    .exposed()
    .path_param("kit_slug", "Kit slug")
    .path_param("version", "The installed version")
    .path_param("grant", "As `base_path` names it")
    .path_param("package", "The package")
    .path_param("file", "A file inside the package")
    .handler(get_mfe_file)
    .text_response(StatusCode::OK, "The file", "text/javascript")
    .error_404(openapi)
    .error_500(openapi)
    .register(router, openapi);

    router = OperationBuilder::put("/studio-kits/v1/project-kits/{kit_slug}")
        .operation_id("studio_kits.upsert_project_kit")
        .summary("Install a kit for one project")
        .description(
            "Whoever may install kits for the project's organization (its owner, a role with \
             `kit.manage`, or a platform administrator); 403 `KIT_ADMIN_REQUIRED` otherwise. \
             `project_id` names the project; one the caller does not reach is 404, a tenant \
             that is not a project 400. Only a kit whose `levels` name `project` (400 \
             `failed_precondition`, `NOT_A_PROJECT_KIT`). At `version` or the kit's default; \
             installing it again changes the version. A kit the organization or the platform \
             also installed applies at the newest version.",
        )
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .path_param("kit_slug", "Kit slug")
        .query_param_typed("project_id", true, "The project", "string")
        .json_request::<InstallKitDto>(openapi, "The version, optional")
        .handler(upsert_project_kit)
        .json_response_with_schema::<InstalledKitDto>(openapi, StatusCode::OK, "The project kit")
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    router = OperationBuilder::delete("/studio-kits/v1/project-kits/{kit_slug}")
        .operation_id("studio_kits.delete_project_kit")
        .summary("Uninstall a kit installed for one project")
        .description(
            "Whoever may install kits for the project's organization; 403 `KIT_ADMIN_REQUIRED` \
             otherwise. A kit the project has only from its organization is refused with 400 \
             `failed_precondition` (`ORGANIZATION_KIT`), one it has only from the platform \
             with `BASE_KIT`: those are theirs to remove. A kit never installed for the \
             project is 404.",
        )
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .path_param("kit_slug", "Kit slug")
        .query_param_typed("project_id", true, "The project", "string")
        .handler(delete_project_kit)
        .no_content_response(StatusCode::NO_CONTENT, "Uninstalled")
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    router = OperationBuilder::put("/studio-kits/v1/base-kits/{kit_slug}")
        .operation_id("studio_kits.upsert_base_kit")
        .summary("Install a kit for every organization (a base kit)")
        .description(
            "Platform administrators only (403 `PLATFORM_ADMIN_REQUIRED`). Installs a built-in \
             or official kit of the library as a base kit, at `version` or the kit's default; \
             installing it again changes the version. A built-in kit removed earlier comes \
             back. A slug the library does not hold is 404.",
        )
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .path_param("kit_slug", "Kit slug")
        .json_request::<InstallKitDto>(openapi, "The version, optional")
        .handler(upsert_base_kit)
        .json_response_with_schema::<InstalledKitDto>(openapi, StatusCode::OK, "The base kit")
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    router = OperationBuilder::delete("/studio-kits/v1/base-kits/{kit_slug}")
        .operation_id("studio_kits.delete_base_kit")
        .summary("Stop a kit being installed for every organization")
        .description(
            "Platform administrators only (403 `PLATFORM_ADMIN_REQUIRED`). A built-in kit stays \
             removed until it is installed again. Organizations that installed the kit for \
             themselves keep it. A kit that is not a base kit is 404.",
        )
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .path_param("kit_slug", "Kit slug")
        .handler(delete_base_kit)
        .no_content_response(StatusCode::NO_CONTENT, "No longer a base kit")
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    router = OperationBuilder::put("/studio-kits/v1/organization-kits/{kit_slug}")
        .operation_id("studio_kits.upsert_organization_kit")
        .summary("Install a kit for one organization")
        .description(
            "The organization's administrators (its owner, a role with `kit.manage`) or a \
             platform administrator; 403 `KIT_ADMIN_REQUIRED` otherwise. `organization_id` \
             names the organization, the caller's home when absent; a project or workspace is \
             400. At `version` or the kit's default; installing it again changes the version. \
             A kit that is also a base kit applies at the newer of the two versions.",
        )
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .path_param("kit_slug", "Kit slug")
        .query_param_typed(
            crate::org_scope::PARAM,
            false,
            crate::org_scope::PARAM_DOC,
            "string",
        )
        .json_request::<InstallKitDto>(openapi, "The version, optional")
        .handler(upsert_organization_kit)
        .json_response_with_schema::<InstalledKitDto>(
            openapi,
            StatusCode::OK,
            "The organization kit",
        )
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    OperationBuilder::delete("/studio-kits/v1/organization-kits/{kit_slug}")
        .operation_id("studio_kits.delete_organization_kit")
        .summary("Uninstall a kit the organization installed for itself")
        .description(
            "The organization's administrators or a platform administrator; 403 \
             `KIT_ADMIN_REQUIRED` otherwise. A kit the organization has only as a base kit is \
             refused with 400 `failed_precondition` (`BASE_KIT`): the platform installed it for \
             everyone, and the organization may only hide its tabs. A kit it never installed \
             is 404.",
        )
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .path_param("kit_slug", "Kit slug")
        .query_param_typed(
            crate::org_scope::PARAM,
            false,
            crate::org_scope::PARAM_DOC,
            "string",
        )
        .handler(delete_organization_kit)
        .no_content_response(StatusCode::NO_CONTENT, "Uninstalled")
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi)
}

fn internal(error: anyhow::Error) -> CanonicalError {
    CanonicalError::internal(format!("kit registry failed: {error:#}")).create()
}

async fn catalogue(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Arc<KitRegistryService>>,
    Extension(installer): Extension<Arc<KitInstaller>>,
    Extension(access): Extension<OrgAccess>,
    Query(query): Query<CatalogueQuery>,
) -> ApiResult<JsonBody<KitListDto>> {
    let page = query.page;
    let mut library = service.catalogue();
    // An organization's own kits are listed only for it, and only when it is
    // named: the IDE and other callers see the shared library as before.
    if let Some(org) = query.organization_id {
        let ctx = crate::org_scope::resolve(access.0.as_ref(), &ctx, Some(org)).await?;
        let shelf = installer
            .shelf(&ctx, ctx.subject_tenant_id())
            .await
            .map_err(refused)?;
        library.extend(shelf.into_iter().map(|k| k.kit));
    }
    let items: Vec<KitDto> = library
        .into_iter()
        .filter(|kit| {
            query
                .shelf
                .as_deref()
                .is_none_or(|shelf| kit.shelf == shelf)
        })
        .map(Into::into)
        .collect();
    let (items, total) = page_of(items, page);
    Ok(Json(KitListDto { items, total }))
}

async fn get_kit(
    OrgCtx(ctx): OrgCtx,
    Extension(service): Extension<Arc<KitRegistryService>>,
    Extension(installer): Extension<Arc<KitInstaller>>,
    Path(kit_slug): Path<String>,
) -> ApiResult<JsonBody<KitDetailDto>> {
    if let Some(detail) = service.kit(&kit_slug) {
        return Ok(Json(detail.into()));
    }
    // Not in the shared library: the organization's own shelf.
    let slug = kit_slug.trim().to_ascii_lowercase();
    match installer
        .shelf_kit(&ctx, ctx.subject_tenant_id(), &slug)
        .await
        .map_err(refused)?
    {
        Some(kit) => Ok(Json(shelf_detail(kit))),
        None => Err(
            KitRegistryError::not_found("the kit library does not hold this kit")
                .with_resource(kit_slug)
                .create(),
        ),
    }
}

async fn list_shelf(
    OrgCtx(ctx): OrgCtx,
    Extension(installer): Extension<Arc<KitInstaller>>,
    Query(page): Query<PageQuery>,
) -> ApiResult<JsonBody<ShelfListDto>> {
    let shelf = installer
        .shelf(&ctx, ctx.subject_tenant_id())
        .await
        .map_err(refused)?;
    let items: Vec<KitDetailDto> = shelf.into_iter().map(shelf_detail).collect();
    let (items, total) = page_of(items, page);
    Ok(Json(ShelfListDto { items, total }))
}

fn source_of(body: ShelfSourceDto) -> super::shelf::SourceInput {
    super::shelf::SourceInput {
        connection_id: body.connection_id,
        repository: body.repository,
        path: body.path.unwrap_or_default(),
        git_ref: body.git_ref,
        slug: body.slug,
    }
}

async fn preview_shelf_kit(
    OrgCtx(ctx): OrgCtx,
    Extension(installer): Extension<Arc<KitInstaller>>,
    Json(body): Json<ShelfSourceDto>,
) -> ApiResult<JsonBody<KitDetailDto>> {
    let kit = installer
        .preview_shelf_kit(&ctx, ctx.subject_tenant_id(), source_of(body))
        .await
        .map_err(refused)?;
    Ok(Json(shelf_detail(kit)))
}

async fn add_shelf_kit(
    OrgCtx(ctx): OrgCtx,
    Extension(installer): Extension<Arc<KitInstaller>>,
    Json(body): Json<ShelfSourceDto>,
) -> ApiResult<JsonBody<KitDetailDto>> {
    let kit = installer
        .add_shelf_kit(&ctx, ctx.subject_tenant_id(), source_of(body))
        .await
        .map_err(refused)?;
    Ok(Json(shelf_detail(kit)))
}

async fn refresh_shelf_kit(
    OrgCtx(ctx): OrgCtx,
    Extension(installer): Extension<Arc<KitInstaller>>,
    Path(kit_slug): Path<String>,
) -> ApiResult<JsonBody<KitDetailDto>> {
    let kit = installer
        .refresh_shelf_kit(&ctx, ctx.subject_tenant_id(), &kit_slug)
        .await
        .map_err(refused)?;
    Ok(Json(shelf_detail(kit)))
}

async fn remove_shelf_kit(
    OrgCtx(ctx): OrgCtx,
    Extension(installer): Extension<Arc<KitInstaller>>,
    Path(kit_slug): Path<String>,
) -> ApiResult<StatusCode> {
    installer
        .remove_shelf_kit(&ctx, ctx.subject_tenant_id(), &kit_slug)
        .await
        .map_err(refused)?;
    Ok(StatusCode::NO_CONTENT)
}

/// The organization's shelf (ADR-0068 phase 7).
fn register_shelf_routes(mut router: Router, openapi: &dyn OpenApiRegistry) -> Router {
    router = OperationBuilder::get("/studio-kits/v1/organization-shelf")
        .operation_id("studio_kits.list_organization_shelf")
        .summary("The kits an organization added from its own repositories")
        .description(
            "Any member. Each kit as `GET /catalog/{kit_slug}` describes it, with `origin`: \
                 the connection, repository, directory and ref it was read from and the commit \
                 it is pinned to. Only this organization's catalogue lists them.",
        )
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .query_param_typed(
            crate::org_scope::PARAM,
            false,
            crate::org_scope::PARAM_DOC,
            "string",
        )
        .query_param_typed(
            "offset",
            false,
            "Zero-based index of the first item",
            "integer",
        )
        .query_param_typed("limit", false, "Page size, 1..=200 (default 50)", "integer")
        .handler(list_shelf)
        .json_response_with_schema::<ShelfListDto>(openapi, StatusCode::OK, "The shelf")
        .error_401(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    router = OperationBuilder::post("/studio-kits/v1/organization-shelf/preview")
        .operation_id("studio_kits.probe_organization_shelf_kit")
        .summary("Read a kit from a repository without adding it")
        .description(
            "What adding the kit would add: its manifest (`kit.json`, else \
                 `.cf-studio-kit.toml`) read in `path` of `repository` through the \
                 organization's connection `connection_id`, at the newest commit that touched \
                 that directory on `ref`. Nothing is kept. Those who may install kits for the \
                 organization (403 `KIT_ADMIN_REQUIRED`). A connection that is not the \
                 organization's own, a repository it cannot read, a directory with no \
                 manifest or a manifest that does not check is 400; a slug a built-in or \
                 official kit has is 400 `failed_precondition` (`KIT_SLUG_TAKEN`).",
        )
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .query_param_typed(
            crate::org_scope::PARAM,
            false,
            crate::org_scope::PARAM_DOC,
            "string",
        )
        .json_request::<ShelfSourceDto>(openapi, "Where the kit is")
        .handler(preview_shelf_kit)
        .json_response_with_schema::<KitDetailDto>(openapi, StatusCode::OK, "The kit it would add")
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    router = OperationBuilder::post("/studio-kits/v1/organization-shelf")
        .operation_id("studio_kits.create_organization_shelf_kit")
        .summary("Add a kit from a repository to the organization's shelf")
        .description(
            "Reads the kit as `POST /organization-shelf/preview` does, pins it, and keeps it \
                 on the organization's shelf, replacing a kit of the same slug there. It is \
                 then installed like any kit (`PUT /organization-kits/{kit_slug}`, \
                 `PUT /project-kits/{kit_slug}`). The same refusals as the preview.",
        )
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .query_param_typed(
            crate::org_scope::PARAM,
            false,
            crate::org_scope::PARAM_DOC,
            "string",
        )
        .json_request::<ShelfSourceDto>(openapi, "Where the kit is")
        .handler(add_shelf_kit)
        .json_response_with_schema::<KitDetailDto>(openapi, StatusCode::OK, "The kit added")
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    router = OperationBuilder::post("/studio-kits/v1/organization-shelf/{kit_slug}/refresh")
        .operation_id("studio_kits.sync_organization_shelf_kit")
        .summary("Read a shelf kit again at its ref and re-pin it")
        .description(
            "Those who may install kits for the organization. The kit's source is read \
                 again at its ref and pinned to the commit found; an organization or project \
                 that installed the kit keeps the commit it installed until it installs the kit \
                 again. A slug not on the shelf is 404; the preview's refusals apply.",
        )
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .query_param_typed(
            crate::org_scope::PARAM,
            false,
            crate::org_scope::PARAM_DOC,
            "string",
        )
        .path_param("kit_slug", "Kit slug")
        .handler(refresh_shelf_kit)
        .json_response_with_schema::<KitDetailDto>(openapi, StatusCode::OK, "The kit, re-pinned")
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    OperationBuilder::delete("/studio-kits/v1/organization-shelf/{kit_slug}")
        .operation_id("studio_kits.delete_organization_shelf_kit")
        .summary("Take a kit off the organization's shelf")
        .description(
            "Those who may install kits for the organization. A kit the organization has \
                 installed stays: 400 `failed_precondition` (`KIT_INSTALLED`); uninstall it \
                 first. A slug not on the shelf is 404.",
        )
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .query_param_typed(
            crate::org_scope::PARAM,
            false,
            crate::org_scope::PARAM_DOC,
            "string",
        )
        .path_param("kit_slug", "Kit slug")
        .handler(remove_shelf_kit)
        .no_content_response(StatusCode::NO_CONTENT, "Removed from the shelf")
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi)
}

/// A move a project's phase may make.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct PhaseMoveDto {
    /// The lifecycle's name for it (`start` when the project has no phase).
    pub transition: String,
    pub to: String,
}

/// A project's phase (Project lifecycle, a built-in kit).
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct ProjectPhaseDto {
    pub project_id: String,
    /// Project lifecycle applies to the project; everything else is empty
    /// when it does not.
    pub installed: bool,
    pub phase: Option<String>,
    /// Who moves it on: a subject id.
    pub phase_owner: Option<String>,
    /// When it entered its phase, RFC 3339.
    pub phase_since: Option<String>,
    /// The lifecycle's phases, in order.
    pub states: Vec<String>,
    /// The moves open from the current phase.
    pub next: Vec<PhaseMoveDto>,
}

/// Move a project to a phase.
#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct SetProjectPhaseDto {
    pub phase: String,
    /// Who moves it on from there; the project's current owner, else the
    /// caller, when absent.
    pub owner: Option<String>,
}

/// One project's phase in an organization's list.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct ProjectPhaseRowDto {
    pub project_id: String,
    pub phase: String,
    pub phase_owner: Option<String>,
    pub phase_since: Option<String>,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct ProjectPhaseListDto {
    /// Project lifecycle applies to the organization.
    pub installed: bool,
    pub items: Vec<ProjectPhaseRowDto>,
    pub total: u32,
}

fn phase_dto(project: Uuid, p: super::phase::Phase) -> ProjectPhaseDto {
    ProjectPhaseDto {
        project_id: project.to_string(),
        installed: p.installed,
        phase: p.phase,
        phase_owner: p.owner,
        phase_since: p.since,
        states: p.states,
        next: p
            .next
            .into_iter()
            .map(|(transition, to)| PhaseMoveDto { transition, to })
            .collect(),
    }
}

async fn get_project_phase(
    Extension(ctx): Extension<SecurityContext>,
    Extension(access): Extension<OrgAccess>,
    Extension(installer): Extension<Arc<KitInstaller>>,
    Query(ProjectKitQuery { project_id }): Query<ProjectKitQuery>,
) -> ApiResult<JsonBody<ProjectPhaseDto>> {
    let ctx = crate::org_scope::resolve(access.0.as_ref(), &ctx, Some(project_id)).await?;
    let phase = installer
        .project_phase(&ctx, project_id)
        .await
        .map_err(refused)?;
    Ok(Json(phase_dto(project_id, phase)))
}

async fn put_project_phase(
    Extension(ctx): Extension<SecurityContext>,
    Extension(access): Extension<OrgAccess>,
    Extension(installer): Extension<Arc<KitInstaller>>,
    Query(ProjectKitQuery { project_id }): Query<ProjectKitQuery>,
    Json(body): Json<SetProjectPhaseDto>,
) -> ApiResult<JsonBody<ProjectPhaseDto>> {
    let ctx = crate::org_scope::resolve(access.0.as_ref(), &ctx, Some(project_id)).await?;
    let phase = installer
        .set_project_phase(&ctx, project_id, &body.phase, body.owner.as_deref())
        .await
        .map_err(refused)?;
    Ok(Json(phase_dto(project_id, phase)))
}

async fn list_project_phases(
    OrgCtx(ctx): OrgCtx,
    Extension(installer): Extension<Arc<KitInstaller>>,
    Query(page): Query<PageQuery>,
) -> ApiResult<JsonBody<ProjectPhaseListDto>> {
    let (installed, rows) = installer
        .project_phases(&ctx, ctx.subject_tenant_id())
        .await
        .map_err(refused)?;
    let items: Vec<ProjectPhaseRowDto> = rows
        .into_iter()
        .map(
            |(project_id, phase, phase_owner, phase_since)| ProjectPhaseRowDto {
                project_id,
                phase,
                phase_owner,
                phase_since,
            },
        )
        .collect();
    let (items, total) = page_of(items, page);
    Ok(Json(ProjectPhaseListDto {
        installed,
        items,
        total,
    }))
}

/// One Inbox source a kit brings (ADR-0068 §6).
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct KitInboxSourceQueryDto {
    pub kit_slug: String,
    /// The kit's name, for the person: an item says which kit it comes from.
    pub kit_name: String,
    /// The version installed.
    pub kit_version: String,
    pub id: String,
    pub label: String,
    /// `query`: `query` is run over the kit's objects. `endpoint`: `path` is
    /// called, and answers `{items: [{id, title?, …}]}` for the caller.
    /// `studio`: one of the sources studio-user's Inbox reads itself
    /// (`review-requests`, `pull-requests`), on while its kit is installed
    /// for the whole organization.
    pub kind: String,
    /// For a `query` source, the body `POST /studio-domain-model/v1/query`
    /// takes; the string `"$me"` in it is the person whose Inbox is read.
    /// `null` for an `endpoint` source.
    pub query: serde_json::Value,
    /// For an `endpoint` source: the gear's route, `GET`, called as the
    /// person whose Inbox is read.
    pub path: Option<String>,
    /// An item's title; `{field}` is a field of the row.
    pub title: Option<String>,
    /// The row's field naming the workspace an item is in.
    pub workspace_field: Option<String>,
    /// Which screen and tool answer an item; null when the source names
    /// none, and an item opens the kit's workspace.
    pub destination: Option<KitInboxDestinationDto>,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct KitInboxSourceListDto {
    pub items: Vec<KitInboxSourceQueryDto>,
    pub total: u32,
}

async fn list_inbox_sources(
    OrgCtx(ctx): OrgCtx,
    Extension(installer): Extension<Arc<KitInstaller>>,
    Query(page): Query<PageQuery>,
) -> ApiResult<JsonBody<KitInboxSourceListDto>> {
    let sources = installer
        .inbox_sources(&ctx, ctx.subject_tenant_id())
        .await
        .map_err(refused)?;
    let items: Vec<KitInboxSourceQueryDto> = sources
        .into_iter()
        .map(|s| KitInboxSourceQueryDto {
            kit_slug: s.kit_slug,
            kit_name: s.kit_name,
            kit_version: s.kit_version,
            kind: s.source.kind().to_owned(),
            id: s.source.id,
            label: s.source.label,
            query: s.source.query.unwrap_or_default(),
            path: s.source.path,
            title: s.source.title,
            workspace_field: s.source.workspace_field,
            destination: s.source.destination.map(Into::into),
        })
        .collect();
    let (items, total) = page_of(items, page);
    Ok(Json(KitInboxSourceListDto { items, total }))
}

/// Project lifecycle's function: a project's phase (ADR-0068 §7).
fn register_phase_routes(mut router: Router, openapi: &dyn OpenApiRegistry) -> Router {
    router = OperationBuilder::get("/studio-kits/v1/inbox-sources")
        .operation_id("studio_kits.list_inbox_sources")
        .summary("The Inbox sources of the kits installed for an organization")
        .description(
            "Any member. Each source a kit installed for the whole organization (a base kit or \
             its own) declares (ADR-0068 §6), and the `endpoint` sources of a built-in kit a \
             project may install on its own: a `query` over the kit's objects that says what \
             waits on whom (`\"$me\"` is the person whose Inbox is read), or an `endpoint`, a \
             gear's route that answers the person's items, or `studio`, one of Studio's own \
             sources (review requests, pull requests) that the kit turns on; how an item is \
             titled, and the kit \
             it comes from. studio-user's Inbox runs them as the person.",
        )
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .query_param_typed(
            crate::org_scope::PARAM,
            false,
            crate::org_scope::PARAM_DOC,
            "string",
        )
        .query_param_typed(
            "offset",
            false,
            "Zero-based index of the first item",
            "integer",
        )
        .query_param_typed("limit", false, "Page size, 1..=200 (default 50)", "integer")
        .handler(list_inbox_sources)
        .json_response_with_schema::<KitInboxSourceListDto>(openapi, StatusCode::OK, "The sources")
        .error_401(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    router = OperationBuilder::get("/studio-kits/v1/project-phase")
        .operation_id("studio_kits.get_project_phase")
        .summary("A project's phase (Project lifecycle)")
        .description(
            "Any member who reaches the project. The phase, its owner and since when, read from \
             the project's object in the organization's model, with the lifecycle's phases and \
             the moves open from the current one. `installed` is false, and the rest empty, \
             where Project lifecycle does not apply to the project.",
        )
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .query_param_typed("project_id", true, "The project", "string")
        .handler(get_project_phase)
        .json_response_with_schema::<ProjectPhaseDto>(openapi, StatusCode::OK, "The phase")
        .error_400(openapi)
        .error_401(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    router = OperationBuilder::put("/studio-kits/v1/project-phase")
        .operation_id("studio_kits.update_project_phase")
        .summary("Move a project to a phase (Project lifecycle)")
        .description(
            "Only along a transition the kit's lifecycle declares (400 `failed_precondition`, \
             `NO_SUCH_TRANSITION`); a project with no phase may start in any. Sets `phase`, \
             `phase_owner` (`owner`, else the project's, else the caller) and `phase_since` on \
             the project's object, written as the caller: the PDP's `domain.edit` decides (403 \
             `DOMAIN_EDIT_REQUIRED`). Where Project lifecycle does not apply, 400 \
             `failed_precondition` (`KIT_NOT_INSTALLED`).",
        )
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .query_param_typed("project_id", true, "The project", "string")
        .json_request::<SetProjectPhaseDto>(openapi, "The phase, and optionally its owner")
        .handler(put_project_phase)
        .json_response_with_schema::<ProjectPhaseDto>(openapi, StatusCode::OK, "The phase")
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    OperationBuilder::get("/studio-kits/v1/project-phases")
        .operation_id("studio_kits.list_project_phases")
        .summary("Every project of an organization with its phase (Project lifecycle)")
        .description(
            "Any member. The projects whose object carries a phase, by project id. `installed` \
             is false, and the list empty, where Project lifecycle does not apply to the \
             organization.",
        )
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .query_param_typed(
            crate::org_scope::PARAM,
            false,
            crate::org_scope::PARAM_DOC,
            "string",
        )
        .query_param_typed(
            "offset",
            false,
            "Zero-based index of the first item",
            "integer",
        )
        .query_param_typed("limit", false, "Page size, 1..=200 (default 50)", "integer")
        .handler(list_project_phases)
        .json_response_with_schema::<ProjectPhaseListDto>(openapi, StatusCode::OK, "The phases")
        .error_401(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi)
}

async fn list_installations(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Arc<KitRegistryService>>,
    Path(project_id): Path<Uuid>,
    Query(page): Query<PageQuery>,
) -> ApiResult<JsonBody<KitInstallationListDto>> {
    let items = service
        .list_installations(&ctx, project_id)
        .await
        .map_err(internal)?;
    let items: Vec<KitInstallationDto> = items.into_iter().map(Into::into).collect();
    let (items, total) = page_of(items, page);
    Ok(Json(KitInstallationListDto { items, total }))
}

async fn request_installation(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Arc<KitRegistryService>>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<RequestKitInstallationDto>,
) -> ApiResult<JsonBody<KitInstallationDto>> {
    let value = service
        .request_installation(
            &ctx,
            project_id,
            &body.kit_slug,
            &body.version,
            &body.install_mode,
            body.scope.as_deref().unwrap_or_default(),
        )
        .await
        .map_err(|error| {
            KitRegistryError::invalid_argument()
                .with_constraint(error.to_string())
                .create()
        })?;
    Ok(Json(value.into()))
}

async fn remove_installation(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Arc<KitRegistryService>>,
    Path((project_id, kit_slug)): Path<(Uuid, String)>,
) -> ApiResult<StatusCode> {
    service
        .remove_installation(&ctx, project_id, &kit_slug)
        .await
        .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

/// A missing bridge or a stopped IDE is an expected state, not a defect: the
/// repository set only exists while a session runs. 503 lets the portal say
/// "open the IDE first" instead of surfacing an internal error.
fn session_unavailable(error: anyhow::Error) -> CanonicalError {
    CanonicalError::service_unavailable()
        .with_detail(format!("project repositories are unavailable: {error:#}"))
        .create()
}

async fn list_repositories(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Arc<KitRegistryService>>,
    Path(project_id): Path<Uuid>,
    Query(page): Query<PageQuery>,
) -> ApiResult<JsonBody<ProjectRepositoryListDto>> {
    let items = service
        .list_repositories(&ctx, project_id)
        .await
        .map_err(session_unavailable)?;
    let items: Vec<ProjectRepositoryDto> = items.into_iter().map(Into::into).collect();
    let (items, total) = page_of(items, page);
    Ok(Json(ProjectRepositoryListDto { items, total }))
}

async fn materialize_installation(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Arc<KitRegistryService>>,
    Path((project_id, kit_slug)): Path<(Uuid, String)>,
    Json(body): Json<MaterializeKitInstallationDto>,
) -> ApiResult<JsonBody<KitInstallationDto>> {
    let value = service
        .materialize_installation(&ctx, project_id, &kit_slug, body.repository_id)
        .await
        .map_err(|error| {
            if error.is::<super::service::SessionUnavailable>() {
                session_unavailable(error)
            } else if error.is::<super::service::NotRequested>() {
                KitRegistryError::not_found(error.to_string())
                    .with_resource(kit_slug.clone())
                    .create()
            } else {
                internal(error)
            }
        })?;
    Ok(Json(value.into()))
}

async fn report_materialization(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Arc<KitRegistryService>>,
    Path((project_id, kit_slug)): Path<(Uuid, String)>,
    Json(body): Json<ReportKitMaterializationDto>,
) -> ApiResult<JsonBody<KitInstallationDto>> {
    let failure = match body.status.as_str() {
        "installed" => None,
        "failed" => Some(
            body.failure_reason
                .filter(|reason| !reason.trim().is_empty())
                .unwrap_or_else(|| "the IDE reported a failure without a reason".to_owned()),
        ),
        _ => {
            return Err(KitRegistryError::invalid_argument()
                .with_constraint("status must be \"installed\" or \"failed\"")
                .create());
        }
    };
    let value = service
        .report_materialization(
            &ctx,
            project_id,
            &kit_slug,
            &body.repository_id,
            body.repository_label,
            failure,
        )
        .await
        .map_err(|error| {
            KitRegistryError::invalid_argument()
                .with_constraint(error.to_string())
                .create()
        })?
        .ok_or_else(|| {
            KitRegistryError::not_found("the project has not requested this kit")
                .with_resource(kit_slug.clone())
                .create()
        })?;
    Ok(Json(value.into()))
}

async fn reconcile_installation(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Arc<KitRegistryService>>,
    Path((project_id, kit_slug)): Path<(Uuid, String)>,
) -> ApiResult<JsonBody<KitInstallationDto>> {
    let value = service
        .reconcile_installation(&ctx, project_id, &kit_slug)
        .await
        .map_err(session_unavailable)?;
    Ok(Json(value.into()))
}

pub fn register_routes(
    mut router: Router,
    openapi: &dyn OpenApiRegistry,
    service: Arc<KitRegistryService>,
    installer: Arc<KitInstaller>,
    access: OrgAccess,
) -> Router {
    router = register_installer_routes(router, openapi);
    router = register_shelf_routes(router, openapi);
    router = register_phase_routes(router, openapi);
    router = OperationBuilder::get("/studio-kits/v1/catalog")
        .operation_id("studio_kits.list_catalog")
        .summary("List kits available to Constructor Studio")
        .description(
            "Returns the kits this deployment knows about — name, slug and where \
             the canonical repository is. The kit's files stay in Git; this is \
             the metadata about them. With `organization_id`, that organization's own \
             kits (the `organization` shelf) are listed too; nobody else's ever are.",
        )
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .query_param_typed(
            crate::org_scope::PARAM,
            false,
            "An organization whose own kits to list as well",
            "string",
        )
        .query_param_typed(
            "offset",
            false,
            "Zero-based index of the first item",
            "integer",
        )
        .query_param_typed("limit", false, "Page size, 1..=200 (default 50)", "integer")
        .query_param_typed(
            "shelf",
            false,
            "Only this shelf: builtin, official or organization",
            "string",
        )
        .handler(catalogue)
        .json_response_with_schema::<KitListDto>(openapi, StatusCode::OK, "Kit catalogue")
        .error_401(openapi)
        .error_500(openapi)
        .register(router, openapi);

    router = OperationBuilder::get("/studio-kits/v1/catalog/{kit_slug}")
        .operation_id("studio_kits.get_kit")
        .summary("One kit of the library and what is inside it")
        .description(
            "Any signed-in user. The catalogue entry and what the kit brings, by the sections \
             of its manifest (ADR-0068 §3): screens, types, rules, functions, services, inbox \
             sources, MCP tools, permissions, the material `cfs` writes into a checkout, the \
             artifact kinds it covers and its docs. Every list is present, empty when the kit \
             brings none. `manifest` says where the description came from: `built-in` \
             (compiled into Studio), `.cf-studio-kit.toml` (a copy of the official kit's \
             manifest at the pinned version; never fetched on request) or null when nothing \
             reliable describes it, such as a kit pinned to another version by the \
             deployment. A kit of the organization's own shelf (`organization_id`, the \
             caller's home when absent) is described from the manifest kept at its pinned \
             commit (`kit.json` or `.cf-studio-kit.toml`), with `origin` saying where it came \
             from. A slug the library does not hold is 404.",
        )
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .path_param("kit_slug", "Kit slug")
        .query_param_typed(
            crate::org_scope::PARAM,
            false,
            crate::org_scope::PARAM_DOC,
            "string",
        )
        .handler(get_kit)
        .json_response_with_schema::<KitDetailDto>(
            openapi,
            StatusCode::OK,
            "The kit and its contents",
        )
        .error_401(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    router = OperationBuilder::get("/studio-kits/v1/projects/{project_id}/installations")
        .operation_id("studio_kits.list_project_installations")
        .summary("List desired kit installations for a project")
        .description(
            "Returns the kits a project wants installed. Desired state only: \
             materializing the files into a checkout is `cfs`'s job.",
        )
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .path_param("project_id", "Project tenant id")
        .query_param_typed(
            "offset",
            false,
            "Zero-based index of the first item",
            "integer",
        )
        .query_param_typed("limit", false, "Page size, 1..=200 (default 50)", "integer")
        .handler(list_installations)
        .json_response_with_schema::<KitInstallationListDto>(
            openapi,
            StatusCode::OK,
            "Project kit installations",
        )
        .error_401(openapi)
        .error_403(openapi)
        .error_500(openapi)
        .register(router, openapi);

    router = OperationBuilder::post("/studio-kits/v1/projects/{project_id}/installations")
        .operation_id("studio_kits.request_installation")
        .summary("Request a registered kit for a project")
        .description("Records desired state as pending. A trusted cfs runner materializes it in a later phase.")
        .tag("StudioKits").authenticated().require_license_features::<License>([])
        .path_param("project_id", "Project tenant id")
        .json_request::<RequestKitInstallationDto>(openapi, "Kit installation request")
        .handler(request_installation)
        .json_response_with_schema::<KitInstallationDto>(openapi, StatusCode::OK, "Requested installation")
        .error_400(openapi).error_401(openapi).error_403(openapi).error_500(openapi).register(router, openapi);

    router = OperationBuilder::post(
        "/studio-kits/v1/projects/{project_id}/installations/{kit_slug}/materialize",
    )
    .operation_id("studio_kits.materialize_installation")
    .summary("Install a requested kit in the project's running IDE")
    .description(
        "Calls the S2S-token-gated Theia runner. The kit and Git ref are independently \
         validated by the IDE. 503 when the IDE could not do it -- no running session, or the \
         session's install failed (the row records why) -- as `reconcile` and `repositories` \
         answer; 404 when the project never requested the kit.",
    )
    .tag("StudioKits")
    .authenticated()
    .require_license_features::<License>([])
    .path_param("project_id", "Project tenant id")
    .path_param("kit_slug", "Registered kit slug")
    .json_request::<MaterializeKitInstallationDto>(openapi, "Optional target repository")
    .handler(materialize_installation)
    .json_response_with_schema::<KitInstallationDto>(
        openapi,
        StatusCode::OK,
        "Materialized installation",
    )
    .error_401(openapi)
    .error_403(openapi)
    .error_404(openapi)
    .error_500(openapi)
    .error_503(openapi)
    .register(router, openapi);

    router = OperationBuilder::post(
        "/studio-kits/v1/projects/{project_id}/installations/{kit_slug}/materializations",
    )
    .operation_id("studio_kits.create_materialization")
    .summary("Record how an install the IDE ran itself went")
    .description("For an IDE the backend cannot call -- a desktop -- which installs the requested kit into its own checkout with its own cfs. Updates the installation and its repository row exactly as a materialize through a session would.")
    .tag("StudioKits")
    .authenticated()
    .require_license_features::<License>([])
    .path_param("project_id", "Project tenant id")
    .path_param("kit_slug", "Registered kit slug")
    .json_request::<ReportKitMaterializationDto>(openapi, "The repository and the outcome")
    .handler(report_materialization)
    .json_response_with_schema::<KitInstallationDto>(openapi, StatusCode::OK, "Updated installation")
    .error_400(openapi)
    .error_401(openapi)
    .error_403(openapi)
    .error_404(openapi)
    .error_500(openapi)
    .register(router, openapi);

    router = OperationBuilder::post(
        "/studio-kits/v1/projects/{project_id}/installations/{kit_slug}/reconcile",
    )
    .operation_id("studio_kits.reconcile_installation")
    .summary("Materialize this kit wherever its scope says it belongs")
    .description("Idempotent: repositories already carrying the requested version are skipped, so this is the call that picks up a repository added after the kit was installed. Requires a running session.")
    .tag("StudioKits")
    .authenticated()
    .require_license_features::<License>([])
    .path_param("project_id", "Project tenant id")
    .path_param("kit_slug", "Registered kit slug")
    .handler(reconcile_installation)
    .json_response_with_schema::<KitInstallationDto>(openapi, StatusCode::OK, "Reconciled installation")
    .error_401(openapi)
    .error_403(openapi)
    .error_500(openapi)
    .register(router, openapi);

    router = OperationBuilder::get("/studio-kits/v1/projects/{project_id}/repositories")
        .operation_id("studio_kits.list_project_repositories")
        .summary("List the repositories the project's running IDE has mounted")
        .description("Live view from the IDE, not stored state: the project repository is listed first and is the target a materialize call without repositoryId will use. Requires a running session.")
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .path_param("project_id", "Project tenant id")
        .query_param_typed("offset", false, "Zero-based index of the first item", "integer")
        .query_param_typed("limit", false, "Page size, 1..=200 (default 50)", "integer")
        .handler(list_repositories)
        .json_response_with_schema::<ProjectRepositoryListDto>(
            openapi,
            StatusCode::OK,
            "Project repositories",
        )
        .error_401(openapi)
        .error_403(openapi)
        .error_500(openapi)
        .register(router, openapi);

    OperationBuilder::delete("/studio-kits/v1/projects/{project_id}/installations/{kit_slug}")
        .operation_id("studio_kits.remove_installation")
        .summary("Remove a project's desired kit installation")
        .description(
            "Stops a project wanting a kit. Files already materialized into a \
             checkout are left alone.",
        )
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .path_param("project_id", "Project tenant id")
        .path_param("kit_slug", "Kit slug")
        .handler(remove_installation)
        .no_content_response(StatusCode::NO_CONTENT, "Installation removed")
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_500(openapi)
        .register(router, openapi)
        .layer(Extension(service.bundles()))
        .layer(Extension(service))
        .layer(Extension(installer))
        .layer(Extension(access))
}
