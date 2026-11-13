//! Project lifecycle's function: a project's phase (ADR-0068 §7, the first
//! built-in kit that brings a model).
//!
//! The kit's overlay adds `phase`, `phase_owner` and `phase_since` to the
//! organization's `project` type and declares the phase lifecycle
//! (`builtin/project-lifecycle.kit.json`). Until kit functions run in
//! Studio's function runtime (ADR-0068 §9), the built-in kit's function is
//! compiled in here: it reads the project's object, and moves it only along a
//! declared transition (ADR-0067 §4) — a write the domain model makes as the
//! caller, so the PDP's `domain.edit` decides as for any object write.

use serde_json::{Value, json};
use toolkit_security::SecurityContext;
use uuid::Uuid;

use super::installed::{KitInstaller, Refusal};
use super::manifest::{builtin_manifest, overlay_of};
use super::service::now_rfc3339;
use crate::domain_model::port::{KitOverlay, is_refusal};

/// The kit this is the function of.
pub const SLUG: &str = "project-lifecycle";
/// The `failed_precondition` kind for a project whose phase is asked for or
/// set where Project lifecycle is not installed.
pub const KIT_NOT_INSTALLED: &str = "KIT_NOT_INSTALLED";
/// The `failed_precondition` kind for a move the lifecycle does not declare.
pub const NO_SUCH_TRANSITION: &str = "NO_SUCH_TRANSITION";
/// The `permission_denied` reason when the PDP refuses the project's write.
pub const DOMAIN_EDIT_REQUIRED: &str = "DOMAIN_EDIT_REQUIRED";

const FIELDS: [&str; 3] = ["phase", "phase_owner", "phase_since"];

/// The phase lifecycle the kit declares.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Lifecycle {
    pub states: Vec<String>,
    pub initial: Option<String>,
    /// `(name, from, to)`.
    pub transitions: Vec<(String, Vec<String>, String)>,
}

/// The lifecycle of `project.phase` in the compiled-in overlay.
pub fn lifecycle() -> Lifecycle {
    let overlay: KitOverlay = builtin_manifest(SLUG)
        .and_then(|m| overlay_of(&m).ok().flatten())
        .expect("project-lifecycle brings a model");
    let l = overlay
        .lifecycles
        .into_iter()
        .find(|l| l.on == "project" && l.field == "phase")
        .expect("project-lifecycle declares the phase lifecycle");
    Lifecycle {
        states: l.states,
        initial: l.initial,
        transitions: l
            .transitions
            .into_iter()
            .map(|t| (t.name, t.from, t.to))
            .collect(),
    }
}

impl Lifecycle {
    /// The moves open from `from`: `(transition, to)`. With no phase yet,
    /// any state starts it.
    pub fn next(&self, from: Option<&str>) -> Vec<(String, String)> {
        match from {
            None => self
                .states
                .iter()
                .map(|s| ("start".to_owned(), s.clone()))
                .collect(),
            Some(from) => self
                .transitions
                .iter()
                .filter(|(_, f, _)| f.iter().any(|s| s == from))
                .map(|(n, _, to)| (n.clone(), to.clone()))
                .collect(),
        }
    }

    /// Whether `from` → `to` is a move the lifecycle declares (staying is).
    pub fn allows(&self, from: Option<&str>, to: &str) -> bool {
        self.states.iter().any(|s| s == to)
            && (from == Some(to) || self.next(from).iter().any(|(_, t)| t == to))
    }
}

/// A project's phase, as a screen shows it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Phase {
    /// Project lifecycle applies to the project.
    pub installed: bool,
    pub phase: Option<String>,
    pub owner: Option<String>,
    pub since: Option<String>,
    pub states: Vec<String>,
    /// `(transition, to)` open from the current phase.
    pub next: Vec<(String, String)>,
}

