# ARCHITECTURE

## Gears Categories

All gears can be divided into several categories:

## Gen AI Gears

**Gen AI Gears** provide the core AI capabilities of Gears and represent the primary value layer for building AI-powered SaaS applications. These gears encapsulate domain-specific GenAI functionality such as conversational orchestration, model inference, retrieval-augmented generation (RAG), agent execution, prompt management, and tool invocation. They are responsible for transforming user intent and contextual data into AI-generated outputs while enforcing platform-level constraints such as tenancy, security, policy, and usage limits.

These gears are designed to be highly composable and extensible: they rely on Serverless and Core Functionality gears (e.g., settings, jobs, usage collection, audit) and integrate with external AI providers or local runtimes through well-defined gateways. Gen AI Gears do not directly manage enterprise governance concerns (licensing, identity, credentials); instead, they delegate those responsibilities to shared platform gears and core platform adapters to remain focused on AI behavior and orchestration logic.

### Execution flow overview
1. Chat Engine / API-triggered entry
2. Configuration & assets (Settings Service, Prompts Registry, Models Registry)
3. Retrieval & discovery (Web Search Gateway, URL Crawler, Local Search Index)
4. Execution & tools (LLM Gateway, MCP Registry, Model Provider Controller)
5. Agent orchestration (AI Agents Registry, Serverless Gateway, Serverless Runtimes)
6. Persistence & feedback (Agent Memory, Usage Collector, Audit)

The principal diagram visualizes the primary Gen AI gears. `Prompts Registry`, `Model Runtime Controller`, and `Local Search Index` are supporting gears kept in this document even though they are omitted from the top-level diagram for readability.

### Model Provider Controller
#### Responsibility
Defines own provider agnostic APIs for working with models.
#### High level scenarios
- [ ] p1 - model browsing
- [ ] p1 - inference API
- [ ] p1 - embedding API
- [ ] p1 - responses API
- [ ] p2 - model provider capabilities detection
#### More details
- TODO: PRD link
- TODO: Design link
- TODO: API link
- TODO: SDK link


## Serverless

### Serverless Runtimes
#### Responsibility
Provide actual runtimes for function and workflow execution.
#### High Level Scenarios
- [ ] p1 - Starlark workflows and functions
- [ ] p2 - Python workflows and functions
- [ ] p3 - declarative workflows (serverless workflows)
- [ ] p4 - per-runtime isolation and resource policies
#### More details
- TODO: PRD link
- TODO: Design link
- TODO: API link
- TODO: SDK link

### Cluster Plane
#### Responsibility
Provide platform-wide cross-instance coordination primitives with uniform semantics across backends, including distributed cache, leader election, distributed locks, and service discovery.
#### High Level Scenarios
- [ ] p1 - expose distributed cache with versioned values, TTLs, compare-and-swap operations, and reactive watch notifications
- [ ] p1 - provide leader election and distributed locks for cross-instance coordination with bounded failover and TTL-based safety
- [ ] p1 - provide service discovery with instance registration, serving intent, metadata filtering, and topology watch notifications
- [ ] p2 - validate consumer capability requirements against operator-selected backends at startup and fail loudly on mismatches
- [ ] p2 - support per-primitive backend routing with convenient cache-backed defaults for unbound primitives
#### More details
- TODO: PRD link
- TODO: Design link
- TODO: API link
- TODO: SDK link

## Core Functionality

**Core Functionality** gears provide the cross-cutting platform capabilities required to run Gears as a secure, observable, and operationally consistent system. They implement system-wide concerns such as notifications, approvals, analytics, auditability, usage collection, background job execution, eventing, node discovery, file handling, quotas, and type registration.

Core Functionality gears provide reusable operational services that Business Logic, Gen AI, and Serverless gears consume through stable contracts, ensuring consistency, compliance, and operational correctness across the platform.

### Event Broker
#### Responsibility
Provide platform-wide event publishing and subscription for asynchronous workflows and loose coupling between gears.
#### High Level Scenarios
- [ ] p1 - publish and subscribe to typed events
- [ ] p1 - integration with GTS and authz
- [ ] p2 - support custom plugins for events persistency (per topic)
- [ ] p2 - support in-memory filtering
- [ ] p3 - provide delivery retries, dead-letter handling, and replay
- [ ] p4 - enforce event-contract governance across gears
#### More details
- TODO: PRD link
- TODO: Design link
- TODO: API link
- TODO: SDK link

## Core Platform Integration Gears

**Core Platform Integration Gears** provide a thin abstraction layer between Gears and external or enterprise-grade platform services such as identity providers, license managers, credential stores, and outbound traffic governance systems. These gears expose minimal, stable interfaces that Gears can depend on without being coupled to a specific vendor, protocol, or deployment environment.

The primary role of these adapter gears is decoupling: they allow Gears to operate either as a standalone platform (using local implementations) or as a component embedded into a larger enterprise ecosystem. Adapter gears do not own authoritative state or business rules; instead, they translate Gears’s internal contracts into calls to external core platform services, handling protocol adaptation, caching, and integration-specific concerns.

### Auth Resolver
#### Responsibility
Introduces an abstraction layer behind real token validation and claims extraction. Contains minimalistic logic as main goal is to provide a single entrypoint for policy rules retrieval
#### High Level Scenarios
- [ ] p1 - validate JWTs and extract claims (roles and permissions)
- [ ] p1 - integrated adapter for single-tenant and single-user use-case (desktop app)
- [ ] p2 - tokens cache with invalidation rules
#### More details
- TODO: PRD link
- TODO: Design link
- [API](../gears/system/authn-resolver/README.md)
- [SDK](../gears/system/authn-resolver/authn-resolver-sdk/README.md)

