//! The overview's rules, stated as tests: these are the product here.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::json;
use time::macros::datetime;
use uuid::Uuid;

use super::*;
use crate::usage::port::TokenCounts;

const ORG: Uuid = Uuid::from_u128(0x0);
const ADA: Uuid = Uuid::from_u128(0xADA);
const ADA_OTHER_LOGIN: Uuid = Uuid::from_u128(0xADA2);
const BOB: Uuid = Uuid::from_u128(0xB0B);
const GONE: Uuid = Uuid::from_u128(0x6011E);

fn run(
    state: &str,
    repo: &str,
    error: Option<&str>,
    at: OffsetDateTime,
    project: &str,
) -> RunSummary {
    RunSummary {
        task_type: "artifact.ingest".into(),
        state: state.into(),
        payload: json!({
            "provider": "github",
            "secret_ref": "gh-org",
            "repo_full_path": repo,
            "project_id": project,
        }),
        last_error: error.map(str::to_owned),
        created_at: at,
    }
}

fn pull(waiting: &str, on: &[&str], since: u32) -> OpenPull {
    OpenPull {
        project_id: Some("p1".into()),
        author: Some("dev".into()),
        waiting: waiting.into(),
        waiting_on: on.iter().map(|s| (*s).to_owned()).collect(),
        reviewers: on.iter().map(|s| (*s).to_owned()).collect(),
        days_open: Some(since + 2),
        days_since_update: Some(since),
    }
}

fn member(person: &str, subjects: &[Uuid]) -> RosterMember {
    RosterMember {
        person: person.into(),
        subjects: subjects.iter().map(Uuid::to_string).collect(),
    }
}

fn call(subject: Option<Uuid>, payer: Payer, input: u64, tenant: Uuid) -> Fact {
    Fact {
        tenant,
        person: subject,
        kind: FactKind::Llm,
        provider: "anthropic".into(),
        item: "claude-sonnet-5-5".into(),
        payer: Some(payer),
        tokens: TokenCounts {
            input,
            ..TokenCounts::default()
        },
        ..Fact::default()
    }
}

fn session(tenant: Uuid) -> Fact {
    Fact {
        tenant,
        kind: FactKind::Session,
        provider: "kubernetes".into(),
        item: "ide-session".into(),
        payer: Some(Payer::Organization),
        cpu_millicore_seconds: 1000,
        ..Fact::default()
    }
}

/// One currency unit per input token, one per core-second of a session.
fn priced(facts: Vec<Fact>) -> PricedUsage {
    PricedUsage::from_parts(
        facts,
        json!({
            "currency": "EUR",
            "models": [{ "provider": "anthropic", "model": "claude-sonnet-5-5", "input_per_mtok": 1_000_000.0 }],
            "session": { "cpu_core_hour": 3600.0 },
        }),
    )
    .unwrap()
}

// ── Periods ──

#[test]
fn spend_compares_the_last_30_days_with_the_same_days_a_month_earlier() {
    let w = windows(datetime!(2026-10-19 15:00 UTC));
    assert_eq!(w.current.from, datetime!(2026-09-20 0:00 UTC));
    assert_eq!(w.current.to, datetime!(2026-10-20 0:00 UTC));
    // 21 Aug – 19 Sep, both included.
    assert_eq!(w.previous.from, datetime!(2026-08-21 0:00 UTC));
    assert_eq!(w.previous.to, datetime!(2026-09-20 0:00 UTC));
    assert_eq!(w.month.from, datetime!(2026-10-01 0:00 UTC));
    assert_eq!((w.elapsed_days, w.month_days), (19, 31));
}

#[test]
fn a_month_back_from_the_31st_is_the_last_day_of_a_shorter_month() {
    // 31 March: one month back is 28 February, not 3 March.
    assert_eq!(
        windows(datetime!(2026-03-31 10:00 UTC)).previous.to,
        datetime!(2026-03-01 0:00 UTC)
    );
    // January reaches back into December of the year before.
    assert_eq!(
        windows(datetime!(2026-01-10 10:00 UTC)).previous.to,
        datetime!(2025-12-11 0:00 UTC)
    );
}

