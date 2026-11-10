# Spec fixtures (T2)

Real CF spec documents, copied unchanged, so T2's tests run on what T2 will really read (T2 design
note D9). Internal Constructor specs; this repository is private.

| Folder | Example | Source | Files |
|---|---|---|---|
| `bundle-studio/` | 1 | `constructorfabric/studio-web` @ `5fd27ad` | the PRD |
| `bundle-insight/` | 2 | `constructorfabric/insight` @ `14350fe` | the 8 PRDs |
| `bundle-mini-chat/` | 4 | `constructorfabric/gears-rust` @ `a8275b2` | the PRD |
| `todo-app/` | — | `constructorfabric/gears-rust` @ `f2103d4`, `docs/spec-templates/examples/todo-app/PRD.md` (SHA-256 `0e0d52e7…4d39b`) | the PRD |

| `free-form/` | — | invented, written by `claude-sonnet-5-5` on 2026-11-04, **not yet reviewed** | six free-form cases for T8 (see its `README.md`) |

Each `bundle-*/manifest.json` is an **extract** of the PM's bundle v2 manifest (HYP-3036,
2026-10-09): that one product's entry, listing only the files committed here, with their original
paths, source URLs and SHA-256. The full manifest is never committed: it also lists the confidential
examples.

**Insight is for extractor tests only.** It is the proposed held-out evaluation example, so it must
never be used to tune retrieval, prompts or thresholds (T3's measurements run on todo-app, Studio and
Mini Chat; issue #4).

The other documents of each bundle (designs, feature specs, supporting notes) are not here; the
tests build small bundles in a temporary folder to cover them.
