//! HTTP surface for creating an organization.

use std::sync::Arc;

use axum::{Extension, Router, extract::Path};
use toolkit::api::canonical_prelude::*;
use toolkit::api::operation_builder::{CORE_GLOBAL_BASE_LICENSE_FEATURE, LicenseFeature};
use toolkit::api::{OpenApiRegistry, OperationBuilder};
use toolkit_canonical_errors::resource_error;
use toolkit_security::SecurityContext;
use uuid::Uuid;

use super::creation::{Creation, within_limit};
use super::service::{ApprovalError, OrganizationService, Step};
use crate::user_profile::{OrganizationRequest, RequestRefusal};

#[resource_error(gts_id!("cf.studio._.organizations.v1~"))]
pub struct OrganizationError;

pub(super) struct License;
impl AsRef<str> for License {
    fn as_ref(&self) -> &'static str {
        CORE_GLOBAL_BASE_LICENSE_FEATURE
    }
}
impl LicenseFeature for License {}

#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct CreateOrganizationRequest {
    /// Free text. Not unique — two organizations may share a name.
    pub name: String,
    /// The id a previous attempt reported, to finish what it started. Omit to
    /// create a new organization.
    #[serde(default)]
    pub organization_id: Option<String>,
}

/// How a person without an organization comes by one here, and how many
/// they may make (ADR-0051 §2).
#[derive(Clone, Copy, Debug, Default)]
pub struct CreationPolicy {
    pub mode: Creation,
    pub max_owned: Option<usize>,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct OrganizationCapabilitiesDto {
    /// When false, a person with no organization cannot create one at once —
    /// and the portal should not offer a control that will be refused. True
    /// only when `organization_creation` is `open`; kept for the clients that
    /// read it before that field existed.
    pub self_service: bool,
    /// `open` — create one and own it; `request` — ask for one, and a platform
    /// administrator decides (ADR-0051); `off` — wait for an invitation.
    pub organization_creation: String,
    /// Whether the caller is a platform administrator, so the portal shows
    /// the organization requests to decide. Not an authority: every request
    /// route checks for itself.
    pub decides_requests: bool,
}

/// A person asking for an organization.
#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct NewOrganizationRequestDto {
    /// The organization's name, as `POST /organizations` takes it.
    pub name: String,
    /// Who they are and what they want it for, for the administrator deciding.
    #[serde(default)]
    pub note: Option<String>,
}

/// A request for an organization (ADR-0051).
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct OrganizationRequestDto {
    /// Also the id the organization gets when the request is approved.
    pub id: String,
    /// The person who asked.
    pub requested_by: String,
    /// Who asked, as their profile names them; absent when it names nobody.
    /// Filled for a platform administrator's listing.
    pub requester_name: Option<String>,
    /// An address the identity provider verified for whoever asked.
    pub requester_email: Option<String>,
    pub name: String,
    pub note: String,
    /// `pending`, `approved`, `rejected` or `withdrawn`.
    pub status: String,
    /// Why it was rejected, for the person who asked.
    pub reason: Option<String>,
    /// The organization it became, once approved.
    pub organization_id: Option<String>,
    /// Epoch milliseconds, the convention every `_ms` field here follows.
    pub created_at_ms: i64,
    pub decided_at_ms: Option<i64>,
}

/// A page of organization requests.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct OrganizationRequestListDto {
    pub items: Vec<OrganizationRequestDto>,
    pub total: u32,
}

/// A platform administrator's decision on a request.
#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct OrganizationRequestDecisionDto {
    /// `approve` or `reject`.
    pub decision: String,
    /// On approval: the name the organization gets, when it should differ
    /// from the one asked for. The request keeps what was asked.
    #[serde(default)]
    pub name: Option<String>,
    /// On rejection: why, for the person who asked.
    #[serde(default)]
    pub reason: Option<String>,
}

/// Whose requests a listing shows.
#[derive(Debug, serde::Deserialize)]
pub struct OrganizationRequestQuery {
    /// `mine` (default) or `all` — every request, for a platform administrator.
    #[serde(default)]
    pub scope: Option<String>,
    /// Only requests in this status.
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct OrganizationDto {
    pub id: String,
    pub name: String,
}

/// An organization's logo.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct OrganizationLogoDto {
    /// `image/png`, `image/jpeg`, `image/webp` or `image/gif`.
    pub content_type: String,
    /// The image, base64.
    pub data: String,
    /// SHA-256 of the image, hex; changes with every new logo.
    pub digest: String,
}

/// A new logo.
#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct UpsertOrganizationLogoRequest {
    /// What the image is: `image/png`, `image/jpeg`, `image/webp` or
    /// `image/gif`. It must match the bytes.
    pub content_type: String,
    /// The image, base64, at most 256 KiB once decoded.
    pub data: String,
}

fn logo_dto(logo: super::logo::Logo) -> OrganizationLogoDto {
    OrganizationLogoDto {
        content_type: logo.content_type,
        data: logo.data,
        digest: logo.digest,
    }
}

/// Whose logo: `?organization_id=` for an organization, `?tenant_id=` for
/// any tenant — a workspace or a project, whose picture is its icon
/// (convention C2: a scope is a query parameter, never a path segment). The
/// same row on each, not inherited: a project without one is not shown its
/// organization's.
#[derive(Debug, serde::Deserialize)]
pub struct LogoQuery {
    #[serde(default)]
    pub organization_id: Option<String>,
    #[serde(default)]
    pub tenant_id: Option<String>,
}

fn org_id(query: &LogoQuery) -> ApiResult<Uuid> {
    query
        .tenant_id
        .as_deref()
        .or(query.organization_id.as_deref())
        .and_then(|raw| Uuid::parse_str(raw.trim()).ok())
        .ok_or_else(|| {
            OrganizationError::invalid_argument()
                .with_constraint("tenant_id (or organization_id) must be the tenant's uuid")
                .create()
        })
}

async fn get_organization_logo(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Option<Arc<OrganizationService>>>,
    axum::extract::Query(query): axum::extract::Query<LogoQuery>,
) -> ApiResult<JsonBody<OrganizationLogoDto>> {
    let service = configured(service)?;
    let org = org_id(&query)?;
    match service.logo(&ctx, org).await {
        Ok(Some(logo)) => Ok(Json(logo_dto(logo))),
        Ok(None) => Err(OrganizationError::not_found("no logo is set there")
            .with_resource(org.to_string())
            .create()),
        Err(error) => Err(CanonicalError::internal(format!("{error:#}")).create()),
    }
}

async fn upsert_organization_logo(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Option<Arc<OrganizationService>>>,
    axum::extract::Query(query): axum::extract::Query<LogoQuery>,
    Json(request): Json<UpsertOrganizationLogoRequest>,
) -> ApiResult<JsonBody<OrganizationLogoDto>> {
    let service = configured(service)?;
    let org = org_id(&query)?;
    if !service.may_change_logo(&ctx, org).await {
        return Err(OrganizationError::permission_denied()
            .with_reason("ORG_ADMIN_REQUIRED")
            .create());
    }
    let logo = super::logo::checked(&request.content_type, &request.data).map_err(|why| {
        OrganizationError::invalid_argument()
            .with_constraint(why)
            .create()
    })?;
    service
        .set_logo(&ctx, org, Some(&logo))
        .await
        .map_err(|error| CanonicalError::internal(format!("{error:#}")).create())?;
    Ok(Json(logo_dto(logo)))
}

async fn delete_organization_logo(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Option<Arc<OrganizationService>>>,
    axum::extract::Query(query): axum::extract::Query<LogoQuery>,
) -> ApiResult<StatusCode> {
    let service = configured(service)?;
    let org = org_id(&query)?;
    if !service.may_change_logo(&ctx, org).await {
        return Err(OrganizationError::permission_denied()
            .with_reason("ORG_ADMIN_REQUIRED")
            .create());
    }
    service
        .set_logo(&ctx, org, None)
        .await
        .map_err(|error| CanonicalError::internal(format!("{error:#}")).create())?;
    Ok(StatusCode::NO_CONTENT)
}

/// One grant to put (`PUT /access-grants`).
#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct PutAccessGrantRequest {
    /// `member` (a person: their person id) or `team`.
    pub subject_type: String,
    pub subject_id: String,
    /// What a screen shows for the subject.
    pub subject_name: Option<String>,
    /// A role the organization defines (`admin`, `editor`, `viewer`, ...);
    /// never `owner`, which follows an owner membership.
    pub role_key: String,
    /// `org` (the whole organization) or `project`.
    pub scope_type: String,
    /// The project, for a `project` grant.
    pub scope_id: Option<String>,
    pub scope_name: Option<String>,
}

/// One grant as now kept.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct AccessGrantDto {
    pub id: String,
    pub subject_type: String,
    pub subject_id: String,
    pub subject_name: String,
    pub role_key: String,
    pub scope_type: String,
    pub scope_id: String,
    pub scope_name: String,
}

/// Which grant to remove (`DELETE /access-grants`), and where.
#[derive(Debug, serde::Deserialize)]
pub struct AccessGrantQuery {
    #[serde(default)]
    pub organization_id: Option<String>,
    #[serde(default)]
    pub subject_type: Option<String>,
    #[serde(default)]
    pub subject_id: Option<String>,
    #[serde(default)]
    pub scope_type: Option<String>,
    #[serde(default)]
    pub scope_id: Option<String>,
}

