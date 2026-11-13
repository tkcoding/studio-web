//! Which domain objects a caller may read or write (ADR-0035).
//!
//! The gear is a policy enforcement point for one resource,
//! [`DOMAIN_OBJECT_RESOURCE`]: it asks the PDP once per action per request and
//! applies the answer to every object it is about to return or touch. The
//! answer is a set of constraints on `owner_tenant_id`, and an object's owner is
//! its project when it has one (`_scope` holding a tenant id) and the
//! organization otherwise.
//!
//! Graph-storage cannot do this: its node resource carries only the tenant,
//! and every domain object lives in the organization's tenant. So the tenant
//! arm is already enforced there, and what this adds is the refusal (no
//! privilege) and the project narrowing.
//!
//! Evaluation fails closed. A filter this does not understand, a property it
//! does not send, or a project whose place in the tenant tree cannot be read
//! all exclude the object rather than admit it.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use authz_resolver_sdk::pep::{AccessRequest, EnforcerError, PolicyEnforcer, ResourceType};
use serde_json::Value;
use toolkit_security::{AccessScope, ScopeFilter, SecurityContext, pep_properties};
use uuid::Uuid;

use super::store::ObjectNode;

/// The PDP resource a domain object is (ADR-0035 §3). `read` maps to
/// `domain.view`, `write` to `domain.edit`.
pub const DOMAIN_OBJECT_RESOURCE: &str = "gts.cf.studio.domain.object.v1~";

pub const READ: &str = "read";
pub const WRITE: &str = "write";

/// Why a caller may not proceed. Carried through `anyhow` and told apart at
/// the REST edge, so a refusal is a 403 and an outage a 503, never a 500.
#[derive(Debug)]
pub enum AccessError {
    /// The PDP refused: no grant carries the privilege.
    Denied,
    /// The PDP could not be asked. Under the roles model that is not a yes.
    Unavailable(String),
    /// The type's objects are a gear's records: only that gear writes them.
    Held(String),
    /// The kit that brought the type is gone: its objects stay, read-only
    /// (ADR-0070 §4).
    Dormant { entity: String, kit: String },
    /// The type is dormant and the caller does not administer the model: for
    /// them the kit's type is not installed.
    NotInstalled { entity: String, kit: String },
}

impl std::fmt::Display for AccessError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Denied => f.write_str("not permitted on domain objects"),
            Self::Unavailable(m) => write!(f, "authorization unavailable: {m}"),
            Self::Held(m) => write!(f, "{m}: change it through that gear"),
            Self::Dormant { entity, kit } => write!(
                f,
                "`{entity}` was left by kit `{kit}`, which is not installed: its objects are kept read-only; install the kit again to change them"
            ),
            Self::NotInstalled { entity, kit } => write!(
                f,
                "`{entity}` comes with kit `{kit}`, which is not installed in this organization"
            ),
        }
    }
}

impl std::error::Error for AccessError {}

/// The `AccessError` an error carries, if it is one.
pub fn access_error(e: &anyhow::Error) -> Option<&AccessError> {
    e.downcast_ref::<AccessError>()
}

/// Asks the PDP what a caller may do with domain objects.
#[async_trait]
pub trait ObjectPolicy: Send + Sync {
    /// What `ctx` may touch for `action`. `entity` names the type the request is
    /// about, sent so a policy can grow per-entity rules without the gear
    /// changing (ADR-0035 §4).
    async fn access(
        &self,
        ctx: &SecurityContext,
        action: &str,
        entity: Option<&str>,
    ) -> Result<Access, AccessError>;
}

/// Every object in the caller's tenant: the behaviour before ADR-0035, and
/// what a build without a PDP (the in-memory store, the tests) runs.
pub struct TenantOnly;

#[async_trait]
impl ObjectPolicy for TenantOnly {
    async fn access(
        &self,
        ctx: &SecurityContext,
        _action: &str,
        _entity: Option<&str>,
    ) -> Result<Access, AccessError> {
        Ok(Access::new(ctx, AccessScope::allow_all(), None))
    }
}

/// A gear acting as itself — a `service` subject minted in this process,
/// which carries no bearer token — keeps its own records (ADR-0066 §8a): it
/// has already decided who may change them, as it did when they were
/// account-management rows only it wrote, so its reads and writes are
/// tenant-scoped only. Every other caller is asked of `inner`. A token from
/// outside always carries its bearer, so no request can pass as a gear.
pub struct GearsKeepTheirOwn(pub Arc<dyn ObjectPolicy>);