#[test]
fn growth_needs_something_before_and_the_forecast_keeps_the_pace() {
    assert_eq!(growth(150.0, 100.0), Some(0.5));
    assert_eq!(growth(10.0, 0.0), None);
    assert_eq!(forecast(100.0, 10, 31), 310.0);
    assert_eq!(forecast(7.0, 0, 30), 7.0);
}

// ── Refused connections ──

#[test]
fn a_refused_credential_is_not_a_rate_limit() {
    assert_eq!(
        refusal(Some("GitHub 401 Unauthorized: Bad credentials")),
        Some("401")
    );
    assert_eq!(
        refusal(Some(
            "403 Forbidden: Resource not accessible by integration"
        )),
        Some("403")
    );
    assert_eq!(
        refusal(Some(
            "GitHub 403 Forbidden: API rate limit exceeded for user ID 301748190."
        )),
        None
    );
    assert_eq!(refusal(Some("took 4013 ms, connection reset")), None);
    assert_eq!(refusal(None), None);
}

#[test]
fn only_each_repositorys_newest_run_counts() {
    let runs = [
        // Newest first. acme/api synced again since it was refused: fine.
        run(
            "succeeded",
            "acme/api",
            None,
            datetime!(2026-10-19 10:00 UTC),
            "p1",
        ),
        run(
            "failed",
            "acme/web",
            Some("GitHub 401 Bad credentials"),
            datetime!(2026-10-19 9:00 UTC),
            "p2",
        ),
        run(
            "failed",
            "acme/api",
            Some("GitHub 401 Bad credentials"),
            datetime!(2026-10-18 9:00 UTC),
            "p1",
        ),
        run(
            "failed",
            "acme/web",
            Some("GitHub 401 Bad credentials"),
            datetime!(2026-10-17 9:00 UTC),
            "p2",
        ),
        run(
            "failed",
            "acme/docs",
            Some("GitHub 401 Bad credentials"),
            datetime!(2026-10-16 9:00 UTC),
            "p3",
        ),
        run(
            "failed",
            "acme/x",
            Some("timeout"),
            datetime!(2026-10-16 9:00 UTC),
            "p3",
        ),
    ];
    let broken = broken_connections(&runs);
    assert_eq!(broken.len(), 1);
    let b = &broken[0];
    assert_eq!(
        (b.key.as_str(), b.provider.as_str(), b.status),
        ("gh-org", "github", "401")
    );
    assert_eq!(b.repos, ["acme/web", "acme/docs"]);
    assert_eq!(b.projects, ["p2", "p3"]);
    assert_eq!(b.since, datetime!(2026-10-16 9:00 UTC));
    // The refusals are said as one; the timeout is counted.
    assert_eq!(other_failures(&runs), 1);
}

// ── Work that does not move ──

#[test]
fn a_pull_request_is_stuck_after_seven_days_and_a_draft_never_is() {
    let pulls = [
        pull("review", &["ann"], 8),
        pull("review", &["ann"], 2),
        pull("draft", &[], 30),
        pull("nobody", &[], 7),
    ];
    assert_eq!(stuck(&pulls, STUCK_DAYS).len(), 2);
}

#[test]
fn stuck_work_is_queued_by_the_person_it_waits_on() {
    let pulls = [
        pull("review", &["ann-gh", "bob"], 9),
        pull("review", &["ann-work"], 12),
        pull("nobody", &[], 8),
    ];
    let stuck = stuck(&pulls, STUCK_DAYS);
    // Ann has two accounts; both are the same member.
    let member = |login: &str| {
        login
            .starts_with("ann")
            .then(|| ("person-ann".to_owned(), Some("Ann Lee".to_owned())))
    };
    let queues = waiting_on(&stuck, &member);
    let summary: Vec<(Option<&str>, Option<&str>, u32, u32)> = queues
        .iter()
        .map(|q| {
            (
                q.person_id.as_deref(),
                q.who.as_deref(),
                q.count,
                q.oldest_days,
            )
        })
        .collect();
    assert_eq!(
        summary,
        [
            (Some("person-ann"), Some("Ann Lee"), 2, 12),
            (None, Some("bob"), 1, 9),
            (None, None, 1, 8),
        ]
    );
}