fn grant_org(raw: Option<&str>) -> ApiResult<Uuid> {
    raw.and_then(|r| Uuid::parse_str(r.trim()).ok())
        .ok_or_else(|| {
            OrganizationError::invalid_argument()
                .with_constraint("organization_id must be the organization's uuid")
                .create()
        })
}

fn change_refused(error: super::access_grants::ChangeError) -> CanonicalError {
    match error {
        super::access_grants::ChangeError::Invalid(why) => OrganizationError::invalid_argument()
            .with_constraint(why)
            .create(),
        super::access_grants::ChangeError::Internal(e) => {
            CanonicalError::internal(format!("{e:#}")).create()
        }
    }
}

async fn put_access_grant(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Option<Arc<OrganizationService>>>,
    axum::extract::Query(query): axum::extract::Query<AccessGrantQuery>,
    Json(request): Json<PutAccessGrantRequest>,
) -> ApiResult<JsonBody<AccessGrantDto>> {
    let service = configured(service)?;
    let org = grant_org(query.organization_id.as_deref())?;
    if !service.may_manage_access(&ctx, org).await {
        return Err(OrganizationError::permission_denied()
            .with_reason("ACCESS_ADMIN_REQUIRED")
            .create());
    }
    let key = super::access_grants::key_of(
        &request.subject_type,
        &request.subject_id,
        &request.scope_type,
        request.scope_id.as_deref(),
    )
    .map_err(|e| {
        OrganizationError::invalid_argument()
            .with_constraint(format!("{e:#}"))
            .create()
    })?;
    let grant = super::access_grants::Grant {
        key,
        role_key: request.role_key.trim().to_owned(),
        subject_name: request.subject_name.filter(|n| !n.trim().is_empty()),
        scope_name: request.scope_name.filter(|n| !n.trim().is_empty()),
    };
    let written = service
        .change_access(&ctx, org, &|doc| {
            super::access_grants::put(doc, org, &grant)
        })
        .await
        .map_err(change_refused)?;
    let text = |name: &str| written[name].as_str().unwrap_or_default().to_owned();
    Ok(Json(AccessGrantDto {
        id: text("id"),
        subject_type: text("subjectType"),
        subject_id: text("subjectId"),
        subject_name: text("subjectName"),
        role_key: text("roleKey"),
        scope_type: text("scopeType"),
        scope_id: text("scopeId"),
        scope_name: text("scopeName"),
    }))
}

async fn delete_access_grant(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Option<Arc<OrganizationService>>>,
    axum::extract::Query(query): axum::extract::Query<AccessGrantQuery>,
) -> ApiResult<StatusCode> {
    let service = configured(service)?;
    let org = grant_org(query.organization_id.as_deref())?;
    if !service.may_manage_access(&ctx, org).await {
        return Err(OrganizationError::permission_denied()
            .with_reason("ACCESS_ADMIN_REQUIRED")
            .create());
    }
    let key = super::access_grants::key_of(
        query.subject_type.as_deref().unwrap_or_default(),
        query.subject_id.as_deref().unwrap_or_default(),
        query.scope_type.as_deref().unwrap_or_default(),
        query.scope_id.as_deref(),
    )
    .map_err(|e| {
        OrganizationError::invalid_argument()
            .with_constraint(format!("{e:#}"))
            .create()
    })?;
    service
        .change_access(&ctx, org, &|doc| super::access_grants::remove(doc, &key))
        .await
        .map_err(change_refused)?;
    Ok(StatusCode::NO_CONTENT)
}

/// A new name for an organization or a workspace.
#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct RenameTenantRequest {
    pub name: String,
}

/// The name as now kept.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct TenantNameDto {
    pub tenant_id: String,
    pub name: String,
}

async fn rename_tenant(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Option<Arc<OrganizationService>>>,
    axum::extract::Query(query): axum::extract::Query<LogoQuery>,
    Json(request): Json<RenameTenantRequest>,
) -> ApiResult<JsonBody<TenantNameDto>> {
    let service = configured(service)?;
    let tenant = org_id(&query)?;
    let name = request.name.trim();
    if name.is_empty() || name.chars().count() > 200 {
        return Err(OrganizationError::invalid_argument()
            .with_constraint("name is 1..=200 characters")
            .create());
    }
    let name = service.rename(&ctx, tenant, name).await.map_err(|error| {
        OrganizationError::invalid_argument()
            .with_constraint(format!("{error:#}"))
            .create()
    })?;
    Ok(Json(TenantNameDto {
        tenant_id: tenant.to_string(),
        name,
    }))
}

fn configured(service: Option<Arc<OrganizationService>>) -> ApiResult<Arc<OrganizationService>> {
    service.ok_or_else(|| {
        CanonicalError::service_unavailable()
            .with_detail(
                "studio-organizations is not configured: it needs account-management and \
                 studio-user, so that a new organization gets both a tenant and an owner",
            )
            .create()
    })
}

async fn organization_capabilities(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Option<Arc<OrganizationService>>>,
    Extension(creation): Extension<CreationPolicy>,
) -> ApiResult<JsonBody<OrganizationCapabilitiesDto>> {
    let decides_requests = match service {
        Some(service) => service.is_platform_admin(&ctx).await,
        None => false,
    };
    Ok(Json(OrganizationCapabilitiesDto {
        self_service: creation.mode == Creation::Open,
        organization_creation: creation.mode.as_str().to_owned(),
        decides_requests,
    }))
}

/// Refuse a person who already owns as many organizations as they may make.
async fn check_limit(
    ctx: &SecurityContext,
    service: &OrganizationService,
    creation: CreationPolicy,
) -> ApiResult<()> {
    let Some(max) = creation.max_owned else {
        return Ok(());
    };
    let owned = service
        .self_made_ownerships(ctx)
        .await
        .map_err(|error| CanonicalError::internal(format!("{error:#}")).create())?
        // Nobody can count: refuse rather than let a limit go unenforced.
        .ok_or_else(|| {
            CanonicalError::service_unavailable()
                .with_detail("studio-user cannot count the organizations this person owns")
                .create()
        })?;
    if within_limit(owned, Some(max)) {
        Ok(())
    } else {
        Err(OrganizationError::failed_precondition()
            .with_precondition_violation(
                "organization".to_owned(),
                format!(
                    "you already own {owned} organization(s), the most this installation allows"
                ),
                "ORGANIZATION_LIMIT_REACHED",
            )
            .create())
    }
}

async fn create_organization(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Option<Arc<OrganizationService>>>,
    Extension(creation): Extension<CreationPolicy>,
    Json(req): Json<CreateOrganizationRequest>,
) -> ApiResult<(StatusCode, JsonBody<OrganizationDto>)> {
    if creation.mode != Creation::Open {
        return Err(OrganizationError::permission_denied()
            .with_reason("SELF_SERVICE_DISABLED")
            .create());
    }
    let service = configured(service)?;
    // A resumed creation finishes an organization already counted.
    if req.organization_id.is_none() {
        check_limit(&ctx, &service, creation).await?;
    }
    let resume = match req.organization_id.as_deref() {
        None => None,
        Some(raw) => Some(Uuid::parse_str(raw).map_err(|_| {
            OrganizationError::invalid_argument()
                .with_constraint("organization_id must be a uuid")
                .create()
        })?),
    };

    match service.create(&ctx, &req.name, resume).await {
        Ok(org) => Ok((
            StatusCode::CREATED,
            Json(OrganizationDto {
                id: org.id.to_string(),
                name: org.name,
            }),
        )),
        // A rejected name is the caller's problem and nothing was created.
        Err((Step::Tenant, error, None)) => Err(OrganizationError::invalid_argument()
            .with_constraint(format!("{error:#}"))
            .create()),
        // Past the first write: the organization exists but is not finished.
        // The response names it, because that id is the only way to finish it
        // and the caller is the only one holding it.
        Err((step, error, Some(id))) => Err(CanonicalError::internal(format!(
            "the organization was created as {id} but {} could not be written: {error:#}. \
             Repeat this request with organization_id={id} to finish it.",
            match step {
                Step::Tenant => "its record",
                Step::Membership => "your membership of it and your owner grant on it",
            }
        ))
        .create()),
        Err((_, error, None)) => Err(CanonicalError::internal(format!("{error:#}")).create()),
    }
}

fn request_dto(r: OrganizationRequest) -> OrganizationRequestDto {
    OrganizationRequestDto {
        id: r.id.to_string(),
        requested_by: r.requested_by,
        requester_name: r.requester_name,
        requester_email: r.requester_email,
        name: r.name,
        note: r.note,
        status: r.status,
        reason: r.reason,
        organization_id: r.organization_id.map(|id| id.to_string()),
        created_at_ms: r.created_at_ms,
        decided_at_ms: r.decided_at_ms,
    }
}

fn refusal(refusal: RequestRefusal) -> CanonicalError {
    match refusal {
        RequestRefusal::NotFound => OrganizationError::not_found(refusal.message())
            .with_resource("organization_request".to_owned())
            .create(),
        RequestRefusal::AlreadyPending(_) => OrganizationError::failed_precondition()
            .with_precondition_violation(
                "organization_request".to_owned(),
                refusal.message(),
                "REQUEST_ALREADY_PENDING",
            )
            .create(),
        RequestRefusal::NotPending(_) => OrganizationError::failed_precondition()
            .with_precondition_violation(
                "organization_request".to_owned(),
                refusal.message(),
                "REQUEST_NOT_PENDING",
            )
            .create(),
    }
}

