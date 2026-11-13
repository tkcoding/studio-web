//! The presence surface: say you are here, see who else is, leave them a note.
//!
//! Four operations, and the caller is always resolved from the security
//! context — never from the body. A client that could name whose presence it
//! was reporting could report anybody's.

use std::sync::Arc;

use axum::{Extension, Router};
use toolkit::api::canonical_prelude::*;
use toolkit::api::operation_builder::{CORE_GLOBAL_BASE_LICENSE_FEATURE, LicenseFeature};
use toolkit::api::{OpenApiRegistry, OperationBuilder};
use toolkit_canonical_errors::resource_error;
use toolkit_security::SecurityContext;

use super::registry::{
    HEARTBEAT_MS, MAX_MESSAGE, Message, ONLINE_TTL_MS, Presence, PresenceRegistry, clean_label,
};

#[resource_error(gts_id!("cf.studio._.presence.v1~"))]
pub struct PresenceError;

struct License;
impl AsRef<str> for License {
    fn as_ref(&self) -> &'static str {
        CORE_GLOBAL_BASE_LICENSE_FEATURE
    }
}
impl LicenseFeature for License {}

/// Somebody in Studio, as an administrator sees them.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct PresenceDto {
    pub user_id: String,
    pub display_name: Option<String>,
    /// The tenant they are looking at.
    pub tenant_id: String,
    /// A short label the portal chose: `projects`, `specs`, `sources`, …
    pub place: String,
    /// What exactly, when the portal knows — a project name, a document title.
    pub detail: Option<String>,
    /// When they arrived, in epoch millis. Reset by a restart of this process,
    /// which is why the field says "since" and not "connected at".
    pub since_ms: i64,
    pub last_seen_ms: i64,
}

impl From<Presence> for PresenceDto {
    fn from(p: Presence) -> Self {
        Self {
            user_id: p.user_id,
            display_name: p.display_name,
            tenant_id: p.tenant_id,
            place: p.place,
            detail: p.detail,
            since_ms: p.since_ms,
            last_seen_ms: p.last_seen_ms,
        }
    }
}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct OnlineListDto {
    pub items: Vec<PresenceDto>,
    /// Always equal to `items.len()`: presence is not paged, and cannot be.
    ///
    /// The list is everybody who is here *now*, and a second page would
    /// describe a moment that has already passed by the time it is asked for.
    /// The field is here because a caller reading list envelopes should not
    /// have to know which ones page and which do not — seeing `total` match
    /// the items is how it learns there is nothing more.
    pub total: u32,
    /// How long a heartbeat counts for, so a client can show "last seen" with
    /// the same threshold the server judged by instead of inventing one.
    pub online_ttl_ms: i64,
    /// How often the server expects to hear from a client.
    pub heartbeat_ms: i64,
}

/// A note waiting for the caller.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct PresenceNoteDto {
    pub id: String,
    pub from_user_id: String,
    pub from_display_name: Option<String>,
    pub text: String,
    pub sent_ms: i64,
}

impl From<Message> for PresenceNoteDto {
    fn from(m: Message) -> Self {
        Self {
            id: m.id,
            from_user_id: m.from_user_id,
            from_display_name: m.from_display_name,
            text: m.text,
            sent_ms: m.sent_ms,
        }
    }
}

#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct HeartbeatRequest {
    /// What to call this person in the list.
    ///
    /// Supplied by the client rather than joined from the identity gear: this
    /// gear holds no database and resolving a name per heartbeat would make a
    /// 30-second poll into a query. The **user id is authoritative** — it comes
    /// from the token — and the name is a label beside it, so a client that
    /// sends a misleading one misleads nobody about who is actually there.
    pub display_name: Option<String>,
    /// Where the person is, in the portal's own words. Omitted is fine — it
    /// then reads simply as "in Studio".
    pub place: Option<String>,
    /// What exactly, when there is something to say.
    pub detail: Option<String>,
}

/// The heartbeat's answer: your own record, and anything left for you.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct HeartbeatDto {
    pub me: PresenceDto,
    /// Notes addressed to the caller, taken off the queue by this call. They
    /// are handed over once: a client that drops them has lost them, which is
    /// the trade for not keeping a mailbox nobody asked for.
    pub messages: Vec<PresenceNoteDto>,
    /// How many people are in Studio right now, the caller included.
    pub online: u32,
}