pub(crate) fn is_gear_itself(ctx: &SecurityContext) -> bool {
    ctx.subject_type() == Some("service") && ctx.bearer_token().is_none()
}

#[async_trait]
impl ObjectPolicy for GearsKeepTheirOwn {
    async fn access(
        &self,
        ctx: &SecurityContext,
        action: &str,
        entity: Option<&str>,
    ) -> Result<Access, AccessError> {
        if is_gear_itself(ctx) {
            return TenantOnly.access(ctx, action, entity).await;
        }
        self.0.access(ctx, action, entity).await
    }
}

/// Where a tenant sits in the tree: its parent, if any.
#[async_trait]
pub trait TenantParents: Send + Sync {
    async fn parent_of(&self, ctx: &SecurityContext, tenant: Uuid) -> Option<Uuid>;
}

/// How long a tenant chain read for one caller answers its later requests.
/// The tree changes when a project is created or moved, rarely; a project
/// moved under another parent shows within this.
const CHAIN_KEPT_FOR: Duration = Duration::from_secs(45);

/// The most chains kept at once; past it the oldest goes.
const CHAINS_KEPT_MAX: usize = 4096;

/// Tenant chains read across requests (#1041). A cold project screen asks
/// for objects of some 25 owners in each of several concurrent requests, and
/// each request walked every owner's chain through account-management again.
///
/// Only the ancestry is kept, never a PDP answer: every request still asks
/// the PDP and applies its constraints to the chain. Keyed by the caller
/// (subject and its tenant) as well as the owner, because a parent is read
/// with the caller's context and a tenant the caller cannot read ends its
/// chain: one caller's reading is never another's answer. A chain that found
/// no parent at all is not kept: that may be a failed read, which only
/// excludes, and it is asked again next request rather than excluding for the
/// whole time a chain is kept.
#[derive(Debug, Default)]
pub struct TenantChains {
    kept: Mutex<HashMap<ChainKey, KeptChain>>,
}

/// The caller's subject, the caller's tenant, and the owner tenant.
type ChainKey = (Uuid, Uuid, Uuid);
/// When the chain was read, and the owner's ancestry it found.
type KeptChain = (Instant, Vec<Uuid>);

impl TenantChains {
    fn key(ctx: &SecurityContext, tenant: Uuid) -> (Uuid, Uuid, Uuid) {
        (ctx.subject_id(), ctx.subject_tenant_id(), tenant)
    }

    fn get(&self, ctx: &SecurityContext, tenant: Uuid) -> Option<Vec<Uuid>> {
        let kept = self.kept.lock().ok()?;
        kept.get(&Self::key(ctx, tenant))
            .filter(|(at, _)| at.elapsed() < CHAIN_KEPT_FOR)
            .map(|(_, chain)| chain.clone())
    }

    fn put(&self, ctx: &SecurityContext, tenant: Uuid, chain: &[Uuid]) {
        if chain.len() < 2 {
            return;
        }
        let Ok(mut kept) = self.kept.lock() else {
            return;
        };
        let key = Self::key(ctx, tenant);
        if kept.len() >= CHAINS_KEPT_MAX && !kept.contains_key(&key) {
            kept.retain(|_, (at, _)| at.elapsed() < CHAIN_KEPT_FOR);
            let oldest = (kept.len() >= CHAINS_KEPT_MAX)
                .then(|| kept.iter().min_by_key(|(_, (at, _))| *at).map(|(k, _)| *k))
                .flatten();
            if let Some(oldest) = oldest {
                kept.remove(&oldest);
            }
        }
        kept.insert(key, (Instant::now(), chain.to_vec()));
    }
}

/// The PDP-backed policy.
pub struct PdpPolicy {
    enforcer: PolicyEnforcer,
    tenants: Arc<dyn TenantParents>,
    /// Tenant chains shared by this policy's requests, for a while.
    chains: Arc<TenantChains>,
}

impl PdpPolicy {
    pub fn new(enforcer: PolicyEnforcer, tenants: Arc<dyn TenantParents>) -> Self {
        Self {
            enforcer,
            tenants,
            chains: Arc::new(TenantChains::default()),
        }
    }
}

/// Properties the constraints may name: the owner, and the subtree arm over it.
static OBJECT_PROPERTIES: &[&str] = &[pep_properties::OWNER_TENANT_ID];