fn request_id(raw: &str) -> ApiResult<Uuid> {
    Uuid::parse_str(raw).map_err(|_| {
        OrganizationError::invalid_argument()
            .with_constraint("request id must be a uuid")
            .create()
    })
}

fn admin_required() -> CanonicalError {
    OrganizationError::permission_denied()
        .with_reason("PLATFORM_ADMIN_REQUIRED")
        .create()
}

fn requests_unavailable() -> CanonicalError {
    CanonicalError::service_unavailable()
        .with_detail("studio-user keeps no organization requests in this installation")
        .create()
}

async fn create_organization_request(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Option<Arc<OrganizationService>>>,
    Extension(creation): Extension<CreationPolicy>,
    Json(req): Json<NewOrganizationRequestDto>,
) -> ApiResult<(StatusCode, JsonBody<OrganizationRequestDto>)> {
    if creation.mode != Creation::Request {
        return Err(OrganizationError::permission_denied()
            .with_reason("REQUESTS_DISABLED")
            .create());
    }
    let service = configured(service)?;
    let requests = service
        .requests()
        .cloned()
        .ok_or_else(requests_unavailable)?;
    let name = super::service::clean_name(&req.name).map_err(|error| {
        OrganizationError::invalid_argument()
            .with_constraint(format!("{error:#}"))
            .create()
    })?;
    let note = crate::user_profile::clean_request_note(req.note.as_deref().unwrap_or("")).map_err(
        |why| {
            OrganizationError::invalid_argument()
                .with_constraint(why)
                .create()
        },
    )?;
    check_limit(&ctx, &service, creation).await?;
    match requests.file_request(&ctx, &name, &note).await {
        Ok(Ok(request)) => Ok((StatusCode::CREATED, Json(request_dto(request)))),
        Ok(Err(why)) => Err(refusal(why)),
        Err(error) => Err(CanonicalError::internal(format!("{error:#}")).create()),
    }
}

async fn list_organization_requests(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Option<Arc<OrganizationService>>>,
    axum::extract::Query(query): axum::extract::Query<OrganizationRequestQuery>,
    axum::extract::Query(page): axum::extract::Query<crate::pagination::PageQuery>,
) -> ApiResult<JsonBody<OrganizationRequestListDto>> {
    let service = configured(service)?;
    let requests = service
        .requests()
        .cloned()
        .ok_or_else(requests_unavailable)?;
    let status = query
        .status
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if let Some(status) = status
        && !crate::user_profile::ORGANIZATION_REQUEST_STATUSES.contains(&status)
    {
        return Err(OrganizationError::invalid_argument()
            .with_constraint("status must be pending, approved, rejected or withdrawn")
            .create());
    }
    let all = match query.scope.as_deref().map(str::trim) {
        None | Some("" | "mine") => false,
        Some("all") => true,
        Some(_) => {
            return Err(OrganizationError::invalid_argument()
                .with_constraint("scope must be mine or all")
                .create());
        }
    };
    let found = if all {
        if !service.is_platform_admin(&ctx).await {
            return Err(admin_required());
        }
        requests.requests(status).await
    } else {
        requests.requests_of_caller(&ctx).await.map(|mine| {
            mine.into_iter()
                .filter(|r| status.is_none_or(|s| r.status == s))
                .collect()
        })
    }
    .map_err(|error| CanonicalError::internal(format!("{error:#}")).create())?;
    let items: Vec<OrganizationRequestDto> = found.into_iter().map(request_dto).collect();
    let (items, total) = crate::pagination::page_of(items, page);
    Ok(Json(OrganizationRequestListDto { items, total }))
}

async fn cancel_organization_request(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Option<Arc<OrganizationService>>>,
    Path(id): Path<String>,
) -> ApiResult<JsonBody<OrganizationRequestDto>> {
    let service = configured(service)?;
    let requests = service
        .requests()
        .cloned()
        .ok_or_else(requests_unavailable)?;
    match requests.withdraw_request(&ctx, request_id(&id)?).await {
        Ok(Ok(request)) => Ok(Json(request_dto(request))),
        Ok(Err(why)) => Err(refusal(why)),
        Err(error) => Err(CanonicalError::internal(format!("{error:#}")).create()),
    }
}

async fn decide_organization_request(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Option<Arc<OrganizationService>>>,
    Path(id): Path<String>,
    Json(req): Json<OrganizationRequestDecisionDto>,
) -> ApiResult<JsonBody<OrganizationRequestDto>> {
    let service = configured(service)?;
    let requests = service
        .requests()
        .cloned()
        .ok_or_else(requests_unavailable)?;
    let id = request_id(&id)?;
    if !service.is_platform_admin(&ctx).await {
        return Err(admin_required());
    }
    match req.decision.trim() {
        "approve" => match service.approve(&ctx, id, req.name.as_deref()).await {
            Ok(request) => Ok(Json(request_dto(request))),
            Err(ApprovalError::Refused(why)) => Err(refusal(why)),
            Err(ApprovalError::BadName(error)) => Err(OrganizationError::invalid_argument()
                .with_constraint(format!("{error:#}"))
                .create()),
            Err(ApprovalError::Failed(error)) => Err(CanonicalError::internal(format!(
                "the approval did not finish: {error:#}. Approving again finishes it."
            ))
            .create()),
        },
        "reject" => {
            let reason = crate::user_profile::clean_request_reason(req.reason.as_deref()).map_err(
                |why| {
                    OrganizationError::invalid_argument()
                        .with_constraint(why)
                        .create()
                },
            )?;
            match requests.reject_request(&ctx, id, reason.as_deref()).await {
                Ok(Ok(request)) => Ok(Json(request_dto(request))),
                Ok(Err(why)) => Err(refusal(why)),
                Err(error) => Err(CanonicalError::internal(format!("{error:#}")).create()),
            }
        }
        _ => Err(OrganizationError::invalid_argument()
            .with_constraint("decision must be approve or reject")
            .create()),
    }
}

async fn delete_organization(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Option<Arc<OrganizationService>>>,
    Path(org_id): Path<String>,
) -> ApiResult<StatusCode> {
    let service = configured(service)?;
    let org = Uuid::parse_str(&org_id).map_err(|_| {
        OrganizationError::invalid_argument()
            .with_constraint("organization id must be a uuid")
            .create()
    })?;
    if !service.may_delete(&ctx, org).await {
        return Err(OrganizationError::permission_denied()
            .with_reason("ORG_OWNER_REQUIRED")
            .create());
    }
    match service.delete(&ctx, org).await {
        Ok(gone) => {
            // What went with it is logged, not answered: a DELETE is 204.
            tracing::info!(
                organization = %org,
                people_removed = gone.people,
                connections_removed = gone.connections,
                "studio-organizations: organization deleted"
            );
            Ok(StatusCode::NO_CONTENT)
        }
        // Account-management refuses a tenant that still has children, and that
        // refusal is the caller's to act on: an organization with a workspace or
        // a project in it is not disposed of by answering one prompt.
        Err(error) => Err(OrganizationError::invalid_argument()
            .with_constraint(format!("{error:#}"))
            .create()),
    }
}

/// The privileges a role may carry, and the ladder a fresh organization gets.
///
/// SERVED BECAUSE IT WAS BEING COPIED. The access screen writes the whole
/// access document, so it needs the catalogue to offer and the ladder to seed —
/// and the prototype kept both as a second copy in `access.ts`, under a comment
/// saying they "must match" `access_config.rs`. They do match today; the cost
/// of them not matching is silent, which is the problem. A privilege named on
/// the writing side and not on the evaluating side is written into a role and
/// then carries nothing.
///
/// Identifiers and the ladder are served; LABELS ARE NOT. What a privilege is
/// called belongs to whoever draws the screen — the portal with i18n has its
/// own strings, and a backend that shipped English here would be handing it a
/// second set to ignore. What cannot differ is the set of ids, and that is what
/// this carries.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct AccessCatalogueDto {
    /// Every privilege the policy decision point understands, in catalogue
    /// order (ADR-0019 §2).
    pub privileges: Vec<String>,
    /// The role ladder seeded into a fresh organization, as stored.
    pub default_roles: serde_json::Value,
}

async fn access_catalogue() -> ApiResult<JsonBody<AccessCatalogueDto>> {
    Ok(Json(AccessCatalogueDto {
        privileges: crate::access_config::PRIVILEGES
            .iter()
            .map(|p| (*p).to_string())
            .collect(),
        default_roles: crate::access_config::default_roles(),
    }))
}