/// Named for this gear rather than for the verb: `studio-connector` already
/// has a `SendMessageRequest`, and the OpenAPI registry names a schema by its
/// Rust type, so two of them collide at boot. It panics rather than silently
/// serving one definition under both names, which is the right failure and is
/// how this was found.
#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct SendNoteRequest {
    pub to_user_id: String,
    pub text: String,
    /// What to show the recipient as the sender. As on the heartbeat, the id
    /// is authoritative and this is the label beside it.
    pub from_display_name: Option<String>,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct SendNoteDto {
    /// False when the recipient is not in Studio. The note is not queued for
    /// later — see the endpoint's description — so this is the one thing the
    /// sender has to read.
    pub delivered: bool,
    /// How many notes are now waiting for them, when they are there.
    pub waiting: u32,
}

#[derive(Clone)]
struct Registry(Arc<PresenceRegistry>);

/// Who may read the whole list: studio-user's answer to "is this person a
/// platform administrator". `None` when studio-user is not in this deployment,
/// and then nobody may -- the list names everybody in every organization.
#[derive(Clone)]
pub struct Admins(pub Option<Arc<dyn crate::user_profile::OrganizationReader>>);

/// The reason a caller who is not a platform administrator is refused the
/// list with (403), for the screen to say so.
pub const PLATFORM_ADMIN_REQUIRED: &str = "PLATFORM_ADMIN_REQUIRED";

/// The list is every person in Studio, across organizations, with where they
/// are: a platform administrator's to read (#1044). Membership of the platform
/// root, asked of studio-user -- the same one rule every platform route uses.
async fn require_platform_admin(ctx: &SecurityContext, admins: &Admins) -> ApiResult<()> {
    let admin = match admins.0.as_deref() {
        Some(reader) => reader
            .is_platform_admin(&ctx.subject_id().to_string())
            .await
            .unwrap_or(false),
        None => false,
    };
    if admin {
        Ok(())
    } else {
        Err(PresenceError::permission_denied()
            .with_reason(PLATFORM_ADMIN_REQUIRED)
            .create())
    }
}

fn invalid(why: &str) -> CanonicalError {
    PresenceError::invalid_argument()
        .with_constraint(why.to_owned())
        .create()
}

fn now_ms() -> i64 {
    time::OffsetDateTime::now_utc().unix_timestamp_nanos() as i64 / 1_000_000
}

/// Who the caller is. The token's subject and nothing else — a client that
/// could name whose presence it was reporting could report anybody's.
fn caller(ctx: &SecurityContext) -> String {
    ctx.subject_id().to_string()
}

async fn heartbeat(
    Extension(ctx): Extension<SecurityContext>,
    Extension(registry): Extension<Registry>,
    Json(req): Json<HeartbeatRequest>,
) -> ApiResult<JsonBody<HeartbeatDto>> {
    let user_id = caller(&ctx);
    let display_name = req.display_name.as_deref().and_then(clean_label);
    let now = now_ms();
    let me = registry.0.beat(
        &user_id,
        display_name,
        &ctx.subject_tenant_id().to_string(),
        req.place.as_deref().and_then(clean_label),
        req.detail.as_deref().and_then(clean_label),
        now,
    );
    Ok(Json(HeartbeatDto {
        me: me.into(),
        messages: registry
            .0
            .drain(&user_id)
            .into_iter()
            .map(PresenceNoteDto::from)
            .collect(),
        online: registry.0.online(now).len() as u32,
    }))
}

async fn sign_out(
    Extension(ctx): Extension<SecurityContext>,
    Extension(registry): Extension<Registry>,
) -> ApiResult<StatusCode> {
    // Nothing to report: who is left online is `GET /online`, and a DELETE
    // answers 204 (docs/api-conventions.md). Forgetting somebody who already
    // lapsed is the same success, so a retried sign-out is not an error.
    registry.0.forget(&caller(&ctx));
    Ok(StatusCode::NO_CONTENT)
}