#[async_trait]
impl ObjectPolicy for PdpPolicy {
    async fn access(
        &self,
        ctx: &SecurityContext,
        action: &str,
        entity: Option<&str>,
    ) -> Result<Access, AccessError> {
        let resource = ResourceType::new(DOMAIN_OBJECT_RESOURCE, OBJECT_PROPERTIES);
        let mut request = AccessRequest::new()
            .resource_property(pep_properties::OWNER_TENANT_ID, ctx.subject_tenant_id())
            .require_constraints(true);
        if let Some(entity) = entity {
            request = request.resource_property("entity", entity.to_string());
        }
        let scope = self
            .enforcer
            .access_scope_with(ctx, &resource, action, None, &request)
            .await
            .map_err(|e| match e {
                EnforcerError::Denied { .. } | EnforcerError::CompileFailed(_) => {
                    AccessError::Denied
                }
                EnforcerError::EvaluationFailed(m) => AccessError::Unavailable(m.to_string()),
            })?;
        if scope.is_deny_all() {
            return Err(AccessError::Denied);
        }
        let access = Access::new(ctx, scope, Some(self.tenants.clone()));
        Ok(access.sharing_chains(self.chains.clone()))
    }
}

/// What one caller may touch for one action, for the rest of a request.
pub struct Access {
    scope: AccessScope,
    org: Uuid,
    tenants: Option<Arc<dyn TenantParents>>,
    /// Each tenant's chain to the root, itself first, read once per request.
    chains: Mutex<HashMap<Uuid, Vec<Uuid>>>,
    /// Chains read by this caller's earlier requests, when the policy keeps
    /// them ([`TenantChains`]).
    shared: Option<Arc<TenantChains>>,
}

impl Access {
    pub(super) fn new(
        ctx: &SecurityContext,
        scope: AccessScope,
        tenants: Option<Arc<dyn TenantParents>>,
    ) -> Self {
        Self {
            scope,
            org: ctx.subject_tenant_id(),
            tenants,
            chains: Mutex::new(HashMap::new()),
            shared: None,
        }
    }

    /// Read and keep tenant chains in `shared` as well, across requests.
    #[must_use]
    pub(super) fn sharing_chains(mut self, shared: Arc<TenantChains>) -> Self {
        self.shared = Some(shared);
        self
    }

    /// The tenant an object belongs to for authorization: its project when
    /// `_scope` names one, the organization otherwise. A free-form scope from
    /// before ADR-0035 is organization-wide: it loses nothing it had, and gains
    /// no project narrowing.
    pub fn owner_of(&self, value: &Value) -> Uuid {
        self.owner_of_scope(value.get("_scope").and_then(Value::as_str))
    }

    /// [`Self::owner_of`] for an object not written yet.
    pub fn owner_of_scope(&self, scope: Option<&str>) -> Uuid {
        scope
            .and_then(|s| Uuid::parse_str(s.trim()).ok())
            .unwrap_or(self.org)
    }

    /// Everything in the tenant, with nothing to narrow: the common answer,
    /// and one that needs no tenant reads.
    pub fn is_unconstrained(&self) -> bool {
        self.scope.is_unconstrained()
    }

    /// May the caller touch an object owned by `owner`?
    pub async fn admits_owner(&self, ctx: &SecurityContext, owner: Uuid) -> bool {
        if self.is_unconstrained() {
            return true;
        }
        if self.scope.is_deny_all() {
            return false;
        }
        let chain = self.chain(ctx, owner).await;
        self.scope
            .constraints()
            .iter()
            .any(|c| c.filters().iter().all(|f| admits(f, owner, &chain)))
    }

    pub async fn admits(&self, ctx: &SecurityContext, node: &ObjectNode) -> bool {
        self.admits_owner(ctx, self.owner_of(&node.value)).await
    }

    /// The objects the caller may see, in their order.
    pub async fn retain(&self, ctx: &SecurityContext, nodes: Vec<ObjectNode>) -> Vec<ObjectNode> {
        if self.is_unconstrained() {
            return nodes;
        }
        let mut out = Vec::with_capacity(nodes.len());
        for n in nodes {
            if self.admits(ctx, &n).await {
                out.push(n);
            }
        }
        out
    }