/// One row of the portfolio, with what it contains.
///
/// Every count is nullable and the null is load-bearing: it means the source
/// could not be asked, which is a different fact from a count of zero. A portal
/// renders `—` for null and the number — including a real `0` — otherwise.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct RollupDto {
    /// Tenant id of the workspace or project this row is about.
    pub id: String,
    pub name: String,
    /// `workspace` or `project`. The counts that apply depend on it.
    pub kind: String,
    /// The workspace a project belongs to; null on a workspace row. The tree
    /// is drawn from this, without asking for the parentage again.
    pub parent_id: Option<String>,
    /// Workspaces: how many projects they hold. Null on a project row.
    pub projects: Option<u32>,
    /// Projects: files bound to a document type, or still undecided.
    pub documents: Option<u32>,
    /// Projects: detector verdicts across those documents.
    pub findings: Option<u32>,
    /// Projects: repositories attached in the project's settings.
    pub repos: Option<u32>,
    /// Projects: `new_gears`, `product` or `existing`, from the project's
    /// configuration; null when it records none.
    pub project_kind: Option<String>,
    /// Projects: what the project is for, in its owner's words.
    pub brief: Option<String>,
    /// Projects: the short top-level values of the project's configuration
    /// (`project.config`), by name -- text up to 120 characters, numbers and
    /// booleans; objects, lists and long text left out. Carried as they are
    /// stored, without meaning: the portal filters a list by them (`status`,
    /// the phase a person put the project in; `type`, the template it was
    /// created from; whatever a kit adds). Null when the configuration could
    /// not be read.
    #[schema(value_type = Option<Object>)]
    pub attributes: Option<serde_json::Value>,
    /// Projects: findings placed in the text — the items of each verdict's
    /// `details.findings`, and one for a failed verdict (`high`,
    /// `gate-failed`) recorded without items. The Specs list's per-row
    /// `findings`, summed: a verdict goes with its document when a sync finds
    /// the file gone, a repository is disconnected or a Studio document is
    /// deleted, and a sync sweeps the ones left from before that was so. Until
    /// a project's next sync those still count here, and only here.
    /// `findings` counts every verdict.
    pub open_findings: Option<u32>,
    /// Projects: unresolved threads the repositories report, on documents and
    /// on pull requests under review. Null when no repository could say.
    pub open_comments: Option<u32>,
    /// Projects: specs — repository files bound to a type, and documents
    /// written in Studio.
    pub specs: Option<u32>,
    /// Projects: of the specs, the ones written in Studio.
    pub specs_authored: Option<u32>,
    /// Projects: of the specs, the ones with a validation verdict.
    pub specs_checked: Option<u32>,
    /// Projects: of the checked specs, the ones that do not conform.
    pub specs_failing: Option<u32>,
    /// Projects: pull requests open now. Null when none was ever synced —
    /// no activity to show, which is not the same as a quiet week.
    pub pulls_open: Option<u32>,
    /// Projects: pull requests merged over the last `activity_days` days.
    pub pulls_merged: Option<u32>,
    /// Projects: pull requests that moved, per day, oldest first, always
    /// `activity_days` long.
    pub pull_days: Option<Vec<u32>>,
    /// The window `pulls_merged` and `pull_days` cover.
    pub activity_days: Option<u32>,
    /// Projects: the people who may work in it, from Studio's memberships
    /// rather than the IdP. Under the organization's `tenant` access model
    /// (the default) that is every active member of the organization; under
    /// `roles`, the active members holding a grant on this project or across
    /// the organization. Each person counts once. Null when the memberships or
    /// the access config could not be read, or the workspace does not sit
    /// under an organization.
    pub team: Option<u32>,
    /// Projects: the newest event the Activity feed lists, as it words it
    /// (`Document checked`, `Comment`); null when nothing is recorded.
    pub last_event: Option<String>,
    /// What that event happened to.
    pub last_subject: Option<String>,
    /// When, RFC 3339.
    pub last_at: Option<String>,
    /// The icon somebody chose for the workspace or project: a glyph and a
    /// colour, both names the portal defines. Null when none was chosen, and
    /// the portal draws the one the project's kind implies. An uploaded image
    /// is not here (`GET /studio-organizations/v1/logo?tenant_id=`): a list
    /// should not carry pictures.
    pub icon_glyph: Option<String>,
    pub icon_color: Option<String>,
}

/// A page of rollups.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct RollupListDto {
    pub items: Vec<RollupDto>,
    pub total: u32,
}

/// `?project_id=` narrows the answer to one project, `?workspace_id=` to one
/// workspace and its projects (convention C2).
#[derive(Debug, serde::Deserialize)]
pub struct RollupQuery {
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub workspace_id: Option<String>,
}

fn rollup_dto(r: super::rollups::Rollup) -> RollupDto {
    let pulls = r
        .signals
        .as_ref()
        .filter(|s| s.pulls_known)
        .map(|s| &s.pulls);
    let last = r.signals.as_ref().and_then(|s| s.last_event.as_ref());
    RollupDto {
        project_kind: r.project_kind,
        brief: r.brief,
        attributes: r.attributes.map(serde_json::Value::Object),
        open_findings: r.signals.as_ref().map(|s| s.open_findings),
        open_comments: r.signals.as_ref().and_then(|s| s.open_comments),
        specs: r.specs.map(|s| s.specs),
        specs_authored: r.specs.map(|s| s.authored),
        specs_checked: r.specs.map(|s| s.checked),
        specs_failing: r.specs.map(|s| s.failing),
        pulls_open: pulls.map(|p| p.open),
        pulls_merged: pulls.map(|p| p.merged),
        pull_days: pulls.map(|p| p.days.clone()),
        activity_days: pulls
            .map(|_| u32::try_from(super::rollups::ACTIVITY_DAYS).unwrap_or(u32::MAX)),
        team: r.team,
        last_event: last.map(|e| e.event.clone()),
        last_subject: last.map(|e| e.subject.clone()),
        last_at: last.and_then(|e| e.recorded.clone()),
        icon_glyph: r.icon.as_ref().map(|(glyph, _)| glyph.clone()),
        icon_color: r.icon.map(|(_, color)| color),
        id: r.id.to_string(),
        name: r.name,
        kind: r.kind.as_str().to_string(),
        parent_id: r.parent_id.map(|id| id.to_string()),
        projects: r.projects,
        documents: r.documents,
        findings: r.findings,
        repos: r.repos,
    }
}

async fn list_rollups(
    // `?organization_id=`: the portfolio of an organization the caller
    // reaches but is not at home in (the Inbox on another organization's
    // screen).
    crate::org_scope::OrgCtx(ctx): crate::org_scope::OrgCtx,
    Extension(sources): Extension<Option<Arc<super::rollups::Sources>>>,
    axum::extract::Query(query): axum::extract::Query<RollupQuery>,
) -> ApiResult<JsonBody<RollupListDto>> {
    let sources = sources.ok_or_else(|| {
        CanonicalError::service_unavailable()
            .with_detail("account-management is not available, so nothing can be counted")
            .create()
    })?;
    let uuid = |raw: &str, field: &str| {
        Uuid::parse_str(raw.trim()).map_err(|_| {
            OrganizationError::invalid_argument()
                .with_constraint(format!("{field} must be a uuid"))
                .create()
        })
    };
    let items = match (query.project_id.as_deref(), query.workspace_id.as_deref()) {
        (Some(_), Some(_)) => {
            return Err(OrganizationError::invalid_argument()
                .with_constraint("give project_id or workspace_id, not both")
                .create());
        }
        (Some(raw), None) => sources
            .one_project(&ctx, uuid(raw, "project_id")?)
            .await
            .into_iter()
            .collect(),
        (None, Some(raw)) => {
            sources
                .one_workspace(&ctx, uuid(raw, "workspace_id")?)
                .await
        }
        (None, None) => sources.portfolio(&ctx).await,
    };
    let items: Vec<RollupDto> = items.into_iter().map(rollup_dto).collect();
    Ok(Json(RollupListDto {
        total: u32::try_from(items.len()).unwrap_or(u32::MAX),
        items,
    }))
}

// ── The organization's overview ──────────────────────────────────────────────

/// What an organization's leaders ask of it, for one organization, over the
/// last 30 days against the same days a month earlier. Every money field is
/// null unless the caller holds `cost.view`; every other null means that
/// source could not be asked, never zero.
#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(response)]
pub struct OrganizationOverviewDto {
    pub organization_id: String,
    pub name: String,
    /// The period, RFC 3339: the last 30 UTC days, today included, `[from, to)`.
    pub period_from: String,
    pub period_to: String,
    /// The same 30 days one month earlier.
    pub previous_from: String,
    pub previous_to: String,
    /// The rules the answer was computed with: a pull request is stuck after
    /// `stuck_days`, spend growing by `growth_alert` (a share) is news, a
    /// project is quiet after `quiet_days`.
    pub stuck_days: u32,
    pub growth_alert: f64,
    pub quiet_days: u32,
    /// `shown`, `hidden` (the caller may not see costs) or `unreadable`.
    pub costs: String,
    /// What waits on the organization's leaders, the most urgent first.
    pub needs: Vec<OverviewNeedDto>,
    /// Null unless `costs` is `shown`.
    pub spend: Option<OverviewSpendDto>,
    pub delivery: OverviewDeliveryDto,
    pub specs: OverviewSpecsDto,
    pub people: OverviewPeopleDto,
    /// The workspaces, the one in most trouble first, each with its projects.
    pub workspaces: Vec<OverviewWorkspaceDto>,
    /// Where the money goes: every grouping, with and without people's own
    /// keys, so a screen switches between them without asking again. Null
    /// unless `costs` is `shown`.
    pub money: Option<Vec<OverviewMoneyDto>>,
    /// Who the stuck pull requests wait on, longest queue first. Null when no
    /// pull request could be read.
    pub waiting_on: Option<Vec<OverviewQueueDto>>,
    /// The component registry's open decisions. Null when it could not be read.
    pub decisions: Option<OverviewDecisionsDto>,
    /// The kits installed for the whole organization that the answer was
    /// computed for (ADR-0070 §7): a need of a kit not among them is not
    /// listed, and without `project-git` the pull-request parts (`delivery`'s
    /// counts, `waiting_on`, each place's `stuck`) are null or zero. Null when
    /// the installed kits could not be read, and nothing was left out.
    pub kits: Option<Vec<String>>,
}