#[test]
fn the_middle_wait_and_quiet_days() {
    assert_eq!(median(&[5, 1, 3]), Some(3.0));
    assert_eq!(median(&[1, 2, 3, 4]), Some(2.5));
    assert_eq!(median(&[]), None);
    let now = datetime!(2026-10-19 12:00 UTC);
    assert_eq!(days_since(Some("2026-10-01T12:00:00Z"), now), Some(18));
    assert_eq!(days_since(None, now), None);
    assert_eq!(days_since(Some("yesterday"), now), None);
}

// ── Spend, attributed ──

#[test]
fn spend_is_a_members_through_any_of_their_sign_ins_and_the_rest_is_said() {
    let members = [
        member("person-ada", &[ADA, ADA_OTHER_LOGIN]),
        member("person-bob", &[BOB]),
    ];
    let subjects = subjects_of(&members);
    let usage = priced(vec![
        call(Some(ADA), Payer::Organization, 3, ORG),
        call(Some(ADA_OTHER_LOGIN), Payer::Organization, 2, ORG),
        // Somebody who left: no active member signs in with it.
        call(Some(GONE), Payer::Organization, 4, ORG),
        // Bob's own key: he used a model, the organization did not pay.
        call(Some(BOB), Payer::Personal, 7, ORG),
        session(ORG),
    ]);
    let who = attribute(&usage, &subjects);
    assert_eq!(who.attributed, 5.0);
    assert_eq!(who.unattributed, 4.0);
    assert_eq!(who.sessions, 1.0);
    assert_eq!(
        who.spenders,
        BTreeSet::from(["person-ada".to_owned(), "person-bob".to_owned()])
    );

    let previous = priced(vec![call(Some(ADA), Payer::Organization, 1, ORG)]);
    let by_person = breakdown(&usage, &previous, GroupBy::Person, false, &subjects);
    let rows: Vec<(&str, f64, f64)> = by_person
        .iter()
        .map(|r| (r.key.as_str(), r.cost, r.previous))
        .collect();
    assert_eq!(
        rows,
        [
            ("person-ada", 5.0, 1.0),
            (UNATTRIBUTED, 4.0, 0.0),
            ("", 1.0, 0.0)
        ]
    );
    // With people's own keys, Bob's spend is his row.
    let with_own = breakdown(&usage, &previous, GroupBy::Person, true, &subjects);
    assert_eq!(with_own[0].key, "person-bob");
    assert_eq!(with_own[0].cost, 7.0);
}

#[test]
fn an_idle_member_neither_spent_nor_has_a_pull_request_open() {
    let members = [member("ada", &[]), member("bob", &[]), member("cid", &[])];
    let spenders = BTreeSet::from(["ada".to_owned()]);
    let on_pulls = BTreeSet::from(["bob".to_owned()]);
    assert_eq!(idle(&members, &spenders, &on_pulls), ["cid"]);
}

// ── Workspaces, worst first ──

fn workspace(id: u128, name: &str) -> Row {
    Row {
        id: Uuid::from_u128(id),
        name: name.into(),
        ..Row::default()
    }
}

fn project(id: u128, name: &str, ws: u128, extra: impl FnOnce(&mut Row)) -> Row {
    let mut r = Row {
        id: Uuid::from_u128(id),
        name: name.into(),
        workspace: Some(Uuid::from_u128(ws)),
        last_at: Some("2026-10-18T00:00:00Z".into()),
        ..Row::default()
    };
    extra(&mut r);
    r
}

