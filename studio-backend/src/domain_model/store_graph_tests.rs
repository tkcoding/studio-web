//! The domain store against graph-storage itself: the real service and its
//! in-process client over the gear's in-memory store (`test-support`), not a
//! fake of the client. What is checked is what only the gear can say — that a
//! type registered before `_scope` was an index path takes it on an update,
//! that the projection then admits the filter, and that a type which cannot
//! take it still answers by walking.

#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::sync::Arc;

use async_trait::async_trait;
use authz_resolver_sdk::api::AuthZResolverApi;
use authz_resolver_sdk::constraints::{Constraint, InPredicate, Predicate};
use authz_resolver_sdk::models::{
    EvaluationRequest, EvaluationResponse, EvaluationResponseContext,
};
use authz_resolver_sdk::pep::PolicyEnforcer;
use graph_storage::config::{GraphStorageConfig, ValidatedConfig};
use graph_storage::domain::embedding::{EmbeddingCoordinator, SpaceState};
use graph_storage::domain::local_client::GraphStorageLocalClient;
use graph_storage::domain::service::GraphServices;
use graph_storage::infra::embedding::fake::FakeEmbeddingProvider;
use graph_storage::infra::fake_store::{FakeGraphEngine, FakeGraphStore};
use graph_storage_sdk::GraphStorageClientV1;
use graph_storage_sdk::models::TypeRegistration;
use serde_json::{Value, json};
use toolkit_canonical_errors::CanonicalError;
use toolkit_security::{PlatformSecurityContext, SecurityContext, pep_properties};
use uuid::Uuid;

use super::gts;
use super::ontology::NodeType;
use super::store::{DomainStore, GraphStorageBackend, NodeUpsert};

/// Admits everything, in the caller's own tenant — the posture the gear is
/// deployed under: the policy decides who may call, the scope what they see.
struct AllowInOwnTenant;

#[async_trait]
impl AuthZResolverApi for AllowInOwnTenant {
    async fn evaluate(
        &self,
        _ctx: PlatformSecurityContext,
        request: EvaluationRequest,
    ) -> Result<EvaluationResponse, CanonicalError> {
        let tenant = request
            .subject
            .properties
            .get("tenant_id")
            .and_then(Value::as_str)
            .and_then(|raw| Uuid::parse_str(raw).ok())
            .unwrap_or_else(Uuid::nil);
        Ok(EvaluationResponse {
            decision: true,
            context: EvaluationResponseContext {
                constraints: vec![Constraint {
                    predicates: vec![Predicate::In(InPredicate::new(
                        pep_properties::OWNER_TENANT_ID,
                        [tenant],
                    ))],
                }],
                deny_reason: None,
            },
        })
    }
}

/// The gear's service over its in-memory store, and the client every Studio
/// gear holds, in process.
fn client() -> Arc<dyn GraphStorageClientV1> {
    let store = Arc::new(FakeGraphStore::new());
    let engine = Arc::new(FakeGraphEngine::new(Arc::clone(&store)));
    let embedding = EmbeddingCoordinator::new(
        Arc::new(FakeEmbeddingProvider::new(384)),
        SpaceState::Active { epoch: 1 },
        8 * 1024,
    );
    let services = GraphServices::new(
        ValidatedConfig::unchecked(GraphStorageConfig::default()),
        store,
        engine,
        PolicyEnforcer::new(Arc::new(AllowInOwnTenant)),
        embedding,
    );
    Arc::new(GraphStorageLocalClient::new(Arc::new(services)))
}

fn ctx(tenant: Uuid) -> SecurityContext {
    SecurityContext::builder()
        .subject_id(Uuid::now_v7())
        .subject_tenant_id(tenant)
        .build()
        .expect("a valid security context")
}

fn node_type(leaf: &str) -> NodeType {
    NodeType {
        type_id: gts::node_type_id(leaf),
        title: leaf.to_owned(),
        description: String::new(),
    }
}