fn online_list(registry: &Registry) -> OnlineListDto {
    let items: Vec<PresenceDto> = registry
        .0
        .online(now_ms())
        .into_iter()
        .map(PresenceDto::from)
        .collect();
    OnlineListDto {
        total: items.len() as u32,
        items,
        online_ttl_ms: ONLINE_TTL_MS,
        heartbeat_ms: HEARTBEAT_MS,
    }
}

async fn list_online(
    Extension(ctx): Extension<SecurityContext>,
    Extension(registry): Extension<Registry>,
    Extension(admins): Extension<Admins>,
) -> ApiResult<JsonBody<OnlineListDto>> {
    require_platform_admin(&ctx, &admins).await?;
    Ok(Json(online_list(&registry)))
}

async fn send_message(
    Extension(ctx): Extension<SecurityContext>,
    Extension(registry): Extension<Registry>,
    Json(req): Json<SendNoteRequest>,
) -> ApiResult<JsonBody<SendNoteDto>> {
    let text = req.text.trim();
    if text.is_empty() {
        return Err(invalid("a message needs some text"));
    }
    if text.chars().count() > MAX_MESSAGE {
        return Err(invalid(&format!(
            "a message is at most {MAX_MESSAGE} characters"
        )));
    }
    let to = req.to_user_id.trim();
    if to.is_empty() {
        return Err(invalid("a message needs a recipient"));
    }
    let from_user_id = caller(&ctx);
    let from_display_name = req.from_display_name.as_deref().and_then(clean_label);

    let now = now_ms();
    // Checked as it is posted, and reported either way. A note to somebody who
    // is not there is not queued — so the sender has to be told, rather than
    // left believing it arrived.
    let message = Message {
        id: uuid::Uuid::new_v4().to_string(),
        from_user_id,
        from_display_name,
        text: text.to_owned(),
        sent_ms: now,
    };
    Ok(Json(match registry.0.post_if_online(to, message, now) {
        Some(waiting) => SendNoteDto {
            delivered: true,
            waiting: waiting as u32,
        },
        None => SendNoteDto {
            delivered: false,
            waiting: 0,
        },
    }))
}