#[test]
fn the_workspace_in_most_trouble_comes_first_and_says_why() {
    let now = datetime!(2026-10-19 12:00 UTC);
    let rows = [
        workspace(1, "Calm"),
        workspace(2, "Fire"),
        project(11, "ok", 1, |_| {}),
        project(21, "broken", 2, |_| {}),
        project(22, "slow", 2, |r| {
            r.specs_failing = Some(1);
            r.last_at = Some("2026-09-01T00:00:00Z".into());
        }),
    ];
    let id = |n: u128| Uuid::from_u128(n).to_string();
    let spend = BTreeMap::from([(id(21), 30.0), (id(22), 10.0), (id(11), 5.0)]);
    let previous = BTreeMap::from([(id(21), 10.0), (id(11), 5.0)]);
    let stuck = BTreeMap::from([(id(22), 2)]);
    let broken = BTreeSet::from([id(21)]);
    let health = workspace_health(
        &rows,
        &HealthInputs {
            spend: Some(&spend),
            previous: Some(&previous),
            stuck: &stuck,
            broken: &broken,
            now,
        },
    );
    assert_eq!(
        health.iter().map(|w| w.name.as_str()).collect::<Vec<_>>(),
        ["Fire", "Calm"]
    );
    let fire = &health[0];
    assert_eq!(
        fire.projects
            .iter()
            .map(|p| p.name.as_str())
            .collect::<Vec<_>>(),
        ["broken", "slow"]
    );
    assert_eq!(
        fire.projects[0].reasons,
        [Reason::Refused, Reason::SpendGrows(2.0)]
    );
    assert_eq!(
        fire.projects[1].reasons,
        [Reason::SpecsFailing(1), Reason::Stuck(2), Reason::Quiet(48)]
    );
    assert_eq!(
        (
            fire.spend,
            fire.previous,
            fire.specs_failing,
            fire.stuck,
            fire.quiet_days
        ),
        (Some(40.0), Some(10.0), 1, 2, Some(1))
    );
    assert!(health[1].projects[0].reasons.is_empty());

    // Without costs, spend is unknown rather than zero.
    let blind = workspace_health(
        &rows,
        &HealthInputs {
            spend: None,
            previous: None,
            stuck: &stuck,
            broken: &broken,
            now,
        },
    );
    assert!(blind.iter().all(|w| w.spend.is_none()));
}

// ── What needs the leader ──

#[test]
fn a_refused_connection_comes_first_then_money_then_stuck_work() {
    let broken = [Broken {
        key: "k".into(),
        provider: "github".into(),
        status: "401",
        error: String::new(),
        repos: vec!["a/b".into()],
        projects: vec!["p1".into(), "p-unknown".into()],
        since: datetime!(2026-10-19 0:00 UTC),
    }];
    let names = BTreeMap::from([("p1".to_owned(), "Shop".to_owned())]);
    let all = needs(&NeedInputs {
        broken: &broken,
        project_names: &names,
        spend: Some((150.0, 100.0, 200.0, Some("Shop".into()))),
        stuck: 3,
        waiting_on: 2,
        undecided: 2,
        other_failures: 1,
    });
    assert_eq!(
        all[0],
        Need::Refused {
            provider: "github".into(),
            status: "401",
            projects: vec!["Shop".into()],
            repos: 1
        }
    );
    assert!(matches!(all[1], Need::SpendGrows { grower: Some(ref g), .. } if g == "Shop"));
    assert_eq!(
        all[2],
        Need::Stuck {
            pulls: 3,
            people: 2
        }
    );
    assert_eq!(all[3], Need::Decide { components: 2 });
    assert_eq!(all[4], Need::RunsFailed { runs: 1 });

    // Spend growing by less than the alert is not news.
    let calm = needs(&NeedInputs {
        broken: &[],
        project_names: &names,
        spend: Some((110.0, 100.0, 120.0, None)),
        stuck: 0,
        waiting_on: 0,
        undecided: 0,
        other_failures: 0,
    });
    assert!(calm.is_empty());
}

// ── The answer ──