### Credentials Store
#### Responsibility
Introduces an abstraction layer for credentials storage, either as a local service or a connector to upstream Credentials Store service. The goal is to provide a single entry point for storing, resolving, and injecting secrets without coupling feature code to a specific vault or secret-management backend.
#### High Level Scenarios
- [ ] p1 - store and retrieve secrets with tenant scoping
- [ ] p1 - adapter for single-user and single-tenant use-cases (desktop app)
- [ ] p2 - cache credential metadata and resolve provider-specific bindings
- [ ] p3 - audit secret access through stable adapter contracts
- [ ] p4 - integrate with external vault backends (AWS Secrets Manager, HashiCorp Vault, etc.)
#### More details
- [PRD](../gears/credstore/docs/PRD.md)
- [Design](../gears/credstore/docs/DESIGN.md)
- [API](../gears/credstore/credstore/README.md)
- [SDK](../gears/credstore/credstore-sdk/README.md)

### Outbound API Interface
#### Responsibility
Introduces an abstraction layer behind the real Outbound API Gateway. The main goal is to provide a single entrypoint for outbound calls.
#### High Level Scenarios
- [x] p1 - define outbound endpoints and execute calls with tracing
- [ ] p2 - adapter for single-user and single-tenant use-cases (desktop app)
- [ ] p2 - outbound calls metrics collection
- [ ] p3 - minimalistic rate limiting
- [ ] p4 - audit with retention for outbound calls
#### More details
- [PRD](../gears/system/oagw/docs/PRD.md)
- [Design](../gears/system/oagw/docs/DESIGN.md)
- [API](../gears/system/oagw/oagw/README.md)
- [SDK](../gears/system/oagw/oagw-sdk/README.md)

### Event Broker

Multi-consumer, partitioned, append-only event streaming for Gears modules.
Typed events, at-least-once delivery, idempotent producers (chained/monotonic/stateless),
pluggable storage backends, consumer-group cursor tracking.

**Status**: SDK landed (`cf-gears-event-broker-sdk`) — impl crate TODO.

#### High Level Scenarios
- [x] p0 - SDK + in-memory mock broker landed against a frozen wire contract (openapi + schemas)
- [ ] p1 - ingest: single/batch publish, per-topic outbox, idempotent producers (chained/monotonic/stateless), partition + sequence assignment
- [ ] p1 - storage backend trait + first backend (Postgres): retention floor, durable offsets and producer cursors, pluggable for additional backends
- [ ] p2 - dispatcher: consumer-group rebalance + topology versioning, per-partition cursor/frontier tracking, per-member CEL filtering, at-least-once fan-out
- [ ] p2 - delivery: JOIN/subscription lifecycle, multipart/mixed + SSE streaming, seek + offset commit, graceful terminal frames
- [ ] p3 - performance suite: publish-throughput and end-to-end-latency benchmarks, load/soak under rebalance, backpressure + DoS limits, CI regression gates
- [ ] p3 - dead-letter path, retention/compaction, observability (metrics, tracing, structured logs)
- [ ] p4 - production hardening: migrations, deployment, second storage backend + second filter engine as plugin proofs

#### More details
- [PRD](../gears/system/event-broker/docs/PRD.md)
- [Design](../gears/system/event-broker/docs/DESIGN.md) (R4 signed off)
- [SDK](../gears/system/event-broker/event-broker-sdk/README.md)

## Core Platform Services

### Account Manager
#### Responsibility
Core platform service managing accounts and tenant relationships (system of record when Gears runs standalone).
#### High Level Scenarios
- [ ] p1 - create and manage accounts/tenants and users
- [ ] p2 - hierarchical multi-tenancy
- [ ] p2 - link tenants to identities and organizations
- [ ] p3 - account lifecycle (suspend, soft-delete, hard-delete, archive, move)
- [ ] p4 - map external tenant IDs to internal IDs
- [ ] p4 - enterprise org structures and delegated administration
- [ ] p5 - federation across multiple account systems
#### More details
- TODO: PRD link
- TODO: Design link
- TODO: API link
- TODO: SDK link


## Studio

**Studio Gears** provide the developer experience and governance capabilities for the Constructor Studio product. They enable collaborative development workflows, GitHub integration, and platform governance controls.

### Studio Backend
#### Responsibility
Provide the backend services for Constructor Studio: project management, artifact storage, and collaboration features.
#### High Level Scenarios
- [ ] p1 - project and workspace management
- [ ] p1 - artifact storage and retrieval
- [ ] p2 - collaboration and sharing
- [ ] p3 - version history and diff views
#### More details
- TODO: PRD link
- TODO: Design link
- TODO: API link
- TODO: SDK link


# SCENARIOS EXAMPLES

## Sub-scenario - incoming API call processing

This diagram reflects the **actual middleware stack** from `api-gateway` (see `apply_middleware_stack` in `gears/system/api-gateway/src/lib.rs`).

**Middleware execution order (outermost → innermost):**
1. Request ID (SetRequestId + PropagateRequestId)
2. Trace span (tower-http TraceLayer)
3. Timeout (30s default)
4. Body limit
5. CORS (if enabled)
6. MIME validation
7. **Rate limiting** (per-route RPS + in-flight semaphore)
8. Error mapping (converts errors to RFC-9457 Problem)