pub fn register_routes(
    router: Router,
    openapi: &dyn OpenApiRegistry,
    registry: Arc<PresenceRegistry>,
    admins: Admins,
) -> Router {
    let registry = Registry(registry);

    let router = OperationBuilder::post("/studio-presence/v1/me")
        .operation_id("studio_presence.update_my_presence")
        .summary("Say the caller is still in Studio, and collect anything left for them")
        .description(
            "One call does both, because a client that has to be here anyway to \
             report presence should not need a second request to find out it was \
             written to. Messages are handed over once and taken off the queue.",
        )
        .tag("StudioPresence")
        .authenticated()
        .require_license_features::<License>([])
        .json_request::<HeartbeatRequest>(openapi, "Where the caller is")
        .handler(heartbeat)
        .json_response_with_schema::<HeartbeatDto>(
            openapi,
            StatusCode::OK,
            "The caller's presence and their messages",
        )
        .error_401(openapi)
        .error_500(openapi)
        .register(router, openapi)
        .layer(Extension(registry.clone()));

    let router = OperationBuilder::delete("/studio-presence/v1/me")
        .operation_id("studio_presence.delete_my_presence")
        .summary("Leave: drop the caller's presence without waiting for it to lapse")
        .description(
            "For a deliberate sign-out. Without it a person shows as online for \
             up to the heartbeat window after closing the tab, which is correct \
             but slow. Their undelivered messages go too: a note written to \
             somebody who then left was written to the person who was there. \
             Answers 204 with no body, also when the caller had already lapsed; \
             `GET /online` says who is left.",
        )
        .tag("StudioPresence")
        .authenticated()
        .require_license_features::<License>([])
        .handler(sign_out)
        .no_content_response(StatusCode::NO_CONTENT, "Left")
        .error_401(openapi)
        .error_500(openapi)
        .register(router, openapi)
        .layer(Extension(registry.clone()));

    let router = OperationBuilder::get("/studio-presence/v1/online")
        .operation_id("studio_presence.list_online")
        .summary("Who is in Studio right now, and where")
        .description(
            "Everybody whose client reported in within the online window, most \
             recently seen first. The window and the heartbeat interval come \
             back with the list so a client shows 'last seen' against the same \
             threshold the server judged by. State is per-process: a restart \
             empties this until each client's next heartbeat. A platform \
             administrator's: anybody else is refused 403 `PLATFORM_ADMIN_REQUIRED`.",
        )
        .tag("StudioPresence")
        .authenticated()
        .require_license_features::<License>([])
        .handler(list_online)
        .json_response_with_schema::<OnlineListDto>(
            openapi,
            StatusCode::OK,
            "Everybody currently in Studio",
        )
        .error_401(openapi)
        .error_403(openapi)
        .error_500(openapi)
        .register(router, openapi)
        .layer(Extension(registry.clone()))
        .layer(Extension(admins));

    OperationBuilder::post("/studio-presence/v1/messages")
        .operation_id("studio_presence.send_message")
        .summary("Leave a note for somebody who is in Studio now")
        .description(
            "Delivered on the recipient's next heartbeat, so within the \
             heartbeat interval. NOT queued for later: a recipient who is not \
             online gets `delivered: false` and nothing is stored, because a \
             note that arrives tomorrow arrives out of the context it was \
             written in. Use a notification connector for anything that has to \
             survive the session.",
        )
        .tag("StudioPresence")
        .authenticated()
        .require_license_features::<License>([])
        .json_request::<SendNoteRequest>(openapi, "Who to write to, and what")
        .handler(send_message)
        .json_response_with_schema::<SendNoteDto>(
            openapi,
            StatusCode::OK,
            "Whether it reached anybody",
        )
        .error_400(openapi)
        .error_401(openapi)
        .error_500(openapi)
        .register(router, openapi)
        .layer(Extension(registry))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::response::IntoResponse;

    const ADMIN: u128 = 1;

    struct Reader;

    #[async_trait::async_trait]
    impl crate::user_profile::OrganizationReader for Reader {
        async fn organizations_of(&self, _: &str) -> anyhow::Result<Vec<uuid::Uuid>> {
            Ok(Vec::new())
        }
        async fn grant_keys_of(&self, subject: &str) -> anyhow::Result<Vec<String>> {
            Ok(vec![subject.to_owned()])
        }
        async fn is_platform_admin(&self, subject: &str) -> anyhow::Result<bool> {
            Ok(subject == uuid::Uuid::from_u128(ADMIN).to_string())
        }
        async fn memberships_of_subject(
            &self,
            _: &str,
        ) -> anyhow::Result<Vec<crate::user_profile::SubjectMembership>> {
            Ok(Vec::new())
        }
        fn membership_generation(&self) -> u64 {
            0
        }
    }

    fn caller(id: u128) -> SecurityContext {
        SecurityContext::builder()
            .subject_id(uuid::Uuid::from_u128(id))
            .subject_tenant_id(uuid::Uuid::from_u128(0x0a))
            .build()
            .unwrap()
    }

    fn registry() -> Registry {
        let registry = Arc::new(PresenceRegistry::default());
        registry.beat("someone", None, "t", None, None, now_ms());
        Registry(registry)
    }

    async fn list(id: u128, admins: Admins) -> ApiResult<JsonBody<OnlineListDto>> {
        list_online(
            Extension(caller(id)),
            Extension(registry()),
            Extension(admins),
        )
        .await
    }

    #[tokio::test]
    async fn a_platform_administrator_reads_who_is_online() {
        let Json(list) = list(ADMIN, Admins(Some(Arc::new(Reader))))
            .await
            .expect("an administrator reads it");
        assert_eq!(list.total, 1);
    }

    #[tokio::test]
    async fn anybody_else_is_refused_with_the_reason() {
        let refused = list(7, Admins(Some(Arc::new(Reader))))
            .await
            .expect_err("refused");
        let response = refused.into_response();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert!(
            String::from_utf8_lossy(&body).contains(PLATFORM_ADMIN_REQUIRED),
            "the screen reads the reason"
        );
    }

    #[tokio::test]
    async fn without_studio_user_nobody_reads_it() {
        assert!(list(ADMIN, Admins(None)).await.is_err());
    }
}