    /// `tenant` and its ancestors, nearest first. Bounded, because a cycle in
    /// the tree is a fault and not a reason to hang; an unreadable parent
    /// ends the chain, which can only exclude.
    async fn chain(&self, ctx: &SecurityContext, tenant: Uuid) -> Vec<Uuid> {
        if let Ok(chains) = self.chains.lock()
            && let Some(c) = chains.get(&tenant)
        {
            return c.clone();
        }
        if let Some(c) = self.shared.as_ref().and_then(|s| s.get(ctx, tenant)) {
            if let Ok(mut chains) = self.chains.lock() {
                chains.insert(tenant, c.clone());
            }
            return c;
        }
        let mut chain = vec![tenant];
        if let Some(tenants) = &self.tenants {
            let mut at = tenant;
            for _ in 0..8 {
                match tenants.parent_of(ctx, at).await {
                    Some(p) if !chain.contains(&p) => {
                        chain.push(p);
                        at = p;
                    }
                    _ => break,
                }
            }
        }
        if let Some(shared) = &self.shared {
            shared.put(ctx, tenant, &chain);
        }
        if let Ok(mut chains) = self.chains.lock() {
            chains.insert(tenant, chain.clone());
        }
        chain
    }
}

/// One filter against one object, failing closed on anything not understood.
fn admits(f: &ScopeFilter, owner: Uuid, chain: &[Uuid]) -> bool {
    if f.property() != pep_properties::OWNER_TENANT_ID {
        return false;
    }
    match f {
        ScopeFilter::Eq(e) => e.value().as_uuid() == Some(owner),
        ScopeFilter::In(i) => i.values().iter().any(|v| v.as_uuid() == Some(owner)),
        ScopeFilter::InTenantSubtree(t) => {
            // A status narrowing is a question about the tenant's row this
            // cannot answer here; excluding is the safe half.
            t.descendant_status().is_empty()
                && t.root_tenant_id()
                    .as_uuid()
                    .is_some_and(|root| chain.contains(&root))
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use toolkit_security::{ScopeConstraint, ScopeValue};

    const ORG: Uuid = Uuid::from_u128(0x0a);
    const P1: Uuid = Uuid::from_u128(0x01);
    const P2: Uuid = Uuid::from_u128(0x02);
    const ELSEWHERE: Uuid = Uuid::from_u128(0xee);

    struct Tree;
    #[async_trait]
    impl TenantParents for Tree {
        async fn parent_of(&self, _ctx: &SecurityContext, t: Uuid) -> Option<Uuid> {
            (t == P1 || t == P2).then_some(ORG)
        }
    }

    fn ctx() -> SecurityContext {
        SecurityContext::builder()
            .subject_id(Uuid::from_u128(1))
            .subject_tenant_id(ORG)
            .build()
            .unwrap()
    }

    fn access(scope: AccessScope) -> Access {
        Access::new(&ctx(), scope, Some(Arc::new(Tree)))
    }

    fn object(scope: Option<Uuid>) -> ObjectNode {
        let value = match scope {
            Some(s) => json!({ "name": "x", "_scope": s.to_string() }),
            None => json!({ "name": "x" }),
        };
        ObjectNode {
            type_id: "t".into(),
            instance_id: "i".into(),
            value,
        }
    }

    fn subtree(root: Uuid) -> ScopeFilter {
        ScopeFilter::InTenantSubtree(toolkit_security::InTenantSubtreeScopeFilter::new(
            pep_properties::OWNER_TENANT_ID,
            ScopeValue::Uuid(root),
        ))
    }

    fn owner_in(ids: &[Uuid]) -> ScopeFilter {
        ScopeFilter::in_uuids(pep_properties::OWNER_TENANT_ID, ids.to_vec())
    }

    #[tokio::test]
    async fn the_clamp_admits_the_organization_and_its_projects() {
        // What the PDP answers on the tenant model, with hierarchy declared.
        let a = access(AccessScope::from_constraints(vec![
            ScopeConstraint::new(vec![owner_in(&[ORG])]),
            ScopeConstraint::new(vec![subtree(ORG)]),
        ]));
        assert!(a.admits(&ctx(), &object(None)).await);
        assert!(a.admits(&ctx(), &object(Some(P1))).await);
        assert!(
            !a.admits(&ctx(), &object(Some(ELSEWHERE))).await,
            "outside the tree"
        );
    }

    #[tokio::test]
    async fn a_project_grant_admits_its_projects_and_nothing_organization_wide() {
        // The narrowed answer: every branch of the clamp ANDed with the projects.
        let a = access(AccessScope::from_constraints(vec![
            ScopeConstraint::new(vec![owner_in(&[ORG]), owner_in(&[P1])]),
            ScopeConstraint::new(vec![subtree(ORG), owner_in(&[P1])]),
        ]));
        assert!(a.admits(&ctx(), &object(Some(P1))).await);
        assert!(
            !a.admits(&ctx(), &object(Some(P2))).await,
            "another project"
        );
        assert!(
            !a.admits(&ctx(), &object(None)).await,
            "organization-wide needs an org grant"
        );
    }

    #[tokio::test]
    async fn a_free_form_scope_is_organization_wide() {
        let a = access(AccessScope::from_constraints(vec![ScopeConstraint::new(
            vec![owner_in(&[ORG])],
        )]));
        let mut legacy = object(None);
        legacy.value["_scope"] = json!("workspace-7");
        assert!(a.admits(&ctx(), &legacy).await);
    }

    #[tokio::test]
    async fn a_filter_on_another_property_excludes() {
        let a = access(AccessScope::from_constraints(vec![ScopeConstraint::new(
            vec![ScopeFilter::eq(
                "owner_id",
                ScopeValue::Uuid(Uuid::from_u128(9)),
            )],
        )]));
        assert!(!a.admits(&ctx(), &object(None)).await);
    }

    /// [`Tree`], counting the parents it is asked for.
    #[derive(Default)]
    struct CountingTree(std::sync::atomic::AtomicUsize);
    #[async_trait]
    impl TenantParents for CountingTree {
        async fn parent_of(&self, ctx: &SecurityContext, t: Uuid) -> Option<Uuid> {
            self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Tree.parent_of(ctx, t).await
        }
    }

    impl CountingTree {
        fn asked(&self) -> usize {
            self.0.load(std::sync::atomic::Ordering::SeqCst)
        }
    }

    fn ctx_of(subject: u128) -> SecurityContext {
        SecurityContext::builder()
            .subject_id(Uuid::from_u128(subject))
            .subject_tenant_id(ORG)
            .build()
            .unwrap()
    }

    fn org_subtree() -> AccessScope {
        AccessScope::from_constraints(vec![ScopeConstraint::new(vec![subtree(ORG)])])
    }

    #[tokio::test]
    async fn a_chain_is_read_once_across_requests_of_one_caller() {
        let tree = Arc::new(CountingTree::default());
        let shared = Arc::new(TenantChains::default());
        for _ in 0..5 {
            let a = Access::new(&ctx(), org_subtree(), Some(tree.clone()))
                .sharing_chains(shared.clone());
            assert!(a.admits(&ctx(), &object(Some(P1))).await);
        }
        // P1's parent, then ORG's (none): two reads, by the first request.
        assert_eq!(tree.asked(), 2);
    }

    #[tokio::test]
    async fn another_caller_reads_its_own_chain() {
        let tree = Arc::new(CountingTree::default());
        let shared = Arc::new(TenantChains::default());
        for subject in [1, 2] {
            let caller = ctx_of(subject);
            let a = Access::new(&caller, org_subtree(), Some(tree.clone()))
                .sharing_chains(shared.clone());
            assert!(a.admits(&caller, &object(Some(P1))).await);
        }
        assert_eq!(tree.asked(), 4);
    }

    #[tokio::test]
    async fn a_chain_without_a_parent_is_asked_again() {
        // No parent may be a root or a failed read: it is not kept.
        let tree = Arc::new(CountingTree::default());
        let shared = Arc::new(TenantChains::default());
        for _ in 0..3 {
            let a = Access::new(&ctx(), org_subtree(), Some(tree.clone()))
                .sharing_chains(shared.clone());
            assert!(!a.admits(&ctx(), &object(Some(ELSEWHERE))).await);
        }
        assert_eq!(tree.asked(), 3);
    }

    #[tokio::test]
    async fn only_the_chain_is_kept_never_the_pdp_answer() {
        // A grant that shrank between two requests refuses at once, though
        // the owner's chain is kept.
        let tree = Arc::new(CountingTree::default());
        let shared = Arc::new(TenantChains::default());
        let wide =
            Access::new(&ctx(), org_subtree(), Some(tree.clone())).sharing_chains(shared.clone());
        assert!(wide.admits(&ctx(), &object(Some(P1))).await);
        let narrow = Access::new(
            &ctx(),
            AccessScope::from_constraints(vec![ScopeConstraint::new(vec![
                subtree(ORG),
                owner_in(&[P2]),
            ])]),
            Some(tree.clone()),
        )
        .sharing_chains(shared);
        assert!(!narrow.admits(&ctx(), &object(Some(P1))).await);
        assert!(narrow.admits(&ctx(), &object(Some(P2))).await);
    }

    #[tokio::test]
    async fn allow_all_needs_no_tree() {
        let a = Access::new(&ctx(), AccessScope::allow_all(), None);
        assert!(a.admits(&ctx(), &object(Some(ELSEWHERE))).await);
    }
}
