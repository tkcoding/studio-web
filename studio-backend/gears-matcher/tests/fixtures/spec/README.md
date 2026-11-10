# Spec fixtures

| Folder | What it is | Files |
|---|---|---|
| `todo-app/` | The public todo-app example from `constructorfabric/gears-rust` @ `f2103d4`, `docs/spec-templates/examples/todo-app/PRD.md` (SHA-256 `0e0d52e7…4d39b`), copied unchanged. | the PRD |
| `free-form/` | Invented free-form documents for the free-form reading (T8); written by `claude-sonnet-5-5` on 2026-11-04, **not reviewed** (see its `README.md`). | six free-form cases |

The real specifications that gears-matcher's own tests use (Studio, Insight, Mini Chat) are **not**
part of this copy: they stay in the gears-matcher repository (see `SOURCE`), and the tests that read
them were left behind with them. Tests here that need a bigger spec build one in a temporary folder.
