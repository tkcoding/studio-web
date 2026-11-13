//! One grant of an organization's access config, changed on its own.
//!
//! The Team and People screens used to write the whole document
//! (`cf.studio.access.config.v1~`) on every change, so two people editing at
//! once overwrote each other. Here one grant is put or removed: the document
//! is read with its version, the grant changed, and written back on that
//! version (account-management's optimistic lock); a write that lost the race
//! reads again and retries, so the other person's change stays.
//!
//! A grant is named by who and where: `subjectType` + `subjectId` on
//! `scopeType` (+ `scopeId` for a project). Putting one replaces the role the
//! subject holds there. The owner grant is not written here: it is a
//! projection of an `owner` membership with one writer, studio-user
//! (ADR-0040 §2). The caller needs `access.manage` (or ownership); the write
//! is made as the caller, so the PDP decides again.

use account_management_sdk::{AccountManagementClient, UpsertMetadataRequest};
use anyhow::{Context, Result, anyhow, bail};
use gts::GtsTypeId;
use serde_json::{Value, json};
use toolkit_security::SecurityContext;
use uuid::Uuid;

use crate::access_config::{ACCESS_METADATA_TYPE, ROLE_OWNER};

/// What changing the access config needs (ADR-0019 §2).
pub const ACCESS_PRIVILEGE: &str = "access.manage";
const SUBJECT_TYPES: [&str; 2] = ["member", "team"];
const SCOPE_TYPES: [&str; 2] = ["org", "project"];
/// How many times a write that lost the race is tried again.
const ATTEMPTS: usize = 4;

/// Which grant: who, and where.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GrantKey {
    pub subject_type: String,
    pub subject_id: String,
    pub scope_type: String,
    /// The project, for a `project` grant; ignored for `org`.
    pub scope_id: Option<String>,
}

/// A grant to put: its key, the role, and the names a screen shows.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Grant {
    pub key: GrantKey,
    pub role_key: String,
    pub subject_name: Option<String>,
    pub scope_name: Option<String>,
}

/// Why a change is refused before anything is written.
pub fn check_key(key: &GrantKey) -> Result<(), String> {
    if !SUBJECT_TYPES.contains(&key.subject_type.as_str()) {
        return Err(format!(
            "subject_type is `member` or `team`, not `{}`",
            key.subject_type
        ));
    }
    if key.subject_id.trim().is_empty() || key.subject_id.len() > 200 {
        return Err("subject_id is 1..=200 characters".into());
    }
    if !SCOPE_TYPES.contains(&key.scope_type.as_str()) {
        return Err(format!(
            "scope_type is `org` or `project`, not `{}`",
            key.scope_type
        ));
    }
    if key.scope_type == "project"
        && key
            .scope_id
            .as_deref()
            .is_none_or(|p| Uuid::parse_str(p.trim()).is_err())
    {
        return Err("a `project` grant names its project: scope_id is its uuid".into());
    }
    Ok(())
}

fn field<'a>(grant: &'a Value, name: &str) -> Option<&'a str> {
    grant.get(name).and_then(Value::as_str)
}

/// Whether `grant` (as stored) is the one `key` names.
fn is(grant: &Value, key: &GrantKey) -> bool {
    field(grant, "subjectType") == Some(key.subject_type.as_str())
        && field(grant, "subjectId") == Some(key.subject_id.as_str())
        && field(grant, "scopeType") == Some(key.scope_type.as_str())
        && (key.scope_type == "org" || field(grant, "scopeId") == key.scope_id.as_deref())
}

fn grants(doc: &mut Value) -> Result<&mut Vec<Value>> {
    let object = doc
        .as_object_mut()
        .context("the organization's access config is not an object")?;
    object
        .entry("grants")
        .or_insert_with(|| json!([]))
        .as_array_mut()
        .context("the organization's access grants are not an array")
}