fn text(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

impl KitInstaller {
    /// The caller, acting in `project`'s organization: where the model is.
    async fn org_ctx(
        &self,
        ctx: &SecurityContext,
        project: Uuid,
    ) -> Result<(Uuid, SecurityContext), Refusal> {
        let org = self.store().organization_of(ctx, project).await;
        let at = crate::org_scope::acting_in(ctx, org)
            .map_err(|e| Refusal::Internal(anyhow::anyhow!("{e}")))?;
        Ok((org, at))
    }

    /// The project's own object, whole: its instance id and payload.
    async fn project_object(
        &self,
        ctx: &SecurityContext,
        project: Uuid,
    ) -> Result<Option<(String, Value)>, Refusal> {
        let port = self
            .models()
            .ok_or_else(|| Refusal::Internal(anyhow::anyhow!("the domain model is not running")))?;
        let (rows, _) = port
            .query(
                ctx,
                json!({
                    "type": "project",
                    "project_id": project.to_string(),
                    "where": { "tenant_id": { "_eq": project.to_string() } },
                    "limit": 1,
                }),
            )
            .await
            .map_err(Refusal::Internal)?;
        Ok(rows.into_iter().next().map(|r| (r.instance_id, r.payload)))
    }

    /// `project`'s phase. The caller has been shown to reach it.
    pub async fn project_phase(
        &self,
        ctx: &SecurityContext,
        project: Uuid,
    ) -> Result<Phase, Refusal> {
        let lifecycle = lifecycle();
        if self.applies_to_project(ctx, project, SLUG).await?.is_none() {
            return Ok(Phase {
                states: lifecycle.states,
                ..Phase::default()
            });
        }
        let (org, at) = self.org_ctx(ctx, project).await?;
        // The model may not carry the kit's fields yet (a base kit is applied
        // when an organization is first read): make it.
        self.reconcile_models(org).await?;
        let object = self.project_object(&at, project).await?;
        let payload = object.map(|(_, p)| p).unwrap_or(Value::Null);
        let phase = text(&payload, "phase");
        Ok(Phase {
            installed: true,
            next: lifecycle.next(phase.as_deref()),
            owner: text(&payload, "phase_owner"),
            since: text(&payload, "phase_since"),
            phase,
            states: lifecycle.states,
        })
    }

    /// Move `project` to `phase`, along a declared transition, its owner
    /// `owner` (the caller when absent and the project had none).
    pub async fn set_project_phase(
        &self,
        ctx: &SecurityContext,
        project: Uuid,
        phase: &str,
        owner: Option<&str>,
    ) -> Result<Phase, Refusal> {
        let lifecycle = lifecycle();
        let phase = phase.trim();
        if !lifecycle.states.iter().any(|s| s == phase) {
            return Err(Refusal::Invalid(format!(
                "`{phase}` is not a phase: {}",
                lifecycle.states.join(", ")
            )));
        }
        let current = self.project_phase(ctx, project).await?;
        if !current.installed {
            return Err(Refusal::KitNotInstalled(SLUG.to_owned()));
        }
        if !lifecycle.allows(current.phase.as_deref(), phase) {
            return Err(Refusal::NoSuchTransition(format!(
                "a project moves from {} to {}, not to {phase}",
                current.phase.as_deref().unwrap_or("no phase"),
                current
                    .next
                    .iter()
                    .map(|(_, to)| to.as_str())
                    .collect::<Vec<_>>()
                    .join(" or ")
            )));
        }
        let (_, at) = self.org_ctx(ctx, project).await?;
        let mut payload = self
            .project_object(&at, project)
            .await?
            .map(|(_, p)| p)
            .filter(Value::is_object)
            .unwrap_or_else(|| json!({ "tenant_id": project.to_string() }));
        let obj = payload.as_object_mut().expect("an object, checked above");
        let moved = current.phase.as_deref() != Some(phase);
        obj.insert("phase".into(), json!(phase));
        let owner = owner
            .map(str::trim)
            .filter(|o| !o.is_empty())
            .map(str::to_owned)
            .or(current.owner.clone())
            .unwrap_or_else(|| ctx.subject_id().to_string());
        obj.insert("phase_owner".into(), json!(owner));
        if moved || current.since.is_none() {
            obj.insert("phase_since".into(), json!(now_rfc3339()?));
        }
        for key in ["_scope", "id"] {
            obj.remove(key);
        }
        let port = self
            .models()
            .ok_or_else(|| Refusal::Internal(anyhow::anyhow!("the domain model is not running")))?;
        port.upsert_in(&at, "project", "self", &project.to_string(), payload)
            .await
            .map_err(|e| {
                if is_refusal(&e) {
                    Refusal::Forbidden(DOMAIN_EDIT_REQUIRED)
                } else {
                    Refusal::Internal(e)
                }
            })?;
        self.project_phase(ctx, project).await
    }

    /// Every project of the organization `org` with a phase:
    /// `(project id, phase, owner, since)`. Empty where Project lifecycle
    /// does not apply. The caller has been shown to reach `org`.
    pub async fn project_phases(
        &self,
        ctx: &SecurityContext,
        org: Uuid,
    ) -> Result<(bool, Vec<(String, String, Option<String>, Option<String>)>), Refusal> {
        let applies = self
            .installed(ctx, org)
            .await?
            .effective
            .iter()
            .any(|k| k.kit_slug == SLUG);
        if !applies {
            return Ok((false, Vec::new()));
        }
        self.reconcile_models(org).await?;
        let Some(port) = self.models() else {
            return Ok((true, Vec::new()));
        };
        let mut fields = vec!["tenant_id"];
        fields.extend(FIELDS);
        let (rows, _) = port
            .query(
                ctx,
                json!({
                    "type": "project",
                    "where": { "phase": { "_in": lifecycle().states } },
                    "fields": fields,
                }),
            )
            .await
            .map_err(Refusal::Internal)?;
        let mut out: Vec<_> = rows
            .into_iter()
            .filter_map(|r| {
                Some((
                    text(&r.payload, "tenant_id")?,
                    text(&r.payload, "phase")?,
                    text(&r.payload, "phase_owner"),
                    text(&r.payload, "phase_since"),
                ))
            })
            .collect();
        out.sort();
        Ok((true, out))
    }
}

#[cfg(test)]
#[path = "phase_tests.rs"]
mod tests;
