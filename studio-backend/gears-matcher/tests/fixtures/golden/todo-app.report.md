# Gears Matcher report: PRD - Todo App

| | |
|---|---|
| Spec | tests/fixtures/spec/todo-app/PRD.md (not in git) |
| Catalogue | GEARS.md `md-sha` · gear.gdl `gdl-sha` · 12 gears |
| Judge | stub judge (word matching, for tests) · tf-idf, k=10 · τ = 0.5 (the default, not yet calibrated: T10) |
| Made by | gears-match 0.1.0 on 2026-10-27 |

## Summary

| | covered | partial | gap | clarification needed | not assessed |
|---|---|---|---|---|---|
| Functional (5) | 1 | 0 | 4 | 0 | 0 |
| Non-functional (3) | 0 | 0 | 3 | 0 | 0 |

## Gears to use

| Gear | Confidence | Status | For |
|---|---|---|---|
| Account Manager | 0.50 | no code yet | Delete Task |

### Future parts in demand

Gears that fit but have no code yet, the most needed first.

| Gear | Needed by | For |
|---|---|---|
| Account Manager | 1 requirement | Delete Task |

## Functional requirements

| Requirement | Coverage | Gear | Conf. | Evidence | Gives / still to build |
|---|---|---|---|---|---|
| Create Task | gap | – | – | – | every candidate judged none |
| Complete Task | gap | – | – | – | every candidate judged none |
| Delete Task | covered | Account Manager | 0.50 | “Core platform service managing accounts and tenant relationships (system of record when Gears runs standalone).” | gives: Core platform service managing accounts and tenant relationships (system of record when Gears runs standalone). |
| Real-Time Sync via Changes Feed | gap | – | – | – | every candidate judged none |
| Filter Tasks | gap | – | – | – | every candidate judged none |

## Non-functional requirements

| Requirement | Coverage | Gear | Conf. | Evidence | Gives / still to build |
|---|---|---|---|---|---|
| Response Time | gap | – | – | – | every candidate judged none |
| Data Persistence | gap | – | – | – | every candidate judged none |
| Offline Support | gap | – | – | – | every candidate judged none |

## Gaps

### Every candidate judged none

- Create Task
- Complete Task
- Real-Time Sync via Changes Feed
- Filter Tasks
- Response Time
- Data Persistence
- Offline Support

## Inputs

| Document | Status | Requirements | Reason |
|---|---|---|---|
| tests/fixtures/spec/todo-app/PRD.md | read | 8 | defines 8 CF requirements |
