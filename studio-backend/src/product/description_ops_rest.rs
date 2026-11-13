//! A product's description edited by operation, and what the product is,
//! over REST. Moved from the portal, which composed both in the browser
//! (`infra-gdl.ts`, `infra-store.ts`, `product-map.ts#productGdlLines`,
//! `product-kind.ts`), so an agent edits the product the way a person does.
//!
//! All under `/studio-product/v1`, the project in `?project_id=`:
//!
//! - `GET` / `PUT product-infra` -- the infra services as the description
//!   says them, each the catalogue's passport with the description's choice
//!   over it and the environment's side from the project's list; a save
//!   writes only what differs from the catalogue's passport as a new
//!   revision, and the whole list to the project's records.
//! - `POST product-description-edits` -- structured edits (`set_infra`,
//!   `put_infra_service`, `remove_infra_service`) applied to the latest
//!   revision's text and saved as the next revision (or only shown, with
//!   `dry_run`).
//! - `POST product-description-outlines` -- what a text (the latest
//!   revision, a revision, or one given) says: its infra services, profiles,
//!   home source, and which lines say which part of the product.
//! - `GET` / `PUT product-kind` -- the kind Studio proposes from the specs,
//!   with its reasons, and the member's confirmed choice.
//!
//! What other gears hold -- the project's infra-services list
//! (studio-environments), the catalogue's passports (the components
//! catalogue), the declared capabilities and requirements (spec-mapping) --
//! is read and written through their routes as the caller
//! (`crate::mcp::api_as`), so nothing here shows or changes more than those
//! routes would.

use axum::http::HeaderMap;
use axum::response::IntoResponse;

use super::*;
use crate::product::descriptions::{self, SOURCE_STUDIO, Saved};
use crate::product::infra_gdl::{self, UseService};
use crate::product::kind;

/// `?project_id=`, and the organization on screen, passed on to the other
/// gears' routes.
#[derive(Debug, serde::Deserialize)]
pub struct ProductOpsQuery {
    pub project_id: Uuid,
    #[serde(default)]
    pub organization_id: Option<String>,
}

impl ProductOpsQuery {
    fn query(&self, with_org: bool) -> Vec<(String, String)> {
        let mut q = vec![("project_id".to_string(), self.project_id.to_string())];
        if with_org && let Some(org) = self.organization_id.as_deref().filter(|o| !o.is_empty()) {
            q.push((crate::org_scope::PARAM.to_string(), org.to_string()));
        }
        q
    }
}

/// One `use_service(...)` call of a product's `infra`.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct UseServiceDto {
    pub name: String,
    /// The description's source the service is found in.
    pub source: String,
    pub image: Option<String>,
    pub chart: Option<String>,
    pub chart_version: Option<String>,
    /// Keys of the passport's `config` the product sets.
    pub config: std::collections::BTreeMap<String, String>,
    /// The `profile_config = {...}` argument as written, carried unread.
    pub profile_config: Option<String>,
}

fn use_service_dto(u: UseService) -> UseServiceDto {
    UseServiceDto {
        name: u.name,
        source: u.source,
        image: u.image,
        chart: u.chart,
        chart_version: u.chart_version,
        config: u.config,
        profile_config: u.profile_config_text,
    }
}

/// A product's infra services as the portal edits them.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct ProductInfraDto {
    /// Each service in the shape of `GET /studio-environments/v1/infra-services`
    /// (`passport`, `image`, `public_url`, …): the catalogue's passport with
    /// what the description chose over it, and the environment's side.
    pub items: Vec<Value>,
    /// `product-description` when the description says (or will say) the
    /// services, `project-list` for a project with no description yet.
    pub source: String,
    /// The description revision the list was read from; a save is made
    /// against it.
    pub revision: Option<i64>,
    /// The `use_service` calls as the description writes them.
    pub services: Vec<UseServiceDto>,
}

/// A save of the whole list.
#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct PutProductInfraRequest {
    /// The revision the list was read at; the latest when absent.
    pub base_revision: Option<i64>,
    /// Every service, as `GET product-infra` answers them.
    pub items: Vec<Value>,
}

/// One `use_service(...)` call to write. `source` and `profile_config`
/// default to what the description already says of the service, else the
/// product's own repository.
#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct UseServiceInput {
    pub name: String,
    pub source: Option<String>,
    pub image: Option<String>,
    pub chart: Option<String>,
    pub chart_version: Option<String>,
    #[serde(default)]
    pub config: std::collections::BTreeMap<String, String>,
    pub profile_config: Option<String>,
}