fn read(spend: Option<Result<Spend, String>>) -> Read {
    let p1 = Uuid::from_u128(11);
    Read {
        name: "Acme".into(),
        rows: vec![
            workspace(1, "Payments"),
            project(11, "Checkout", 1, |r| {
                r.specs = Some(4);
                r.specs_failing = Some(1);
                r.pulls_open = Some(2);
                r.pulls_merged = Some(5);
            }),
        ],
        members: Some(vec![
            member("person-ada", &[ADA]),
            member("person-cid", &[]),
        ]),
        names: BTreeMap::from([("person-ada".to_owned(), "Ada".to_owned())]),
        registry: Some(vec![
            "candidate".into(),
            "declared".into(),
            "registered".into(),
        ]),
        runs: Some(vec![run(
            "failed",
            "acme/checkout",
            Some("401 Bad credentials"),
            datetime!(2026-10-19 9:00 UTC),
            &p1.to_string(),
        )]),
        pulls: Some(vec![OpenPull {
            project_id: Some(p1.to_string()),
            ..pull("review", &["ada-gh"], 9)
        }]),
        accounts: BTreeMap::from([(
            "ada-gh".to_owned(),
            ("person-ada".to_owned(), Some("Ada".to_owned())),
        )]),
        spend,
        windows: windows(datetime!(2026-10-19 12:00 UTC)),
        kits: Kits::All,
    }
}

fn with_kits(kits: &[&str]) -> Read {
    Read {
        kits: Kits::Only(kits.iter().map(|k| (*k).to_owned()).collect()),
        ..read(None)
    }
}

#[test]
fn without_project_git_the_pull_requests_leave_and_the_rest_stands() {
    let now = datetime!(2026-10-19 12:00 UTC);
    let all = compose(ORG, &with_kits(&[GIT_KIT, COMPONENTS_KIT, COSTS_KIT]), now);
    assert_eq!(
        all.needs
            .iter()
            .map(|n| n.kind.as_str())
            .collect::<Vec<_>>(),
        ["connection", "pulls", "components"]
    );
    assert_eq!(
        all.needs
            .iter()
            .map(|n| n.kit.as_deref())
            .collect::<Vec<_>>(),
        [None, Some(GIT_KIT), Some(COMPONENTS_KIT)]
    );
    assert_eq!(all.workspaces[0].projects[0].stuck, 1);

    let no_git = compose(ORG, &with_kits(&[COMPONENTS_KIT]), now);
    assert_eq!(
        no_git
            .needs
            .iter()
            .map(|n| n.kind.as_str())
            .collect::<Vec<_>>(),
        ["connection", "components"]
    );
    assert!(no_git.waiting_on.is_none());
    assert_eq!(
        (
            no_git.delivery.merged,
            no_git.delivery.open,
            no_git.delivery.median_wait_days
        ),
        (None, None, None)
    );
    assert_eq!(no_git.workspaces[0].projects[0].stuck, 0);
    // The other blocks stay.
    assert_eq!(no_git.specs.failing, Some(1));
    assert!(no_git.workspaces[0].projects[0].broken);
    assert_eq!(no_git.decisions.as_ref().unwrap().undecided, 2);
    assert_eq!(
        no_git.kits.as_deref(),
        Some(&[COMPONENTS_KIT.to_owned()][..])
    );

    // No kit at all: only the shell's own need, and nothing breaks.
    let bare = compose(ORG, &with_kits(&[]), now);
    assert_eq!(
        bare.needs
            .iter()
            .map(|n| n.kind.as_str())
            .collect::<Vec<_>>(),
        ["connection"]
    );
    assert_eq!(bare.people.active, Some(2));
    // Kits that could not be read hide nothing.
    assert!(compose(ORG, &read(None), now).kits.is_none());
}

#[test]
fn without_cost_view_every_money_field_is_null_and_the_rest_stands() {
    let dto = compose(ORG, &read(None), datetime!(2026-10-19 12:00 UTC));
    assert_eq!(dto.costs, "hidden");
    assert!(dto.spend.is_none() && dto.money.is_none());
    assert_eq!(dto.people.active, Some(2));
    assert!(dto.people.with_spend.is_none() && dto.people.idle.is_none());
    assert_eq!(
        dto.needs
            .iter()
            .map(|n| n.kind.as_str())
            .collect::<Vec<_>>(),
        ["connection", "pulls", "components"]
    );
    assert_eq!(dto.needs[0].projects, ["Checkout"]);
    assert_eq!(dto.delivery.merged, Some(5));
    assert_eq!(dto.specs.failing, Some(1));
    let queue = &dto.waiting_on.as_ref().unwrap()[0];
    assert_eq!(
        (queue.person_id.as_deref(), queue.who.as_deref()),
        (Some("person-ada"), Some("Ada"))
    );
    assert_eq!(dto.decisions.as_ref().unwrap().undecided, 2);
    assert!(dto.workspaces[0].projects[0].broken);
    assert!(dto.workspaces[0].spend.is_none());

    let unreadable = compose(
        ORG,
        &read(Some(Err("collector down".into()))),
        datetime!(2026-10-19 12:00 UTC),
    );
    assert_eq!(unreadable.costs, "unreadable");
    assert!(unreadable.spend.is_none());
}