/// One thing that waits on the organization's leaders. `kind` says which
/// fields are set: `connection` (`provider`, `status`, `projects`, `repos`),
/// `spend` (`current`, `previous`, `forecast`, `grower`), `pulls` (`pulls`,
/// `people`), `components` (`components`), `runs` (`runs`).
#[derive(Debug, Clone, Default)]
#[toolkit_macros::api_dto(response)]
pub struct OverviewNeedDto {
    pub kind: String,
    /// `danger` or `warn`.
    pub tone: String,
    pub provider: Option<String>,
    /// `401` or `403`.
    pub status: Option<String>,
    /// The names of the projects a refused connection stops.
    pub projects: Vec<String>,
    pub repos: Option<u32>,
    pub current: Option<f64>,
    pub previous: Option<f64>,
    pub forecast: Option<f64>,
    /// The project whose spend grew the most.
    pub grower: Option<String>,
    pub pulls: Option<u32>,
    pub people: Option<u32>,
    pub components: Option<u32>,
    pub runs: Option<u32>,
    /// The kit the need is read for and whose screen answers it
    /// (`project-git` for stuck pull requests, `org-costs` for spend,
    /// `components` for the registry's decisions); null for the shell's own
    /// (a refused connection, failed runs). A need of a kit not installed for
    /// the organization is not listed.
    pub kit: Option<String>,
}

/// The organization's spend. People's own keys are never in it: `own_keys`
/// says what they spent on top.
#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(response)]
pub struct OverviewSpendDto {
    pub currency: String,
    pub current: f64,
    pub previous: f64,
    /// Where this month ends at its pace so far.
    pub forecast: f64,
    pub own_keys: f64,
    /// Of `current`: what members' sign-ins spent, what subjects no active
    /// member signs in with spent, and IDE sessions, which name nobody.
    pub attributed: f64,
    pub unattributed: f64,
    pub sessions: f64,
    /// `provider/model` (or `session`) used without a price: counted, not priced.
    pub unpriced: Vec<String>,
}

#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(response)]
pub struct OverviewDeliveryDto {
    /// Pull requests merged over the last `window_days` days.
    pub merged: Option<u32>,
    pub window_days: u32,
    pub open: Option<u32>,
    /// The middle open pull request's age, in days, drafts left out.
    pub median_wait_days: Option<f64>,
}

#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(response)]
pub struct OverviewSpecsDto {
    pub specs: Option<u32>,
    pub failing: Option<u32>,
    pub open_findings: Option<u32>,
}

#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(response)]
pub struct OverviewPeopleDto {
    /// Active members.
    pub active: Option<u32>,
    /// Members who used a model in the period. Null without costs.
    pub with_spend: Option<u32>,
    /// `spend.attributed` over `with_spend`. Null without costs.
    pub per_person: Option<f64>,
    /// Members with no model use and no open pull request they wrote or
    /// review. Null without costs or members.
    pub idle: Option<Vec<OverviewPersonDto>>,
}

#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(response)]
pub struct OverviewPersonDto {
    pub person_id: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(response)]
pub struct OverviewWorkspaceDto {
    pub id: String,
    pub name: String,
    pub spend: Option<f64>,
    pub previous: Option<f64>,
    pub specs_failing: u32,
    pub stuck: u32,
    /// The most recently active project's days without activity.
    pub quiet_days: Option<u32>,
    pub score: u32,
    /// Its projects, the one in most trouble first.
    pub projects: Vec<OverviewProjectDto>,
}

#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(response)]
pub struct OverviewProjectDto {
    pub id: String,
    pub name: String,
    pub spend: Option<f64>,
    pub previous: Option<f64>,
    pub specs_failing: Option<u32>,
    pub open_findings: Option<u32>,
    pub stuck: u32,
    pub quiet_days: Option<u32>,
    /// A connection it syncs through is refused.
    pub broken: bool,
    pub score: u32,
    /// What is wrong, worst first; empty when nothing is.
    pub reasons: Vec<OverviewReasonDto>,
}

/// One thing wrong with a project: `refused`, `specs_failing` (`value` =
/// how many), `stuck` (how many pull requests), `spend_grows` (the growth, a
/// share), `quiet` (days).
#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(response)]
pub struct OverviewReasonDto {
    pub kind: String,
    pub value: Option<f64>,
}

#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(response)]
pub struct OverviewMoneyDto {
    /// `project`, `person`, `model`, `source` or `payer`.
    pub group_by: String,
    pub include_personal: bool,
    pub rows: Vec<OverviewMoneyRowDto>,
}

/// One row of a breakdown. By person, `key` is the member's person id,
/// `unattributed` for subjects no active member signs in with, and empty for
/// IDE sessions.
#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(response)]
pub struct OverviewMoneyRowDto {
    pub key: String,
    /// The project's or person's name where the key is one.
    pub label: Option<String>,
    pub cost: f64,
    pub previous: f64,
    pub unpriced: bool,
}

#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(response)]
pub struct OverviewQueueDto {
    /// The member, when the account is one of the organization's people.
    pub person_id: Option<String>,
    /// Their name, else the account; null for pull requests nobody was asked
    /// to review.
    pub who: Option<String>,
    pub count: u32,
    pub oldest_days: u32,
}

#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(response)]
pub struct OverviewDecisionsDto {
    /// Candidates and declared entries: waiting for the organization to decide.
    pub undecided: u32,
    pub candidates: u32,
    pub registered: u32,
    pub published: u32,
}

async fn get_organization_overview(
    crate::org_scope::OrgCtx(ctx): crate::org_scope::OrgCtx,
    Extension(overview): Extension<Option<Arc<super::overview::Overview>>>,
) -> ApiResult<JsonBody<OrganizationOverviewDto>> {
    let overview = overview.ok_or_else(|| {
        CanonicalError::service_unavailable()
            .with_detail("account-management is not available, so nothing can be counted")
            .create()
    })?;
    let org = ctx.subject_tenant_id();
    let now = time::OffsetDateTime::now_utc();
    let answer = overview.answer(&ctx, org, now).await.map_err(|_| {
        OrganizationError::not_found(format!("there is no organization {org} for this caller"))
            .with_resource(org.to_string())
            .create()
    })?;
    Ok(Json(answer))
}

// ── a project's status ───────────────────────────────────────────────────────

/// Where a signal's action goes.
#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(response)]
pub struct ProjectSignalActionDto {
    /// What the button says: "Open Releases".
    pub label: String,
    /// A project tab (`sources`, `specs`, `model`, `components`, `releases`,
    /// `activity`), `pulls` (the project's pull requests) or `ide`.
    pub target: String,
}

/// One reason behind the verdict.
#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(response)]
pub struct ProjectSignalDto {
    /// `refused`, `product`, `build`, `deploy`, `findings`, `specs`, `stuck`,
    /// `nobody`, `threads`, `quiet`.
    pub key: String,
    /// `blocked`, `risk` or `info`; `info` does not move the verdict.
    pub level: String,
    /// The reason in a few words.
    pub phrase: String,
    pub detail: Option<String>,
    pub action: ProjectSignalActionDto,
    /// The kit the signal is read for and whose tab its action opens
    /// (`project-git`, `project-specs`, `project-issues`, `product-releases`,
    /// `project-activity`); null for the shell's own (the repository
    /// connection, the IDE). A signal of a kit not installed for the project
    /// is not listed (ADR-0070 §7).
    pub kit: Option<String>,
}

/// One step of the project's path.
#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(response)]
pub struct ProjectPathStepDto {
    /// `repos`, `types`, `model`, `findings`, `product` or `build`.
    pub step: String,
    pub title: String,
    /// `done`, `current`, `todo`, or `unknown` when its read failed.
    pub state: String,
    /// The state as the path strip draws it: `failed` for a failed build or
    /// a product that does not resolve, `warn` for open high findings,
    /// `later` for unknown, the state otherwise.
    pub flow: String,
    /// One line from the data, e.g. "74 of 75 documents typed."
    pub status: String,
    /// The project tab where it is done, and its button.
    pub tab: String,
    pub action: String,
    /// The kit whose tab that is; null for Sources, the shell's own. A step
    /// of a kit not installed for the project is not on its path.
    pub kit: Option<String>,
}

/// A project's status: one verdict, the signals behind it, its path.
#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(response)]
pub struct ProjectStatusDto {
    pub project_id: String,
    /// `blocked`, `at_risk` or `on_track`.
    pub verdict: String,
    /// "Blocked", "At risk", "On track".
    pub label: String,
    /// The main reason: the worst signal's phrase, or on track the next step
    /// ("next: compose the product") or "path complete".
    pub reason: String,
    /// How many more blocking or at-risk signals there are.
    pub more: u32,
    /// Worst first.
    pub signals: Vec<ProjectSignalDto>,
    pub path: Vec<ProjectPathStepDto>,
    /// The step to do next; absent when the path is done or unknown.
    pub next: Option<String>,
    /// The sources that could not be read: their part is not known, and
    /// never counted as nothing wrong or nothing done. A source of a kit not
    /// installed for the project is not read and not named here.
    pub unread: Vec<String>,
    /// The kits installed for the project that the status was computed for;
    /// null when they could not be read, and nothing was left out.
    pub kits: Option<Vec<String>>,
}

/// `?project_id=`: the project whose status to read.
#[derive(Debug, serde::Deserialize)]
pub struct ProjectStatusQuery {
    pub project_id: String,
}