/// The schema domain node types were registered with before `_scope` was an
/// index path: the family and the search traits, nothing else.
fn schema_before_the_index(type_id: &str) -> Value {
    let mut schema = gts::derived_node_schema(type_id);
    schema["x-gts-traits"]
        .as_object_mut()
        .expect("traits")
        .remove("index");
    schema["allOf"].as_array_mut().expect("allOf").truncate(1);
    schema
}

/// Register `types` the way the store used to: no options, so a stored type
/// is never touched again.
async fn register_the_old_way(
    client: &dyn GraphStorageClientV1,
    ctx: &SecurityContext,
    types: &[NodeType],
) {
    let batch = types
        .iter()
        .map(|t| TypeRegistration {
            type_id: gts::graph_type_id(&t.type_id),
            schema: schema_before_the_index(&t.type_id),
        })
        .collect();
    client
        .register_types(ctx, batch)
        .await
        .expect("the old schemas register");
}

fn object(type_id: &str, key: &str, payload: Value) -> NodeUpsert {
    NodeUpsert {
        expected_version: None,
        type_id: type_id.to_owned(),
        node_key: gts::instance_id(type_id, key),
        name: Some(key.to_owned()),
        payload,
    }
}

async fn index_of(
    client: &dyn GraphStorageClientV1,
    ctx: &SecurityContext,
    type_id: &str,
) -> Vec<String> {
    client
        .get_type(ctx, &gts::graph_type_id(type_id))
        .await
        .expect("the type reads")
        .effective_traits
        .index
}

/// What the scope filter is, asked of the projection directly: admitted
/// means the graph narrowed the rows, not this process.
async fn filter_is_admitted(
    client: &dyn GraphStorageClientV1,
    ctx: &SecurityContext,
    type_id: &str,
) -> bool {
    let filter = toolkit_odata::parse_filter_string("payload/_scope eq 'p1'")
        .expect("the filter parses")
        .into_expr();
    client
        .count_nodes(
            ctx,
            &[gts::graph_type_id(type_id)],
            toolkit_odata::ODataQuery::default().with_filter(filter),
        )
        .await
        .is_ok()
}

#[tokio::test]
async fn a_type_registered_before_the_index_takes_it_and_a_scoped_read_filters() {
    let client = client();
    let ctx = ctx(Uuid::now_v7());
    let store = GraphStorageBackend::new(Arc::clone(&client));
    let team = node_type("team");

    register_the_old_way(client.as_ref(), &ctx, std::slice::from_ref(&team)).await;
    assert!(
        index_of(client.as_ref(), &ctx, &team.type_id)
            .await
            .is_empty()
    );
    assert!(
        !filter_is_admitted(client.as_ref(), &ctx, &team.type_id).await,
        "without the declaration the projection refuses the path"
    );

    // Rows written under the old schema, which the update has to revalidate:
    // in two scopes, one without a scope, one deleted. Under one page: the
    // in-memory store answers a single page and mints no cursor, so paging
    // is not what this checks (the filter re-sent with every cursor is the
    // catalogue's snapshot read, which a stand has checked).
    let mut rows: Vec<NodeUpsert> = (0..30)
        .map(|i| object(&team.type_id, &format!("p1-{i}"), json!({ "_scope": "p1" })))
        .collect();
    rows.extend(
        (0..20).map(|i| object(&team.type_id, &format!("p2-{i}"), json!({ "_scope": "p2" }))),
    );
    rows.push(object(&team.type_id, "unscoped", json!({ "name": "free" })));
    rows.push(object(
        &team.type_id,
        "gone",
        json!({ "_scope": "p1", "_deleted": true }),
    ));
    rows.push(object(&team.type_id, "quote", json!({ "_scope": "it's" })));
    for chunk in rows.chunks(100) {
        store
            .upsert_nodes(&ctx, chunk)
            .await
            .expect("the rows write");
    }

    let pinned = store
        .register_types(&ctx, std::slice::from_ref(&team), &[])
        .await
        .expect("the registration answers");
    assert!(pinned.is_empty(), "nothing is refused: {pinned:?}");
    assert_eq!(
        index_of(client.as_ref(), &ctx, &team.type_id).await,
        gts::INDEX_PATHS.map(str::to_owned).to_vec(),
        "the update put the index on the stored type"
    );
    assert!(filter_is_admitted(client.as_ref(), &ctx, &team.type_id).await);

    let types = [team.type_id.clone()];
    let p1 = store
        .list_objects(&ctx, &types, Some("p1"), None)
        .await
        .expect("a scoped read");
    assert_eq!(p1.len(), 30, "every live object of the scope");
    assert!(p1.iter().all(|o| o.value["_scope"] == "p1"));

    let bounded = store
        .list_objects(&ctx, &types, Some("p2"), Some(7))
        .await
        .expect("a bounded scoped read");
    assert_eq!(bounded.len(), 7);

    let quoted = store
        .list_objects(&ctx, &types, Some("it's"), None)
        .await
        .expect("a scope with a quote is a literal");
    assert_eq!(quoted.len(), 1);

    let all = store
        .list_objects(&ctx, &types, None, None)
        .await
        .expect("an unscoped read");
    assert_eq!(all.len(), 52, "every live object, the deleted one left out");

    // Registered again, nothing changes and nothing is refused.
    let again = store
        .register_types(&ctx, std::slice::from_ref(&team), &[])
        .await
        .expect("the registration converges");
    assert!(again.is_empty());
}