/// Put `grant` into `doc` for the organization `org`, replacing the role the
/// subject held on that scope. Refused for the owner role, for an owner grant
/// already there, and for a role the document does not define.
pub fn put(doc: &mut Value, org: Uuid, grant: &Grant) -> Result<Value, String> {
    if grant.role_key == ROLE_OWNER {
        return Err("the owner grant follows an owner membership (studio-user), not this".into());
    }
    let defined = doc
        .get("roles")
        .and_then(Value::as_array)
        .is_some_and(|roles| {
            roles
                .iter()
                .any(|r| field(r, "key") == Some(grant.role_key.as_str()))
        });
    if !defined {
        return Err(format!(
            "the organization defines no role `{}`",
            grant.role_key
        ));
    }
    let list = grants(doc).map_err(|e| e.to_string())?;
    if list
        .iter()
        .any(|g| is(g, &grant.key) && field(g, "roleKey") == Some(ROLE_OWNER))
    {
        return Err("that subject is an owner there; ownership changes with the membership".into());
    }
    let kept_id = list
        .iter()
        .find(|g| is(g, &grant.key))
        .and_then(|g| field(g, "id"))
        .map(str::to_owned);
    list.retain(|g| !is(g, &grant.key));
    let scope_id = if grant.key.scope_type == "org" {
        org.to_string()
    } else {
        grant.key.scope_id.clone().unwrap_or_default()
    };
    let written = json!({
        "id": kept_id.unwrap_or_else(|| Uuid::new_v4().to_string()),
        "subjectType": grant.key.subject_type,
        "subjectId": grant.key.subject_id,
        "subjectName": grant.subject_name.clone().unwrap_or_else(|| grant.key.subject_id.clone()),
        "roleKey": grant.role_key,
        "scopeType": grant.key.scope_type,
        "scopeId": scope_id,
        "scopeName": grant.scope_name.clone().unwrap_or_default(),
    });
    list.push(written.clone());
    Ok(written)
}

/// Remove the grant `key` names from `doc`. `Ok(false)` when there was none;
/// refused for an owner grant.
pub fn remove(doc: &mut Value, key: &GrantKey) -> Result<bool, String> {
    let list = grants(doc).map_err(|e| e.to_string())?;
    if list
        .iter()
        .any(|g| is(g, key) && field(g, "roleKey") == Some(ROLE_OWNER))
    {
        return Err("that subject is an owner there; ownership changes with the membership".into());
    }
    let before = list.len();
    list.retain(|g| !is(g, key));
    Ok(list.len() != before)
}

/// Why a change could not be made.
#[derive(Debug)]
pub enum ChangeError {
    /// 400 with this constraint.
    Invalid(String),
    /// Anything else.
    Internal(anyhow::Error),
}

impl From<anyhow::Error> for ChangeError {
    fn from(e: anyhow::Error) -> Self {
        Self::Internal(e)
    }
}

/// Read the organization's own document, change it with `change`, and write
/// it back on the version read, as `ctx`. Retried when somebody else wrote
/// in between. Returns what `change` returned.
pub async fn change<T>(
    am: &dyn AccountManagementClient,
    ctx: &SecurityContext,
    org: Uuid,
    change: &(dyn Fn(&mut Value) -> Result<T, String> + Send + Sync),
) -> Result<T, ChangeError> {
    let type_id = GtsTypeId::new(ACCESS_METADATA_TYPE);
    for _ in 0..ATTEMPTS {
        let (mut doc, version) = match am.get_metadata(ctx, org, type_id.clone()).await {
            Ok(entry) => (entry.value, entry.version),
            // No document yet: the first grant creates it.
            Err(_) => (
                json!({ "model": "tenant", "roles": crate::access_config::default_roles(), "grants": [] }),
                0,
            ),
        };
        let out = change(&mut doc).map_err(ChangeError::Invalid)?;
        let request =
            UpsertMetadataRequest::new(type_id.clone(), doc).with_expected_version(version);
        match am.upsert_metadata(ctx, org, request).await {
            Ok(_) => return Ok(out),
            Err(e) if format!("{e:?}").contains("METADATA_VERSION_MISMATCH") => continue,
            Err(e) => {
                return Err(ChangeError::Internal(anyhow!(
                    "cannot write the organization's access config: {e}"
                )));
            }
        }
    }
    Err(ChangeError::Internal(anyhow!(
        "the organization's access config kept changing under this write; try again"
    )))
}