async fn get_project_status(
    Extension(ctx): Extension<SecurityContext>,
    Extension(sources): Extension<Option<Arc<super::rollups::Sources>>>,
    Extension(overview): Extension<Option<Arc<super::overview::Overview>>>,
    headers: axum::http::HeaderMap,
    axum::extract::Query(query): axum::extract::Query<ProjectStatusQuery>,
) -> ApiResult<JsonBody<ProjectStatusDto>> {
    let project_id = query.project_id;
    use super::status;
    let unavailable = || {
        CanonicalError::service_unavailable()
            .with_detail("account-management is not available, so nothing can be read")
            .create()
    };
    let sources = sources.ok_or_else(unavailable)?;
    let id = Uuid::parse_str(project_id.trim()).map_err(|_| {
        OrganizationError::invalid_argument()
            .with_constraint("project_id must be a uuid")
            .create()
    })?;
    // The project as the caller sees it, as its rollup row: a project they
    // do not reach, or a tenant that is not a project, is not there.
    let not_found = || {
        OrganizationError::not_found(format!("there is no project {id} for this caller"))
            .with_resource(id.to_string())
            .create()
    };
    let tenant = sources
        .am
        .get_tenant(&ctx, id)
        .await
        .map_err(|_| not_found())?;
    if tenant.tenant_type.as_deref() != Some(super::sdk::PROJECT_TENANT_TYPE) {
        return Err(not_found());
    }
    let org = match tenant.parent_id {
        Some(ws) => sources
            .am
            .get_tenant(&ctx, ws.0)
            .await
            .ok()
            .and_then(|w| w.parent_id.map(|p| p.0)),
        None => None,
    };
    let rollup = sources.one_project(&ctx, id).await.ok_or_else(not_found)?;
    let api = crate::mcp::api_as(headers.get(axum::http::header::AUTHORIZATION).cloned())
        .ok_or_else(|| {
            CanonicalError::service_unavailable()
                .with_detail("studio-mcp is not running here, so the other gears cannot be read")
                .create()
        })?;
    let health = async {
        let overview = overview.as_ref()?;
        let answer = overview
            .answer(&ctx, org?, time::OffsetDateTime::now_utc())
            .await
            .ok()?;
        let line = answer
            .workspaces
            .into_iter()
            .flat_map(|w| w.projects)
            .find(|p| p.id == id.to_string())?;
        Some(status::Health {
            refused: line.reasons.iter().any(|r| r.kind == "refused"),
            quiet_days: line.reasons.iter().find(|r| r.kind == "quiet").map(|r| {
                r.value
                    .map_or(line.quiet_days.unwrap_or(0), |v| v.round() as u32)
            }),
            specs_failing: line.specs_failing,
            stuck: line.stuck,
        })
    };
    let project = id.to_string();
    // The kits installed for the project: what each signal and step belongs
    // to (ADR-0070 §7). Read beside the facts; a kit that does not apply
    // leaves its facts unread-and-unsaid rather than unknown.
    let kits = async {
        match overview.as_ref() {
            Some(overview) => overview.kits(&ctx, id).await,
            None => status::Kits::All,
        }
    };
    let (read, health, kits) = tokio::join!(
        super::status_read::read(&api, &project, rollup.repos),
        health,
        kits
    );
    let mut unread = Vec::new();
    for (name, missing, kit) in [
        ("repositories", read.path.repositories.is_none(), None),
        (
            "specs",
            read.path.specs.is_none(),
            status::step_kit("types"),
        ),
        (
            "project domain model",
            read.path.model.is_none(),
            status::step_kit("model"),
        ),
        (
            "findings",
            read.path.findings.is_none(),
            status::step_kit("findings"),
        ),
        (
            "product",
            read.path.product.is_none(),
            status::step_kit("product"),
        ),
        (
            "builds",
            read.path.build.is_none(),
            status::step_kit("build"),
        ),
        (
            "pull requests",
            read.pulls.is_none(),
            status::signal_kit("stuck"),
        ),
        (
            "deployments",
            read.deployments.is_none(),
            status::signal_kit("deploy"),
        ),
        ("organization health", health.is_none(), None),
    ] {
        if missing && kits.has(kit) {
            unread.push(name.to_string());
        }
    }
    let facts = status::Facts {
        specs: rollup.specs.as_ref().map(|s| s.specs),
        specs_failing: rollup.specs.as_ref().map(|s| s.failing),
        open_comments: rollup.signals.as_ref().and_then(|s| s.open_comments),
        pulls: read.pulls,
        deployments: read.deployments,
        health,
        // Comment threads waiting on the caller are read in the IDE's
        // sessions, which the server does not walk; the rollup's unanswered
        // threads stand in for them.
        waiting_on_me: None,
        path: Some(read.path),
    };
    let path = facts
        .path
        .as_ref()
        .map(|p| status::project_path_for(p, &kits))
        .unwrap_or_default();
    let signals = status::project_signals_for(&facts, &kits);
    let verdict = status::project_verdict(&signals, Some(&path));
    let next = status::next_step(&path).map(|s| s.id.to_string());
    let path_facts = facts.path.clone().unwrap_or_default();
    Ok(Json(ProjectStatusDto {
        project_id: id.to_string(),
        verdict: verdict.state.to_string(),
        label: verdict.label.to_string(),
        reason: verdict.reason,
        more: verdict.more,
        signals: signals
            .into_iter()
            .map(|s| ProjectSignalDto {
                key: s.key.to_string(),
                level: s.level.as_str().to_string(),
                phrase: s.phrase,
                detail: s.detail,
                action: ProjectSignalActionDto {
                    label: s.action_label.to_string(),
                    target: s.action_target.to_string(),
                },
                kit: s.kit.map(str::to_string),
            })
            .collect(),
        path: path
            .iter()
            .map(|s| ProjectPathStepDto {
                step: s.id.to_string(),
                title: s.title.to_string(),
                state: s.state.as_str().to_string(),
                flow: status::flow_state(s, &path_facts).to_string(),
                status: s.status.clone(),
                tab: s.tab.to_string(),
                action: s.action.to_string(),
                kit: s.kit.map(str::to_string),
            })
            .collect(),
        next,
        unread,
        kits: match kits {
            status::Kits::All => None,
            status::Kits::Only(kits) => Some(kits),
        },
    }))
}

/// `?range=` and the narrower scope, if any.
#[derive(Debug, serde::Deserialize)]
pub struct MetricsQuery {
    #[serde(default)]
    pub range: Option<String>,
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
}

async fn get_organization_metrics(
    crate::org_scope::OrgCtx(ctx): crate::org_scope::OrgCtx,
    Extension(metrics): Extension<Option<Arc<super::metrics::Metrics>>>,
    axum::extract::Query(query): axum::extract::Query<MetricsQuery>,
) -> ApiResult<JsonBody<super::metrics::OrgMetricsDto>> {
    use super::metrics::{Range, Scope};
    let metrics = metrics.ok_or_else(|| {
        CanonicalError::service_unavailable()
            .with_detail("account-management is not available, so nothing can be measured")
            .create()
    })?;
    let range = Range::parse(query.range.as_deref()).ok_or_else(|| {
        OrganizationError::invalid_argument()
            .with_constraint("range must be 7d, 30d or 90d")
            .create()
    })?;
    let uuid = |raw: &str, field: &str| {
        Uuid::parse_str(raw.trim()).map_err(|_| {
            OrganizationError::invalid_argument()
                .with_constraint(format!("{field} must be a uuid"))
                .create()
        })
    };
    let scope = match (query.project_id.as_deref(), query.workspace_id.as_deref()) {
        (Some(p), _) if !p.trim().is_empty() => Scope::Project(uuid(p, "project_id")?),
        (_, Some(w)) if !w.trim().is_empty() => Scope::Workspace(uuid(w, "workspace_id")?),
        _ => Scope::Organization,
    };
    let org = ctx.subject_tenant_id();
    let now = time::OffsetDateTime::now_utc();
    let answer = metrics
        .answer(&ctx, org, scope, range, now)
        .await
        .map_err(|_| {
            OrganizationError::not_found(format!(
                "there is no {} {} in organization {org} for this caller",
                scope.kind(),
                match scope {
                    Scope::Organization => org,
                    Scope::Workspace(id) | Scope::Project(id) => id,
                }
            ))
            .with_resource(org.to_string())
            .create()
        })?;
    Ok(Json(answer))
}