#[tokio::test]
async fn a_type_whose_rows_refuse_the_index_keeps_its_schema_and_still_answers() {
    let client = client();
    let ctx = ctx(Uuid::now_v7());
    let store = GraphStorageBackend::new(Arc::clone(&client));
    let team = node_type("team");
    let odd = node_type("odd");

    register_the_old_way(client.as_ref(), &ctx, &[team.clone(), odd.clone()]).await;
    store
        .upsert_nodes(
            &ctx,
            &[
                object(&team.type_id, "a", json!({ "_scope": "p1" })),
                // A scope that is not a string: the typed property refuses it,
                // so the update of this type cannot be admitted.
                object(&odd.type_id, "n", json!({ "_scope": 7 })),
                object(&odd.type_id, "b", json!({ "_scope": "p1" })),
            ],
        )
        .await
        .expect("the rows write");

    let pinned = store
        .register_types(&ctx, &[team.clone(), odd.clone()], &[])
        .await
        .expect("one refused type does not fail the registration");
    assert_eq!(pinned, vec![gts::graph_type_id(&odd.type_id)]);
    assert_eq!(
        index_of(client.as_ref(), &ctx, &team.type_id).await.len(),
        1
    );
    assert!(
        index_of(client.as_ref(), &ctx, &odd.type_id)
            .await
            .is_empty()
    );

    // The refused type is read by walking it; a read over both types cannot
    // filter (a path counts only when every selected type declares it), and
    // walks too.
    let odd_in_p1 = store
        .list_objects(&ctx, std::slice::from_ref(&odd.type_id), Some("p1"), None)
        .await
        .expect("the walk answers");
    assert_eq!(odd_in_p1.len(), 1);
    let both = store
        .list_objects(
            &ctx,
            &[team.type_id.clone(), odd.type_id.clone()],
            Some("p1"),
            None,
        )
        .await
        .expect("the walk answers");
    assert_eq!(both.len(), 2);
}

#[tokio::test]
async fn a_new_tenant_registers_the_index_from_the_start() {
    let client = client();
    let ctx = ctx(Uuid::now_v7());
    let store = GraphStorageBackend::new(Arc::clone(&client));
    let team = node_type("team");

    store
        .register_meta_types(&ctx)
        .await
        .expect("the meta types register");
    let pinned = store
        .register_types(&ctx, std::slice::from_ref(&team), &[])
        .await
        .expect("the types register");
    assert!(pinned.is_empty());
    assert!(filter_is_admitted(client.as_ref(), &ctx, &team.type_id).await);
}