#[test]
fn with_costs_spend_is_attributed_and_the_idle_are_named() {
    let p1 = Uuid::from_u128(11);
    let spend = Spend {
        current: priced(vec![
            call(Some(ADA), Payer::Organization, 30, p1),
            call(Some(GONE), Payer::Organization, 10, p1),
            call(Some(ADA), Payer::Personal, 6, p1),
        ]),
        previous: priced(vec![call(Some(ADA), Payer::Organization, 20, p1)]),
        month: priced(vec![call(Some(ADA), Payer::Organization, 19, p1)]),
    };
    let dto = compose(ORG, &read(Some(Ok(spend))), datetime!(2026-10-19 12:00 UTC));
    assert_eq!(dto.costs, "shown");
    let s = dto.spend.as_ref().unwrap();
    assert_eq!(
        (s.currency.as_str(), s.current, s.previous, s.own_keys),
        ("EUR", 40.0, 20.0, 6.0)
    );
    assert_eq!(s.forecast, 31.0);
    assert_eq!(
        (s.attributed, s.unattributed, s.sessions),
        (30.0, 10.0, 0.0)
    );
    assert_eq!(dto.people.with_spend, Some(1));
    assert_eq!(dto.people.per_person, Some(30.0));
    // Cid neither spent nor has a pull request; Ada did both.
    let idle = dto.people.idle.as_ref().unwrap();
    assert_eq!(
        idle.iter()
            .map(|p| p.person_id.as_str())
            .collect::<Vec<_>>(),
        ["person-cid"]
    );
    // +100%: the spend need, naming the project that grew.
    let need = dto.needs.iter().find(|n| n.kind == "spend").unwrap();
    assert_eq!(need.grower.as_deref(), Some("Checkout"));
    // Every grouping, with and without own keys.
    let money = dto.money.as_ref().unwrap();
    assert_eq!(money.len(), 10);
    let people = money
        .iter()
        .find(|m| m.group_by == "person" && !m.include_personal)
        .unwrap();
    assert_eq!(
        people
            .rows
            .iter()
            .map(|r| (r.key.as_str(), r.label.as_deref(), r.cost))
            .collect::<Vec<_>>(),
        [
            ("person-ada", Some("Ada"), 30.0),
            (UNATTRIBUTED, None, 10.0)
        ]
    );
    let projects = money
        .iter()
        .find(|m| m.group_by == "project" && !m.include_personal)
        .unwrap();
    assert_eq!(projects.rows[0].label.as_deref(), Some("Checkout"));
    assert_eq!(dto.workspaces[0].spend, Some(40.0));
}

// ── Answers kept between requests ────────────────────────────────────────────

#[test]
fn a_kept_overview_is_served_to_the_same_caller() {
    let answers: Answers<u32> = Answers::default();
    answers.put(ORG, ADA, 7);
    assert_eq!(answers.get(ORG, ADA), Some(7));
}

#[test]
fn one_callers_overview_is_not_anothers() {
    // The money is there only for someone who may see costs, so an answer
    // read as one person is never shown to another.
    let answers: Answers<u32> = Answers::default();
    answers.put(ORG, ADA, 7);
    assert_eq!(answers.get(ORG, BOB), None);
}

#[test]
fn one_organizations_overview_is_not_anothers() {
    let answers: Answers<u32> = Answers::default();
    answers.put(ORG, ADA, 7);
    assert_eq!(answers.get(GONE, ADA), None);
}

#[test]
fn an_overview_past_its_minute_is_read_again() {
    let answers: Answers<u32> = Answers::with_ttl(std::time::Duration::ZERO);
    answers.put(ORG, ADA, 7);
    assert_eq!(answers.get(ORG, ADA), None);
}