#[allow(clippy::too_many_arguments)]
pub fn register_routes(
    router: Router,
    openapi: &dyn OpenApiRegistry,
    service: Option<Arc<OrganizationService>>,
    creation: CreationPolicy,
    sources: Option<Arc<super::rollups::Sources>>,
    overview: Option<Arc<super::overview::Overview>>,
    metrics: Option<Arc<super::metrics::Metrics>>,
    access: Option<crate::org_scope::OrgAccess>,
) -> Router {
    let router = OperationBuilder::get("/studio-organizations/v1/capabilities")
        .operation_id("studio_organizations.capabilities")
        .summary("What this installation lets people do with organizations")
        .description(
            "How a person without an organization comes by one: `organization_creation` is \
             `open` (create one), `request` (ask, and a platform administrator decides — \
             ADR-0051) or `off` (wait for an invitation). The portal reads it so the \
             no-organization screen offers what will work rather than a control that answers \
             403. `self_service` is the older spelling of `open`. `decides_requests` says the \
             caller is a platform administrator, so the portal can show the requests to decide.",
        )
        .tag("StudioOrganizations")
        .authenticated()
        .require_license_features::<License>([])
        .handler(organization_capabilities)
        .json_response_with_schema::<OrganizationCapabilitiesDto>(
            openapi,
            StatusCode::OK,
            "Capabilities",
        )
        .error_401(openapi)
        .register(router, openapi);

    let router = OperationBuilder::get("/studio-organizations/v1/logo")
        .operation_id("studio_organizations.get_organization_logo")
        .summary("An organization's logo")
        .description(
            "The picture the portal shows beside the organization's name, so one organization \
             is told from another at a glance. Read as the caller: anyone who reaches the \
             organization sees it. With `tenant_id`, a workspace's or a project's icon, read \
             the same way. 404 when it has none.",
        )
        .tag("StudioOrganizations")
        .authenticated()
        .require_license_features::<License>([])
        .query_param_typed("organization_id", false, "The organization", "string")
        .query_param_typed(
            "tenant_id",
            false,
            "Any tenant instead: an organization, a workspace or a project",
            "string",
        )
        .handler(get_organization_logo)
        .json_response_with_schema::<OrganizationLogoDto>(openapi, StatusCode::OK, "The logo")
        .error_400(openapi)
        .error_401(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::put("/studio-organizations/v1/logo")
        .operation_id("studio_organizations.upsert_organization_logo")
        .summary("Set an organization's logo")
        .description(
            "Keeps a PNG, JPEG, WebP or GIF of at most 256 KiB as the organization's logo, \
             replacing the one before; with `tenant_id`, a workspace's or a project's icon. \
             Whoever administers access at that tenant may (`access.manage`, as the access \
             config resolved there grants it), and a platform administrator; anybody else is \
             refused. An image \
             whose bytes are not the type it declares is refused.",
        )
        .tag("StudioOrganizations")
        .authenticated()
        .require_license_features::<License>([])
        .query_param_typed("organization_id", false, "The organization", "string")
        .query_param_typed(
            "tenant_id",
            false,
            "Any tenant instead: an organization, a workspace or a project",
            "string",
        )
        .json_request::<UpsertOrganizationLogoRequest>(openapi, "The logo, base64-encoded")
        .handler(upsert_organization_logo)
        .json_response_with_schema::<OrganizationLogoDto>(openapi, StatusCode::OK, "The logo kept")
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::delete("/studio-organizations/v1/logo")
        .operation_id("studio_organizations.delete_organization_logo")
        .summary("Remove an organization's logo")
        .description(
            "The organization goes back to its initial in the portal. Who may is who may set \
             it. Answers 204 with no body, also when there was no logo.",
        )
        .tag("StudioOrganizations")
        .authenticated()
        .require_license_features::<License>([])
        .query_param_typed("organization_id", false, "The organization", "string")
        .query_param_typed(
            "tenant_id",
            false,
            "Any tenant instead: an organization, a workspace or a project",
            "string",
        )
        .handler(delete_organization_logo)
        .no_content_response(StatusCode::NO_CONTENT, "Removed")
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::put("/studio-organizations/v1/access-grants")
        .operation_id("studio_organizations.upsert_access_grant")
        .summary("Give a subject one role on one scope of the organization")
        .description(
            "Changes one grant of the organization's access config instead of the whole \
             document, so two people editing the Team or People screen do not overwrite each \
             other: the document is written back on the version read (account-management's \
             optimistic lock) and a write that lost the race reads again. Replaces the role the \
             subject held on that scope. Whoever administers access (`access.manage`, or the \
             owner) may; the PDP decides the write again. Never the `owner` role, which \
             follows an owner membership. Publishes `tenant.access_changed`.",
        )
        .tag("StudioOrganizations")
        .authenticated()
        .require_license_features::<License>([])
        .query_param_typed("organization_id", true, "The organization", "string")
        .json_request::<PutAccessGrantRequest>(openapi, "The grant")
        .handler(put_access_grant)
        .json_response_with_schema::<AccessGrantDto>(openapi, StatusCode::OK, "The grant as kept")
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::delete("/studio-organizations/v1/access-grants")
        .operation_id("studio_organizations.delete_access_grant")
        .summary("Take one grant away")
        .description(
            "Removes the grant naming `subject_type`/`subject_id` on `scope_type` (and \
             `scope_id` for a project), and nothing else. Who may is who may put one; an owner \
             grant is refused. 204, also when there was no such grant. Publishes \
             `tenant.access_changed`.",
        )
        .tag("StudioOrganizations")
        .authenticated()
        .require_license_features::<License>([])
        .query_param_typed("organization_id", true, "The organization", "string")
        .query_param("subject_type", true, "`member` or `team`")
        .query_param("subject_id", true, "The subject")
        .query_param("scope_type", true, "`org` or `project`")
        .query_param("scope_id", false, "The project, for a `project` grant")
        .handler(delete_access_grant)
        .no_content_response(StatusCode::NO_CONTENT, "Removed")
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::put("/studio-organizations/v1/name")
        .operation_id("studio_organizations.update_tenant_name")
        .summary("Rename an organization or a workspace")
        .description(
            "Renames the tenant through account-management as the caller (it decides who \
             may) and publishes `tenant.renamed` on the organization's channel, so every open \
             path bar shows the new name without reading again. A project is renamed in its \
             project config.",
        )
        .tag("StudioOrganizations")
        .authenticated()
        .require_license_features::<License>([])
        .query_param_typed("organization_id", false, "The organization", "string")
        .query_param_typed(
            "tenant_id",
            false,
            "A workspace instead (or the organization)",
            "string",
        )
        .json_request::<RenameTenantRequest>(openapi, "The new name")
        .handler(rename_tenant)
        .json_response_with_schema::<TenantNameDto>(openapi, StatusCode::OK, "The name as kept")
        .error_400(openapi)
        .error_401(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::delete("/studio-organizations/v1/organizations/{org_id}")
        .operation_id("studio_organizations.delete_organization")
        .summary("Delete an organization")
        .description(
            "The other end of creating one, and what the last person in an organization is \
             pointed at when they try to leave: leaving an organization nobody else is in would \
             abandon it rather than hand it over, so it is deletion that is being asked for, \
             and deletion is a separate, deliberate act (ADR-0018 §6). Its owner may, and so \
             may a platform administrator. Every membership ends and every member's personal \
             connections go with it — the tenant is removed last, because the catalogue holding \
             those connections lives inside it. Refused while the organization still has a \
             workspace or a project: work is not disposed of by answering a prompt. Answers \
             204 with no body.",
        )
        .tag("StudioOrganizations")
        .authenticated()
        .require_license_features::<License>([])
        .path_param("org_id", "Organization (tenant) id")
        .handler(delete_organization)
        .no_content_response(StatusCode::NO_CONTENT, "Deleted")
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::post("/studio-organizations/v1/organizations")
        .operation_id("studio_organizations.create_organization")
        .summary("Create an organization and own it")
        .description(
            "Anyone who can sign in may create an organization and becomes its owner \
             (ADR-0018 §2). Creating one writes three things — the tenant, the caller's owner \
             membership, and the owner grant the authorization policy reads — and there is no \
             transaction across the two systems that hold them. If a later write fails the \
             response names the organization it created; repeating the request with that \
             `organization_id` finishes it, and each write is idempotent so repeating is safe. \
             Answers 201; the new organization is listed by `GET /studio-user/v1/me/memberships`.",
        )
        .tag("StudioOrganizations")
        .authenticated()
        .require_license_features::<License>([])
        .json_request::<CreateOrganizationRequest>(openapi, "The organization to create")
        .handler(create_organization)
        .json_response_with_schema::<OrganizationDto>(
            openapi,
            StatusCode::CREATED,
            "The organization",
        )
        .error_400(openapi)
        .error_401(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::post("/studio-organizations/v1/organization-requests")
        .operation_id("studio_organizations.create_organization_request")
        .summary("Ask for an organization to own")
        .description(
            "Where the installation takes requests (`organization_creation` is `request`), a \
             person without an organization asks for one here instead of creating it, with a \
             name and a note for the platform administrator who decides (ADR-0051). One pending \
             request per person: a second is refused with `REQUEST_ALREADY_PENDING` until the \
             first is withdrawn or decided. Refused with `ORGANIZATION_LIMIT_REACHED` when the \
             person already owns as many organizations as the installation allows, and with \
             403 `REQUESTS_DISABLED` where requests are not taken. Answers 201 with the \
             request; its id is the id the organization will have.",
        )
        .tag("StudioOrganizations")
        .authenticated()
        .require_license_features::<License>([])
        .json_request::<NewOrganizationRequestDto>(openapi, "The organization asked for")
        .handler(create_organization_request)
        .json_response_with_schema::<OrganizationRequestDto>(
            openapi,
            StatusCode::CREATED,
            "The request",
        )
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::get("/studio-organizations/v1/organization-requests")
        .operation_id("studio_organizations.list_organization_requests")
        .summary("Organization requests: the caller's own, or every one for an administrator")
        .description(
            "`scope=mine` (the default) lists the caller's own requests, newest first — what \
             the no-organization screen shows as the state of an ask. `scope=all` lists every \
             request, oldest first, for a platform administrator working through them, with \
             who asked; anybody else is refused. `status=` narrows to one status. Paged with \
             `offset` and `limit`.",
        )
        .tag("StudioOrganizations")
        .authenticated()
        .require_license_features::<License>([])
        .query_param("scope", false, "`mine` (default) or `all`")
        .query_param("status", false, "pending, approved, rejected or withdrawn")
        .query_param("offset", false, "Zero-based index of the first row")
        .query_param("limit", false, "Rows per page")
        .handler(list_organization_requests)
        .json_response_with_schema::<OrganizationRequestListDto>(
            openapi,
            StatusCode::OK,
            "The requests",
        )
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router =
        OperationBuilder::post("/studio-organizations/v1/organization-requests/{id}/cancel")
            .operation_id("studio_organizations.cancel_organization_request")
            .summary("Withdraw the caller's own pending organization request")
            .description(
                "The person who asked takes it back while it is pending; it reads `withdrawn` \
             afterwards and a new request may be filed. Somebody else's request answers 404, \
             a decided one `REQUEST_NOT_PENDING`. Answers 200 with the request as it now is.",
            )
            .tag("StudioOrganizations")
            .authenticated()
            .require_license_features::<License>([])
            .path_param("id", "Organization request id")
            .handler(cancel_organization_request)
            .json_response_with_schema::<OrganizationRequestDto>(
                openapi,
                StatusCode::OK,
                "The request, withdrawn",
            )
            .error_400(openapi)
            .error_401(openapi)
            .error_404(openapi)
            .error_500(openapi)
            .register(router, openapi);

    let router =
        OperationBuilder::post("/studio-organizations/v1/organization-requests/{id}/decision")
            .operation_id("studio_organizations.decide_organization_request")
            .summary("Approve or reject an organization request")
            .description(
                "Platform administrators only. `approve` creates the organization with the \
             request's id — optionally under a corrected `name` — and makes the person who \
             asked its owner, the membership with source `request` and the owner grant \
             (ADR-0051 §4). If a step fails the request stays pending and approving again \
             finishes the same organization; approving one already approved answers it as it \
             is. `reject` closes it with a `reason` the person who asked will read. A decided \
             or withdrawn request answers `REQUEST_NOT_PENDING`. Answers 200 with the request \
             as it now is; once approved, `organization_id` is set.",
            )
            .tag("StudioOrganizations")
            .authenticated()
            .require_license_features::<License>([])
            .path_param("id", "Organization request id")
            .json_request::<OrganizationRequestDecisionDto>(openapi, "The decision")
            .handler(decide_organization_request)
            .json_response_with_schema::<OrganizationRequestDto>(
                openapi,
                StatusCode::OK,
                "The request, decided",
            )
            .error_400(openapi)
            .error_401(openapi)
            .error_403(openapi)
            .error_404(openapi)
            .error_500(openapi)
            .register(router, openapi);

    let router = OperationBuilder::get("/studio-organizations/v1/access-catalogue")
        .operation_id("studio_organizations.get_access_catalogue")
        .summary("The privileges a role may carry, and the seeded ladder")
        .description(
            "What the policy decision point understands, from the side that evaluates it. A \
             screen that edits roles needs both: the privileges to offer, and the ladder a \
             fresh organization already has.

The prototype kept its own copy of both, under \
             a comment saying they must match the backend. They did. The point is that nothing \
             made them — a privilege named where the document is WRITTEN but not where it is \
             READ goes into a role and carries nothing, silently.

Labels are deliberately \
             absent: what a privilege is called belongs to whoever draws the screen. What \
             cannot differ between them is the set of identifiers.",
        )
        .tag("StudioOrganizations")
        .authenticated()
        .require_license_features::<License>([])
        .handler(access_catalogue)
        .json_response_with_schema::<AccessCatalogueDto>(openapi, StatusCode::OK, "The catalogue")
        .error_401(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::get("/studio-organizations/v1/rollups")
        .operation_id("studio_organizations.list_rollups")
        .summary("What each workspace and project contains")
        .description(
            "One call for the whole portfolio: every workspace under the caller's tenant, \
             or under an organization in it, with the number of projects it holds, and every \
             project with what its row in a projects table shows: documents, detector findings \
             and attached repositories; its kind and brief; the short values of its \
             configuration (`attributes`), to filter by; open findings and open comments; \
             its specs, checked and failing; pull requests over the last `activity_days` days; \
             its team; and the last event the Activity feed lists. `?project_id=` narrows it to \
             one project, `?workspace_id=` to one workspace and its projects.\n\n\
             Every count is NULLABLE, and the null is the point: it means that source could \
             not be asked, which is a different fact from a count of zero -- render `-` for \
             null and the number, including a real `0`, otherwise. Counts are settled \
             independently, so one gear being unreachable costs one column rather than the \
             row.\n\n\
             This composition used to live in the portal, which spent several requests per \
             row to build it, one of them a listing that walks the tenant's whole artifact \
             graph. Here it is one request, and the next portal inherits the rules instead of \
             rewriting them.",
        )
        .tag("StudioOrganizations")
        .authenticated()
        .require_license_features::<License>([])
        .query_param("project_id", false, "Narrow the answer to this project")
        .query_param(
            "workspace_id",
            false,
            "Narrow the answer to this workspace and its projects",
        )
        .query_param_typed(
            crate::org_scope::PARAM,
            false,
            crate::org_scope::PARAM_DOC,
            "string",
        )
        .handler(list_rollups)
        .json_response_with_schema::<RollupListDto>(openapi, StatusCode::OK, "The rollups")
        .error_400(openapi)
        .error_401(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::get("/studio-organizations/v1/overview")
        .operation_id("studio_organizations.get_organization_overview")
        .summary("What an organization's leaders ask of it, over the last 30 days")
        .description(
            "One organization's state, for the people who lead it: what waits on them \
             (connections a provider refuses, spend growing against the same days last month, \
             pull requests stuck over `stuck_days`, components to decide, failed runs), spend \
             with a month-end forecast and people's own keys apart, delivery, spec health, \
             people with spend attributed to members and the idle named, the workspaces worst \
             first down to their projects, where the money goes by every grouping, and who \
             stuck pull requests wait on.\n\n\
             The rules are the server's and the answer says which it used. Money fields are \
             null unless the caller holds `cost.view` (`costs` says `hidden`); every other null \
             means its source could not be asked, never zero. Spend made by a token subject \
             no active member signs in with is `unattributed`, and IDE sessions name nobody: \
             neither is dropped. 404 when the organization is not the caller's to see or is \
             not an organization.",
        )
        .tag("StudioOrganizations")
        .authenticated()
        .require_license_features::<License>([])
        .query_param_typed(
            crate::org_scope::PARAM,
            false,
            crate::org_scope::PARAM_DOC,
            "string",
        )
        .handler(get_organization_overview)
        .json_response_with_schema::<OrganizationOverviewDto>(
            openapi,
            StatusCode::OK,
            "The overview",
        )
        .error_400(openapi)
        .error_401(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::get("/studio-organizations/v1/metrics")
        .operation_id("studio_organizations.get_organization_metrics")
        .summary("An organization's delivery, quality, money and people, over a range")
        .description(
            "The leaders' metrics board for an organization -- or, with `workspace_id` or \
             `project_id`, for one workspace or project in it -- over `range` (`7d`, `30d` \
             or `90d`, default `30d`) against the same number of days before it, bucketed \
             by day (7d) or Monday week.

             Studio's part is the spend (null unless the caller holds `cost.view`; people's \
             own keys never count), per bucket and per workspace. Insight's part is git, CI \
             and task figures for the repositories the scope's projects are made of, built \
             and aggregated on the server; `insight.state` says when there is none and why \
             (`unconfigured`, `unreachable`, `failed`, `absent`, `no_repositories`), and \
             the Studio part answers regardless. 404 when the organization is not the \
             caller's, or the workspace or project is not in it.",
        )
        .tag("StudioOrganizations")
        .authenticated()
        .require_license_features::<License>([])
        .query_param_typed(
            crate::org_scope::PARAM,
            false,
            crate::org_scope::PARAM_DOC,
            "string",
        )
        .query_param("range", false, "7d, 30d (default) or 90d")
        .query_param("workspace_id", false, "Narrow the board to this workspace")
        .query_param("project_id", false, "Narrow the board to this project")
        .handler(get_organization_metrics)
        .json_response_with_schema::<super::metrics::OrgMetricsDto>(
            openapi,
            StatusCode::OK,
            "The metrics board",
        )
        .error_400(openapi)
        .error_401(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::get("/studio-organizations/v1/project-status")
        .operation_id("studio_organizations.get_project_status")
        .summary("Where a project stands: one verdict, its reasons, and the path to a build")
        .description(
            "The project's Overview as one answer: a `verdict` — `blocked` (a refused \
             repository connection, a product that does not resolve, a failed last build or \
             deploy, an open high finding), `at_risk` (failing specs, pull requests stuck over \
             a week or with no reviewer asked) or `on_track`, with the worst signal as its \
             reason — the `signals` behind it worst first, each with where to act on it, and \
             the `path` from connecting a repository to a passing build, with the step to do \
             next. Computed from the same reads the portal made, as the caller, so it shows no \
             more than those routes would; a source that could not be read is named in \
             `unread` and never counted as nothing wrong or nothing done. 404 when the \
             project is not the caller's to see.",
        )
        .tag("StudioOrganizations")
        .authenticated()
        .require_license_features::<License>([])
        .query_param("project_id", true, "The project's tenant id")
        .handler(get_project_status)
        .json_response_with_schema::<ProjectStatusDto>(openapi, StatusCode::OK, "The status")
        .error_400(openapi)
        .error_401(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .error_503(openapi)
        .register(router, openapi);

    let router = router
        .layer(Extension(service))
        .layer(Extension(metrics))
        .layer(Extension(creation))
        .layer(Extension(sources))
        .layer(Extension(overview));
    match access {
        Some(access) => router.layer(Extension(access)),
        None => router,
    }
}