/// One edit of a product's description.
#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct DescriptionEditOp {
    /// `set_infra` (the whole `infra` list: `services`; empty takes it
    /// out), `put_infra_service` (one `service`, replacing the one of its
    /// name or added at the end) or `remove_infra_service` (by `name`).
    pub op: String,
    pub services: Option<Vec<UseServiceInput>>,
    pub service: Option<UseServiceInput>,
    pub name: Option<String>,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct DescriptionEditsRequest {
    /// The revision the edits were made against; the latest when absent.
    pub base_revision: Option<i64>,
    pub ops: Vec<DescriptionEditOp>,
    /// Answer the text the edits make without saving it.
    pub dry_run: Option<bool>,
}

/// What the edits made.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct DescriptionEditsDto {
    /// The whole `product.gdl` after the edits.
    pub text: String,
    /// The text differs from the latest revision's.
    pub changed: bool,
    /// The revision saved; absent on a dry run or when nothing changed.
    pub revision: Option<i64>,
    /// The `infra` the text now says.
    pub infra: Vec<UseServiceDto>,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct DescriptionOutlineRequest {
    /// A text to read (a draft the engine composed); else `revision`, else
    /// the latest revision.
    pub text: Option<String>,
    pub revision: Option<i64>,
}

/// One profile a description declares.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct DescribedProfileDto {
    pub id: String,
    /// The constructor: `kubernetes`, `embedded`, `self_hosted`, …
    pub kind: String,
}

/// A part of the product and the lines (1-based) that say it.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct OutlineNodeDto {
    /// `gear:<key>`, `mfe:<path>`, `shell` or `infra:postgres`.
    pub id: String,
    pub lines: Vec<u32>,
}

/// One line (1-based) and the parts it says, the first the one it is.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct OutlineLineDto {
    pub line: u32,
    pub nodes: Vec<String>,
}

/// What a `product.gdl` says.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct DescriptionOutlineDto {
    /// The revision read; absent for a given text or a project with none.
    pub revision: Option<i64>,
    /// Absent when the product says no `infra`.
    pub infra: Option<Vec<UseServiceDto>>,
    /// Absent when the product has no literal `profiles` list.
    pub profiles: Option<Vec<DescribedProfileDto>>,
    /// The source the product's own repository is (`at = path(...)`).
    pub home_source: Option<String>,
    pub nodes: Vec<OutlineNodeDto>,
    pub lines: Vec<OutlineLineDto>,
}

/// One kind a product can be.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct ProductKindInfoDto {
    /// `gear_product`, `gear_service`, `frontx_app` or `source_built`.
    pub id: String,
    pub title: String,
    pub what: String,
    pub builds: String,
}

/// The kind a member confirmed.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct ProductKindChoiceDto {
    pub kind: String,
    /// What Studio proposed when it was confirmed.
    pub proposed: Option<String>,
    pub confirmed_by: Option<String>,
    pub confirmed_at: String,
}

/// What the product is: Studio's proposal and the member's choice.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct ProductKindDto {
    /// The kind Studio proposes from the specs.
    pub proposed: String,
    /// Why, one sentence each, in the order they weigh (English).
    pub reasons: Vec<String>,
    /// `specs`, `sources` or `none` (too little to tell: the default).
    pub basis: String,
    /// The other kinds, best first.
    pub alternatives: Vec<String>,
    pub choice: Option<ProductKindChoiceDto>,
    /// A member confirmed a kind.
    pub decided: bool,
    /// The step as the project's path says it.
    pub status: String,
    /// Every kind, in the order the portal lists them.
    pub kinds: Vec<ProductKindInfoDto>,
    /// Always true: the proposal is word matches and counts.
    pub experimental: bool,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct PutProductKindRequest {
    /// `gear_product`, `gear_service`, `frontx_app` or `source_built`.
    pub kind: String,
}

/// The backend's REST API as the caller, for the other gears' routes.
fn caller_api(headers: &HeaderMap) -> ApiResult<crate::mcp::sdk::Api> {
    crate::mcp::api_as(headers.get(axum::http::header::AUTHORIZATION).cloned()).ok_or_else(|| {
        CanonicalError::service_unavailable()
            .with_detail("studio-mcp is not running here, so the other gears cannot be read")
            .create()
    })
}

fn upstream(what: &str, e: &crate::mcp::sdk::ToolError) -> CanonicalError {
    CanonicalError::service_unavailable()
        .with_detail(format!("{what}: {}", e.0))
        .create()
}

