# studio-tasks

Background work that survives the process running it.

The design — why the gear exists, what it deliberately is not, how a run is
dispatched, cancelled and retried, the REST surface and the table — is
[`docs/design/studio-tasks.md`](../../../docs/design/studio-tasks.md). This
README is what you need to work in the directory.

## In the assembly

- Gear `studio-tasks`, capabilities `[rest, db, stateful]`, deps
  `account_management`.
- Config section `gears.studio-tasks`.
- Handlers are registered by the gears that own the work — `notify.deliver`,
  `artifact.ingest`, `session.reap`, `session.await_ready`,
  `spec_quality.analyze`, `spec_quality.analyze_batch`, `catalog.sync`,
  `connector.graph_sync`, `organizations.project_create`, and this gear's own
  `tasks.retention_sweep`. A handler that records its steps reads them back
  from `TaskContext::recorded` (the run's result when the attempt began), so a
  retry continues where the last attempt stopped.
- A run's `summary` and `last_error` are cut to 500 characters; its `result` is
  **not** capped, and it is broadcast whole on
  [`../studio_events`](../studio_events). A handler that can produce a large
  result should store a pointer to it rather than the thing itself.