/// The key a request names, checked.
pub fn key_of(
    subject_type: &str,
    subject_id: &str,
    scope_type: &str,
    scope_id: Option<&str>,
) -> Result<GrantKey> {
    let key = GrantKey {
        subject_type: subject_type.trim().to_owned(),
        subject_id: subject_id.trim().to_owned(),
        scope_type: scope_type.trim().to_owned(),
        scope_id: scope_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned),
    };
    if let Err(why) = check_key(&key) {
        bail!(why);
    }
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc() -> Value {
        json!({
            "model": "roles",
            "roles": crate::access_config::default_roles(),
            "grants": [
                {"id": "g1", "subjectType": "member", "subjectId": "ada", "roleKey": "owner",
                 "scopeType": "org", "scopeId": "o"},
                {"id": "g2", "subjectType": "member", "subjectId": "bob", "roleKey": "viewer",
                 "scopeType": "project", "scopeId": "11111111-1111-1111-1111-111111111111"},
                {"id": "g3", "subjectType": "member", "subjectId": "eve", "roleKey": "editor",
                 "scopeType": "org", "scopeId": "o"},
            ]
        })
    }

    fn project_key(who: &str) -> GrantKey {
        key_of(
            "member",
            who,
            "project",
            Some("11111111-1111-1111-1111-111111111111"),
        )
        .unwrap()
    }

    #[test]
    fn putting_a_grant_changes_that_one_and_keeps_the_others() {
        let mut d = doc();
        let org = Uuid::nil();
        let written = put(
            &mut d,
            org,
            &Grant {
                key: project_key("bob"),
                role_key: "editor".into(),
                subject_name: Some("Bob".into()),
                scope_name: Some("Shop".into()),
            },
        )
        .unwrap();
        assert_eq!(written["id"], "g2", "the grant keeps its id");
        let g = d["grants"].as_array().unwrap();
        assert_eq!(g.len(), 3);
        assert!(
            g.iter()
                .any(|x| x["subjectId"] == "bob" && x["roleKey"] == "editor")
        );
        assert!(
            g.iter()
                .any(|x| x["subjectId"] == "eve" && x["roleKey"] == "editor")
        );
        // A new one is added.
        put(
            &mut d,
            org,
            &Grant {
                key: project_key("cid"),
                role_key: "viewer".into(),
                subject_name: None,
                scope_name: None,
            },
        )
        .unwrap();
        assert_eq!(d["grants"].as_array().unwrap().len(), 4);
    }

    #[test]
    fn the_owner_grant_and_unknown_roles_are_refused() {
        let mut d = doc();
        let org_key = key_of("member", "ada", "org", None).unwrap();
        let grant = |role: &str, key: GrantKey| Grant {
            key,
            role_key: role.into(),
            subject_name: None,
            scope_name: None,
        };
        assert!(put(&mut d, Uuid::nil(), &grant("owner", project_key("bob"))).is_err());
        assert!(put(&mut d, Uuid::nil(), &grant("wizard", project_key("bob"))).is_err());
        assert!(put(&mut d, Uuid::nil(), &grant("viewer", org_key.clone())).is_err());
        assert!(remove(&mut d, &org_key).is_err());
        assert_eq!(d, doc(), "nothing changed");
    }

    #[test]
    fn removing_takes_only_the_named_grant() {
        let mut d = doc();
        assert!(remove(&mut d, &project_key("bob")).unwrap());
        assert!(!remove(&mut d, &project_key("bob")).unwrap());
        assert_eq!(d["grants"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn a_key_is_checked() {
        assert!(key_of("robot", "x", "org", None).is_err());
        assert!(key_of("member", "", "org", None).is_err());
        assert!(key_of("member", "x", "workspace", None).is_err());
        assert!(key_of("member", "x", "project", Some("nope")).is_err());
        assert!(key_of("team", "t", "org", None).is_ok());
    }
}