fn items_of(v: &Value, key: &str) -> Vec<Value> {
    v.get(key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

/// The project's infra-services list (studio-environments), as the caller.
async fn read_records(api: &crate::mcp::sdk::Api, q: &ProductOpsQuery) -> ApiResult<Vec<Value>> {
    api.get("/studio-environments/v1/infra-services", &q.query(false))
        .await
        .map(|v| items_of(&v, "items"))
        .map_err(|e| upstream("the project's infra services could not be read", &e))
}

/// The catalogue's infra passports for the project, as the caller; none when
/// the catalogue cannot be read (the portal read it the same way).
async fn read_offered(api: &crate::mcp::sdk::Api, q: &ProductOpsQuery) -> Vec<Value> {
    match api
        .get("/studio-components-catalog/v1/components", &q.query(true))
        .await
    {
        Ok(v) => infra_gdl::offered_infra(&items_of(&v, "nodes")),
        Err(_) => Vec::new(),
    }
}

async fn read_latest(
    product: &Product,
    ctx: &SecurityContext,
    project: Uuid,
) -> ApiResult<Option<descriptions::Revision>> {
    product
        .service
        .latest_description(ctx, project)
        .await
        .map_err(|e| descriptions_rest::internal(&e))
}

async fn infra_answer(
    product: &Product,
    ctx: &SecurityContext,
    api: &crate::mcp::sdk::Api,
    q: &ProductOpsQuery,
) -> ApiResult<ProductInfraDto> {
    let (latest, records, offered) = tokio::join!(
        read_latest(product, ctx, q.project_id),
        read_records(api, q),
        read_offered(api, q)
    );
    let (latest, records) = (latest?, records?);
    let Some(latest) = latest else {
        return Ok(ProductInfraDto {
            items: records,
            source: "project-list".to_string(),
            revision: None,
            services: Vec::new(),
        });
    };
    let chosen = infra_gdl::read_infra(&latest.text);
    // Not in the description yet: the project's list is shown, and the
    // first save writes it there.
    let items = match &chosen {
        None => records,
        Some(list) => list
            .iter()
            .map(|u| infra_gdl::service_of(u, &offered, &records))
            .collect(),
    };
    Ok(ProductInfraDto {
        items,
        source: "product-description".to_string(),
        revision: Some(latest.revision),
        services: chosen
            .unwrap_or_default()
            .into_iter()
            .map(use_service_dto)
            .collect(),
    })
}

fn not_editable(e: &infra_gdl::NotEditable) -> CanonicalError {
    StudioProductError::invalid_argument()
        .with_constraint(format!("the description cannot be edited here: {e}"))
        .create()
}

async fn get_product_infra(
    OrgCtx(ctx): OrgCtx,
    Extension(product): Extension<Product>,
    headers: HeaderMap,
    Query(q): Query<ProductOpsQuery>,
) -> ApiResult<JsonBody<ProductInfraDto>> {
    product.require_descriptions()?;
    let api = caller_api(&headers)?;
    Ok(Json(infra_answer(&product, &ctx, &api, &q).await?))
}

async fn put_product_infra(
    OrgCtx(ctx): OrgCtx,
    Extension(product): Extension<Product>,
    headers: HeaderMap,
    Query(q): Query<ProductOpsQuery>,
    Json(body): Json<PutProductInfraRequest>,
) -> ApiResult<Response> {
    product.require_descriptions()?;
    let api = caller_api(&headers)?;
    if let Some(latest) = read_latest(&product, &ctx, q.project_id).await? {
        let offered = read_offered(&api, &q).await;
        let text = infra_gdl::infra_text_for(&latest.text, &body.items, &offered)
            .map_err(|e| not_editable(&e))?;
        if text != latest.text {
            let base = body.base_revision.unwrap_or(latest.revision);
            let saved = product
                .service
                .save_description(&ctx, q.project_id, Some(base), &text, SOURCE_STUDIO, None)
                .await
                .map_err(|e| descriptions_rest::internal(&e))?;
            if let Saved::Stale(latest) = saved {
                return Ok(descriptions_rest::conflict_response(
                    Some(base),
                    latest,
                    text,
                ));
            }
        }
    }
    // The environment's side -- its copy of the image, a ready chart's
    // values, the public address -- stays in the project's list.
    api.put(
        "/studio-environments/v1/infra-services",
        &q.query(false),
        &serde_json::json!({ "items": body.items }),
    )
    .await
    .map_err(|e| upstream("the project's infra services could not be written", &e))?;
    Ok(axum::Json(infra_answer(&product, &ctx, &api, &q).await?).into_response())
}

fn use_service_from(input: UseServiceInput, was: Option<&UseService>, home: &str) -> UseService {
    UseService {
        source: input
            .source
            .filter(|s| !s.trim().is_empty())
            .or_else(|| was.map(|w| w.source.clone()))
            .unwrap_or_else(|| home.to_string()),
        image: input.image.filter(|s| !s.is_empty()),
        chart: input.chart.filter(|s| !s.is_empty()),
        chart_version: input.chart_version.filter(|s| !s.is_empty()),
        config: input.config,
        profile_config_text: input
            .profile_config
            .or_else(|| was.and_then(|w| w.profile_config_text.clone())),
        name: input.name.trim().to_string(),
    }
}

/// `text` with `ops` applied, in order.
pub fn apply_edits(text: &str, ops: Vec<DescriptionEditOp>) -> Result<String, String> {
    let home = infra_gdl::home_source(text).unwrap_or_default();
    let mut list = infra_gdl::read_infra(text).unwrap_or_default();
    let mut touched = false;
    for (i, op) in ops.into_iter().enumerate() {
        let find = |list: &[UseService], name: &str| list.iter().position(|u| u.name == name);
        match op.op.as_str() {
            "set_infra" => {
                let services = op
                    .services
                    .ok_or_else(|| format!("ops[{i}]: set_infra takes `services`"))?;
                let was = list.clone();
                list = services
                    .into_iter()
                    .map(|s| {
                        let prior = find(&was, s.name.trim()).map(|at| &was[at]);
                        use_service_from(s, prior, &home)
                    })
                    .collect();
            }
            "put_infra_service" => {
                let s = op
                    .service
                    .ok_or_else(|| format!("ops[{i}]: put_infra_service takes `service`"))?;
                let name = s.name.trim().to_string();
                match find(&list, &name) {
                    Some(at) => {
                        let next = use_service_from(s, Some(&list[at]), &home);
                        list[at] = next;
                    }
                    None => list.push(use_service_from(s, None, &home)),
                }
            }
            "remove_infra_service" => {
                let name = op
                    .name
                    .ok_or_else(|| format!("ops[{i}]: remove_infra_service takes `name`"))?;
                let at = find(&list, name.trim()).ok_or_else(|| {
                    format!("ops[{i}]: the product has no infra service `{name}`")
                })?;
                list.remove(at);
            }
            other => {
                return Err(format!(
                    "ops[{i}]: `{other}` is not an edit (set_infra, put_infra_service, remove_infra_service)"
                ));
            }
        }
        touched = true;
    }
    if let Some(empty) = list.iter().position(|u| u.name.is_empty()) {
        return Err(format!("infra service {empty} has no name"));
    }
    if !touched {
        return Ok(text.to_string());
    }
    infra_gdl::write_infra(text, &list).map_err(|e| e.to_string())
}

async fn post_description_edits(
    OrgCtx(ctx): OrgCtx,
    Extension(product): Extension<Product>,
    Query(q): Query<ProductOpsQuery>,
    Json(body): Json<DescriptionEditsRequest>,
) -> ApiResult<Response> {
    product.require_descriptions()?;
    let latest = read_latest(&product, &ctx, q.project_id)
        .await?
        .ok_or_else(|| {
            StudioProductError::invalid_argument()
                .with_constraint(
                    "the project has no description yet: save its first revision (the Product \
                 page's Save, or POST product-description-revisions) before editing it",
                )
                .create()
        })?;
    let text = apply_edits(&latest.text, body.ops).map_err(|why| {
        StudioProductError::invalid_argument()
            .with_constraint(why)
            .create()
    })?;
    let changed = text != latest.text;
    let infra = infra_gdl::read_infra(&text)
        .unwrap_or_default()
        .into_iter()
        .map(use_service_dto)
        .collect();
    let mut revision = None;
    if changed && !body.dry_run.unwrap_or(false) {
        let base = body.base_revision.unwrap_or(latest.revision);
        descriptions::checked_text(&text).map_err(|why| {
            StudioProductError::invalid_argument()
                .with_constraint(why)
                .create()
        })?;
        match product
            .service
            .save_description(&ctx, q.project_id, Some(base), &text, SOURCE_STUDIO, None)
            .await
            .map_err(|e| descriptions_rest::internal(&e))?
        {
            Saved::Created(r) | Saved::Unchanged(r) => revision = Some(r.revision),
            Saved::Stale(latest) => {
                return Ok(descriptions_rest::conflict_response(
                    Some(base),
                    latest,
                    text,
                ));
            }
        }
    }
    Ok(axum::Json(DescriptionEditsDto {
        text,
        changed,
        revision,
        infra,
    })
    .into_response())
}

fn outline(text: &str, revision: Option<i64>) -> DescriptionOutlineDto {
    let lines = infra_gdl::node_lines(text);
    let count = |n: usize| u32::try_from(n).unwrap_or(u32::MAX);
    DescriptionOutlineDto {
        revision,
        infra: infra_gdl::read_infra(text).map(|l| l.into_iter().map(use_service_dto).collect()),
        profiles: infra_gdl::read_profiles(text).map(|l| {
            l.into_iter()
                .map(|p| DescribedProfileDto {
                    id: p.id,
                    kind: p.kind,
                })
                .collect()
        }),
        home_source: infra_gdl::home_source(text),
        nodes: infra_gdl::lines_by_node(&lines)
            .into_iter()
            .map(|(id, at)| OutlineNodeDto {
                id,
                lines: at.into_iter().map(count).collect(),
            })
            .collect(),
        lines: lines
            .into_iter()
            .map(|(n, nodes)| OutlineLineDto {
                line: count(n),
                nodes,
            })
            .collect(),
    }
}

async fn post_description_outline(
    OrgCtx(ctx): OrgCtx,
    Extension(product): Extension<Product>,
    Query(q): Query<ProductOpsQuery>,
    Json(body): Json<DescriptionOutlineRequest>,
) -> ApiResult<JsonBody<DescriptionOutlineDto>> {
    product.require_descriptions()?;
    if let Some(text) = body.text {
        descriptions::checked_text(&text).map_err(|why| {
            StudioProductError::invalid_argument()
                .with_constraint(why)
                .create()
        })?;
        return Ok(Json(outline(&text, None)));
    }
    let revision = match body.revision {
        Some(n) => product
            .service
            .description_revision(&ctx, q.project_id, n)
            .await
            .map_err(|e| descriptions_rest::internal(&e))?
            .ok_or_else(|| {
                StudioProductError::not_found(format!(
                    "the project's description has no revision {n}"
                ))
                .with_resource(format!("{}/description/{n}", q.project_id))
                .create()
            })
            .map(Some)?,
        None => read_latest(&product, &ctx, q.project_id).await?,
    };
    Ok(Json(match revision {
        Some(r) => outline(&r.text, Some(r.revision)),
        None => outline("", None),
    }))
}

/* ── what the product is ── */

const GEAR_TYPE: &str = "gts.cf.studio.catalog.gear.v1~";
const FRONTX_TYPE: &str = "gts.cf.studio.catalog.frontx.v1~";
const SERVICE_TYPE: &str = "gts.cf.studio.catalog.service.v1~";

/// What the proposal reads, each read on its own as the caller; a failed
/// one is `None` and named in the reasons.
async fn kind_facts(
    product: &Product,
    ctx: &SecurityContext,
    api: &crate::mcp::sdk::Api,
    q: &ProductOpsQuery,
) -> (Option<Value>, kind::Facts) {
    let with_org = q.query(true);
    let project = q.project_id.to_string();
    let (config, caps, reqs, comps, record) = tokio::join!(
        product.service.project_config(ctx, q.project_id),
        api.get("/studio-spec-mapping/v1/capabilities", &with_org),
        api.get("/studio-spec-mapping/v1/requirements", &with_org),
        api.get("/studio-components-catalog/v1/components", &with_org),
        product.service.get_project_product(ctx, &project),
    );
    let capabilities = caps.ok().map(|v| {
        items_of(&v, "items")
            .iter()
            .map(|c| kind::Capability {
                key: c
                    .get("key")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                from: kind::titles(
                    items_of(c, "sources")
                        .iter()
                        .filter_map(|s| s.get("label").and_then(Value::as_str))
                        .map(str::to_string),
                ),
            })
            .collect()
    });
    let requirements = reqs.ok().map(|v| {
        items_of(&v, "items")
            .iter()
            .filter_map(|r| r.get("text").and_then(Value::as_str))
            .map(str::to_string)
            .collect()
    });
    let own = comps.ok().map(|v| {
        let nodes = items_of(&v, "nodes");
        let own: Vec<&Value> = nodes
            .iter()
            .filter(|n| n.pointer("/value/tier").and_then(Value::as_str) == Some("project"))
            .collect();
        let of = |t: &str| {
            own.iter()
                .filter(|n| n.get("type_id").and_then(Value::as_str) == Some(t))
                .count()
        };
        kind::Own {
            gears: of(GEAR_TYPE),
            frontx: of(FRONTX_TYPE),
            services: of(SERVICE_TYPE),
        }
    });
    let product_now = record.ok().map(|node| {
        let value = node.map(|n| n.value).unwrap_or(Value::Null);
        kind::Configured {
            gears: value
                .get("gears")
                .and_then(Value::as_array)
                .map_or(0, Vec::len),
            frontend: value.get("frontend").is_some_and(|f| !f.is_null()),
        }
    });
    let brief = config
        .as_ref()
        .and_then(|c| c.get("brief"))
        .and_then(Value::as_str)
        .map(str::to_string);
    (
        config,
        kind::Facts {
            brief,
            capabilities,
            requirements,
            own,
            product: product_now,
        },
    )
}

fn kind_answer(config: Option<&Value>, facts: &kind::Facts) -> ProductKindDto {
    let proposal = kind::propose(facts);
    let choice = kind::read_choice(config.and_then(|c| c.get("product_kind")));
    let (decided, status) = kind::status(choice.as_ref(), Some(&proposal));
    ProductKindDto {
        proposed: proposal.kind.as_str().to_string(),
        reasons: proposal.reasons,
        basis: proposal.basis.as_str().to_string(),
        alternatives: proposal
            .alternatives
            .iter()
            .map(|k| k.as_str().to_string())
            .collect(),
        choice: choice.map(|c| ProductKindChoiceDto {
            kind: c.kind.as_str().to_string(),
            proposed: c.proposed.map(|k| k.as_str().to_string()),
            confirmed_by: c.confirmed_by,
            confirmed_at: c.confirmed_at,
        }),
        decided,
        status,
        kinds: kind::KINDS
            .into_iter()
            .map(|k| ProductKindInfoDto {
                id: k.as_str().to_string(),
                title: k.title().to_string(),
                what: k.what().to_string(),
                builds: k.builds().to_string(),
            })
            .collect(),
        experimental: true,
    }
}

async fn get_product_kind(
    OrgCtx(ctx): OrgCtx,
    Extension(product): Extension<Product>,
    headers: HeaderMap,
    Query(q): Query<ProductOpsQuery>,
) -> ApiResult<JsonBody<ProductKindDto>> {
    let api = caller_api(&headers)?;
    let (config, facts) = kind_facts(&product, &ctx, &api, &q).await;
    Ok(Json(kind_answer(config.as_ref(), &facts)))
}

async fn put_product_kind(
    OrgCtx(ctx): OrgCtx,
    Extension(product): Extension<Product>,
    headers: HeaderMap,
    Query(q): Query<ProductOpsQuery>,
    Json(body): Json<PutProductKindRequest>,
) -> ApiResult<JsonBody<ProductKindDto>> {
    let chosen = kind::Kind::parse(body.kind.trim()).ok_or_else(|| {
        StudioProductError::invalid_argument()
            .with_field_violation(
                "kind",
                "must be gear_product, gear_service, frontx_app or source_built".to_owned(),
                "INVALID",
            )
            .create()
    })?;
    let api = caller_api(&headers)?;
    let (_, facts) = kind_facts(&product, &ctx, &api, &q).await;
    let proposed = kind::propose(&facts).kind;
    let now = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default();
    let choice = kind::Choice {
        kind: chosen,
        proposed: Some(proposed),
        confirmed_by: Some(ctx.subject_id().to_string()),
        confirmed_at: now,
    };
    let value = kind::choice_value(&choice);
    product
        .service
        .update_project_config(&ctx, q.project_id, |config| {
            if !config.is_object() {
                *config = Value::Object(serde_json::Map::new());
            }
            if let Some(map) = config.as_object_mut() {
                map.insert("product_kind".to_string(), value.clone());
            }
            true
        })
        .await
        .map_err(|e| descriptions_rest::internal(&e))?;
    let (config, facts) = kind_facts(&product, &ctx, &api, &q).await;
    Ok(Json(kind_answer(config.as_ref(), &facts)))
}

pub fn register(router: Router, openapi: &dyn OpenApiRegistry) -> Router {
    let router = OperationBuilder::get("/studio-product/v1/product-infra")
        .operation_id("studio_product.get_product_infra")
        .summary("A product's infra services, as its description says them")
        .description(
            "Each service the latest description's `infra = [use_service(...)]` names, as the \
             catalogue's passport with the description's choice over it and the environment's \
             side (its copy of the image, a ready chart, the public address) from \
             `GET /studio-environments/v1/infra-services`; `services` are the calls as written. \
             A project with no description yet answers its infra-services list \
             (`source: project-list`); a description that says no `infra` yet answers the list \
             too, and the first save writes it there. The other gears are read as the caller.",
        )
        .tag("StudioProduct")
        .authenticated()
        .require_license_features::<License>([])
        .query_param("project_id", true, "The project")
        .query_param(crate::org_scope::PARAM, false, crate::org_scope::PARAM_DOC)
        .handler(get_product_infra)
        .json_response_with_schema::<ProductInfraDto>(openapi, StatusCode::OK, "The services")
        .error_400(openapi)
        .error_401(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .error_503(openapi)
        .register(router, openapi);

    let router = OperationBuilder::put("/studio-product/v1/product-infra")
        .operation_id("studio_product.update_product_infra")
        .summary("Save a product's infra services: the description, and the project's list")
        .description(
            "The whole list, as `GET product-infra` answers it. Each service is written into \
             the description as `use_service(...)` saying only what differs from the \
             catalogue's passport (so a passport's later default reaches the product), keeping \
             the source and `profile_config` the description said; a changed text is saved as \
             the next revision against `base_revision` (409 with both texts when that is not \
             the latest). The whole list is then written to \
             `PUT /studio-environments/v1/infra-services` as the caller. Answers as \
             `GET product-infra`.",
        )
        .tag("StudioProduct")
        .authenticated()
        .require_license_features::<License>([])
        .query_param("project_id", true, "The project")
        .query_param(crate::org_scope::PARAM, false, crate::org_scope::PARAM_DOC)
        .handler(put_product_infra)
        .json_request::<PutProductInfraRequest>(openapi, "The services")
        .json_response_with_schema::<ProductInfraDto>(openapi, StatusCode::OK, "What was kept")
        .json_response_with_schema::<descriptions_rest::ProductDescriptionConflictDto>(
            openapi,
            StatusCode::CONFLICT,
            "The description changed since `base_revision`",
        )
        .error_400(openapi)
        .error_401(openapi)
        .error_500(openapi)
        .error_503(openapi)
        .register(router, openapi);

    let router = OperationBuilder::post("/studio-product/v1/product-description-edits")
        .operation_id("studio_product.create_product_description_edit")
        .summary("Edit a product's description by operation and save the next revision")
        .description(
            "Applies `ops` in order to the latest revision's text and saves the result as the \
             next revision against `base_revision` (409 with both texts when that is not the \
             latest); `dry_run` answers the text without saving. Operations: `set_infra` (the \
             whole `infra` list; empty takes the argument out), `put_infra_service` (one \
             service, replacing the one of its name or added at the end) and \
             `remove_infra_service` (by name). A service's `source` and `profile_config` \
             default to what the description already says of it, else the product's own \
             repository. The rest of the text, its comments among it, is kept byte for byte. \
             The engine's verdict on the result is `POST product-description-checks`.",
        )
        .tag("StudioProduct")
        .authenticated()
        .require_license_features::<License>([])
        .query_param("project_id", true, "The project")
        .query_param(crate::org_scope::PARAM, false, crate::org_scope::PARAM_DOC)
        .handler(post_description_edits)
        .json_request::<DescriptionEditsRequest>(openapi, "The edits")
        .json_response_with_schema::<DescriptionEditsDto>(openapi, StatusCode::OK, "What they made")
        .json_response_with_schema::<descriptions_rest::ProductDescriptionConflictDto>(
            openapi,
            StatusCode::CONFLICT,
            "The description changed since `base_revision`",
        )
        .error_400(openapi)
        .error_401(openapi)
        .error_500(openapi)
        .error_503(openapi)
        .register(router, openapi);

    let router = OperationBuilder::post("/studio-product/v1/product-description-outlines")
        .operation_id("studio_product.analyze_product_description")
        .summary("What a product description says: infra, profiles, and which lines say what")
        .description(
            "Reads `text` when given (a draft the engine composed), else `revision`, else the \
             latest revision: its `infra` services, the profiles it declares, the source its own \
             repository is, and which lines (1-based) say which part of the product -- a gear \
             (`gear:<key>`, a plugin on its host's line), a micro-frontend (`mfe:<path>`), the \
             shell (`shell`) and the profiles' Postgres (`infra:postgres`). Nothing is saved.",
        )
        .tag("StudioProduct")
        .authenticated()
        .require_license_features::<License>([])
        .query_param("project_id", true, "The project")
        .query_param(crate::org_scope::PARAM, false, crate::org_scope::PARAM_DOC)
        .handler(post_description_outline)
        .json_request::<DescriptionOutlineRequest>(openapi, "What to read")
        .json_response_with_schema::<DescriptionOutlineDto>(openapi, StatusCode::OK, "What it says")
        .error_400(openapi)
        .error_401(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .error_503(openapi)
        .register(router, openapi);

    let router = OperationBuilder::get("/studio-product/v1/product-kind")
        .operation_id("studio_product.get_product_kind")
        .summary("What the product is: Studio's proposal from the specs, and the choice")
        .description(
            "Experimental: the kind the project's specs point to (`gear_product`, \
             `gear_service`, `frontx_app`, `source_built`), from word matches and counts over \
             its brief, the capabilities and requirements its documents declare \
             (studio-spec-mapping), the components its own repositories hold (their passports) \
             and the product as configured, with one English sentence per reason and what \
             could not be read; and the kind a member confirmed (`project.config` \
             `product_kind`). The other gears are read as the caller.",
        )
        .tag("StudioProduct")
        .authenticated()
        .require_license_features::<License>([])
        .query_param("project_id", true, "The project")
        .query_param(crate::org_scope::PARAM, false, crate::org_scope::PARAM_DOC)
        .handler(get_product_kind)
        .json_response_with_schema::<ProductKindDto>(openapi, StatusCode::OK, "The kind")
        .error_401(openapi)
        .error_500(openapi)
        .error_503(openapi)
        .register(router, openapi);

    OperationBuilder::put("/studio-product/v1/product-kind")
        .operation_id("studio_product.confirm_product_kind")
        .summary("Confirm what the product is")
        .description(
            "Keeps `kind` in the project's configuration as `product_kind`, with what Studio \
             proposed at that moment, who confirmed it and when; written as the caller. \
             Answers as `GET product-kind`.",
        )
        .tag("StudioProduct")
        .authenticated()
        .require_license_features::<License>([])
        .query_param("project_id", true, "The project")
        .query_param(crate::org_scope::PARAM, false, crate::org_scope::PARAM_DOC)
        .handler(put_product_kind)
        .json_request::<PutProductKindRequest>(openapi, "The kind")
        .json_response_with_schema::<ProductKindDto>(openapi, StatusCode::OK, "The kind")
        .error_400(openapi)
        .error_401(openapi)
        .error_500(openapi)
        .error_503(openapi)
        .register(router, openapi)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRODUCT: &str = "product(\n    id = \"shop\",\n    sources = [source(id = \"shop\", at = path(\".\"))],\n    gears = [],\n)\n";

    fn op(json: serde_json::Value) -> DescriptionEditOp {
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn a_service_put_into_a_description_comes_from_its_own_repository() {
        let text = apply_edits(
            PRODUCT,
            vec![op(serde_json::json!({ "op": "put_infra_service",
                "service": { "name": "keycloak", "image": "quay.io/keycloak/keycloak:26" } }))],
        )
        .unwrap();
        assert!(text.contains(
            r#"use_service("keycloak", source = "shop", image = "quay.io/keycloak/keycloak:26")"#
        ));
        let again = apply_edits(
            &text,
            vec![op(
                serde_json::json!({ "op": "remove_infra_service", "name": "keycloak" }),
            )],
        )
        .unwrap();
        assert_eq!(again, PRODUCT);
    }

    #[test]
    fn an_edit_keeps_the_source_the_description_said() {
        let text = PRODUCT.replace(
            "gears = []",
            "infra = [\n        use_service(\"pg\", source = \"infra-repo\", profile_config = {\"dev\": {}}),\n    ],\n    gears = []",
        );
        let next = apply_edits(
            &text,
            vec![op(serde_json::json!({ "op": "put_infra_service",
                "service": { "name": "pg", "config": { "MAX": "10" } } }))],
        )
        .unwrap();
        assert!(next.contains(
            r#"use_service("pg", source = "infra-repo", config = {"MAX": "10"}, profile_config = {"dev": {}})"#
        ));
    }

    #[test]
    fn an_unknown_edit_or_a_missing_service_is_refused_with_its_place() {
        let err =
            apply_edits(PRODUCT, vec![op(serde_json::json!({ "op": "rename" }))]).unwrap_err();
        assert!(err.starts_with("ops[0]"), "{err}");
        let err = apply_edits(
            PRODUCT,
            vec![op(
                serde_json::json!({ "op": "remove_infra_service", "name": "x" }),
            )],
        )
        .unwrap_err();
        assert!(err.contains("no infra service `x`"), "{err}");
    }

    #[test]
    fn an_outline_names_each_part_and_its_lines() {
        let o = outline(PRODUCT, Some(3));
        assert_eq!(o.revision, Some(3));
        assert_eq!(o.home_source.as_deref(), Some("shop"));
        assert!(o.infra.is_none());
        assert!(o.nodes.is_empty());
    }
}
