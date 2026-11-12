# Fixtures

Excerpts of [`gears-rust`](https://github.com/constructorfabric/gears-rust), licensed Apache-2.0
(see `LICENSE` and `NOTICE` in this component).

| Fixture | Source commit |
|---|---|
| `GEARS.md` (from `docs/GEARS.md`) | `62d89b0ca1e507bd33cb6345eeaab23da2776198` |
| `gdl/**/gear.gdl` | `70a5354d83ed95b84361386f7190b46c5e49c668` |

Only the cases the parser tests need are kept. Do not edit them to make a test pass; replace them
with a new excerpt and update the commit above.

## Recorded replies of the real models

`llm/verified-todo-app/` holds the 16 replies the `verified` matcher got from the real models (Sonnet 4.6, Opus 5,
gpt-5.4, through Constructor's LLM connector) on `spec/todo-app/PRD.md` (a public example), recorded on
2026-11-10 against the pinned catalogue. `golden/verified-todo-app.report.json` is the report the service gives from them;
`gears-match --matcher verified` gave the same report on the same replies, apart from the document's path.
`tests/test_service_replay.py` replays them. Re-record both if the pinned commits, the prompts or the models change.
