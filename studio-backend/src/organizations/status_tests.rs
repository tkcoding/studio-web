// Ported from the portal's project-path.test.ts and
// project-overview-model.test.ts at 00828880: the same facts give the same
// steps, signals and verdict.

use super::*;

fn empty() -> PathFacts {
    PathFacts {
        repositories: Some(0),
        synced: None,
        specs: Some(SpecQueues::default()),
        model: Some(ModelFacts::default()),
        findings: Some(FindingFacts::default()),
        kind: None,
        product: Some(ProductFacts::default()),
        build: Some(BuildFacts::Never),
    }
}

fn finished() -> PathFacts {
    PathFacts {
        repositories: Some(2),
        synced: None,
        specs: Some(SpecQueues {
            bound: 75,
            needs_review: 0,
            not_scanned: 0,
        }),
        model: Some(ModelFacts {
            documents: 75,
            extracted: 75,
            facts: 512,
            running: false,
        }),
        findings: Some(FindingFacts { open: 3, high: 0 }),
        kind: None,
        product: Some(ProductFacts {
            gears: 5,
            resolves: Some(true),
            errors: 0,
            written: true,
        }),
        build: Some(BuildFacts::Last {
            status: "passed".into(),
            sha: "abc1234".into(),
        }),
    }
}

fn states(f: &PathFacts) -> Vec<&'static str> {
    project_path(f).iter().map(|s| s.state.as_str()).collect()
}

#[test]
fn a_new_project_starts_at_connecting_a_repository() {
    let steps = project_path(&empty());
    let ids: Vec<&str> = steps.iter().map(|s| s.id).collect();
    assert_eq!(
        ids,
        ["repos", "types", "model", "findings", "product", "build"]
    );
    assert_eq!(
        states(&empty()),
        ["current", "todo", "todo", "done", "todo", "todo"]
    );
    assert_eq!(
        steps[0].status,
        "No repository yet. Attach one so Studio can read its documents."
    );
}

#[test]
fn every_step_is_done_on_a_project_whose_build_passed() {
    assert_eq!(states(&finished()), ["done"; 6]);
    let status: Vec<String> = project_path(&finished())
        .into_iter()
        .map(|s| s.status)
        .collect();
    assert_eq!(
        status,
        [
            "2 repositories attached.",
            "75 of 75 documents typed.",
            "75 of 75 documents read, 512 facts.",
            "3 open findings, none high.",
            "5 gears, resolves, saved to the repository.",
            "Last build passed at abc1234.",
        ]
    );
}

#[test]
fn the_steps_word_what_is_left() {
    let mut f = finished();
    f.specs = Some(SpecQueues {
        bound: 74,
        needs_review: 1,
        not_scanned: 0,
    });
    let s = &project_path(&f)[1];
    assert_eq!(
        (s.state, s.status.as_str(), s.tab),
        (
            StepState::Current,
            "74 of 75 documents typed (1 need review).",
            "specs"
        )
    );

    let mut f = finished();
    f.findings = Some(FindingFacts { open: 2, high: 1 });
    let s = &project_path(&f)[3];
    assert_eq!(
        (s.state, s.status.as_str()),
        (StepState::Current, "2 open findings, 1 high.")
    );

    let mut f = finished();
    f.model = Some(ModelFacts {
        documents: 10,
        extracted: 4,
        facts: 20,
        running: true,
    });
    assert_eq!(
        project_path(&f)[2].status,
        "Building: 4 of 10 documents read."
    );

    let mut f = finished();
    f.product = Some(ProductFacts {
        gears: 3,
        resolves: Some(false),
        errors: 2,
        written: false,
    });
    assert_eq!(
        project_path(&f)[4].status,
        "3 gears, does not resolve (2 errors)."
    );
    f.product = Some(ProductFacts {
        gears: 1,
        resolves: None,
        errors: 0,
        written: false,
    });
    let s = &project_path(&f)[4];
    assert_eq!(
        (s.state, s.status.as_str()),
        (StepState::Current, "1 gear picked, not previewed yet.")
    );

    let mut f = finished();
    f.build = Some(BuildFacts::Last {
        status: "failed".into(),
        sha: "def5678".into(),
    });
    let s = &project_path(&f)[5];
    assert_eq!(
        (s.state, s.status.as_str()),
        (StepState::Current, "Last build failed at def5678.")
    );
}

#[test]
fn a_failed_read_is_unknown_and_never_current() {
    let mut f = empty();
    f.repositories = None;
    f.specs = None;
    assert_eq!(
        states(&f),
        ["unknown", "unknown", "current", "done", "todo", "todo"]
    );
    assert_eq!(
        project_path(&f)[0].status,
        "Could not read the project's sources."
    );
}

#[test]
fn the_repositories_step_says_how_many_a_sync_read() {
    let status = |synced| {
        let mut f = finished();
        f.synced = synced;
        project_path(&f)[0].status.clone()
    };
    assert_eq!(status(Some(2)), "2 repositories attached, all synced.");
    assert_eq!(status(Some(1)), "2 repositories attached, 1 synced.");
    assert_eq!(status(None), "2 repositories attached.");
}

#[test]
fn the_kind_step_comes_after_the_findings_when_asked() {
    let mut f = finished();
    f.kind = Some(Some(KindFacts {
        done: false,
        status: "Studio proposes a web service.".into(),
    }));
    let steps = project_path(&f);
    assert_eq!(steps[4].id, "kind");
    assert_eq!(steps[4].state, StepState::Current);
    f.kind = Some(None);
    assert_eq!(project_path(&f)[4].state, StepState::Unknown);
}

// ── the verdict ─────────────────────────────────────────────────────────────

fn path() -> PathFacts {
    PathFacts {
        repositories: Some(1),
        synced: Some(1),
        specs: Some(SpecQueues {
            bound: 10,
            needs_review: 0,
            not_scanned: 0,
        }),
        model: Some(ModelFacts {
            documents: 10,
            extracted: 10,
            facts: 40,
            running: false,
        }),
        findings: Some(FindingFacts { open: 0, high: 0 }),
        kind: None,
        product: Some(ProductFacts {
            gears: 4,
            resolves: Some(true),
            errors: 0,
            written: true,
        }),
        build: Some(BuildFacts::Last {
            status: "passed".into(),
            sha: "abc1234".into(),
        }),
    }
}

fn facts() -> Facts {
    Facts {
        path: Some(path()),
        specs: Some(20),
        specs_failing: Some(0),
        open_comments: None,
        pulls: Some(Vec::new()),
        deployments: Some(Vec::new()),
        health: None,
        waiting_on_me: None,
    }
}

fn verdict_of(f: &Facts) -> Verdict {
    let steps = f.path.as_ref().map(project_path);
    project_verdict(&project_signals(f), steps.as_deref())
}

fn dep(state: &str, at: &str, env: &str) -> Deploy {
    Deploy {
        state: state.into(),
        at: at.into(),
        environment_name: env.into(),
        ..Deploy::default()
    }
}

fn pr(days: u32) -> Pull {
    Pull {
        waiting: "review".into(),
        days_since_update: Some(days),
        ..Pull::default()
    }
}

#[test]
fn on_track_with_the_path_complete_when_nothing_is_wrong() {
    let v = verdict_of(&facts());
    assert_eq!(
        (v.state, v.label, v.reason.as_str(), v.more),
        ("on_track", "On track", "path complete", 0)
    );
}

#[test]
fn on_track_names_the_next_step() {
    let mut f = facts();
    f.path.as_mut().unwrap().product = Some(ProductFacts::default());
    let v = verdict_of(&f);
    assert_eq!(
        (v.state, v.reason.as_str()),
        ("on_track", "next: compose the product")
    );
}

#[test]
fn blocked_by_a_failed_build_deploy_product_or_high_finding() {
    let mut f = facts();
    f.path.as_mut().unwrap().build = Some(BuildFacts::Last {
        status: "failed".into(),
        sha: "x".into(),
    });
    let v = verdict_of(&f);
    assert_eq!(
        (v.state, v.reason.as_str()),
        ("blocked", "last build failed")
    );

    let mut f = facts();
    f.deployments = Some(vec![
        dep("succeeded", "2026-11-01T10:00:00Z", "dev"),
        dep("failed", "2026-11-02T00:00:00Z", "test"),
    ]);
    assert_eq!(verdict_of(&f).reason, "last deploy to test failed");

    let mut f = facts();
    f.path.as_mut().unwrap().product = Some(ProductFacts {
        gears: 3,
        resolves: Some(false),
        errors: 2,
        written: false,
    });
    assert_eq!(verdict_of(&f).reason, "product does not resolve");

    let mut f = facts();
    f.path.as_mut().unwrap().findings = Some(FindingFacts { open: 3, high: 2 });
    assert_eq!(verdict_of(&f).reason, "2 high findings open");
}

#[test]
fn a_refused_connection_blocks_first_and_the_others_are_counted() {
    let mut f = facts();
    f.health = Some(Health {
        refused: true,
        ..Health::default()
    });
    f.specs_failing = Some(4);
    f.path.as_mut().unwrap().build = Some(BuildFacts::Last {
        status: "failed".into(),
        sha: String::new(),
    });
    let v = verdict_of(&f);
    assert_eq!(
        (v.state, v.reason.as_str(), v.more),
        ("blocked", "repository connection refused", 2)
    );
}

#[test]
fn at_risk_for_failing_specs_or_stuck_pulls_not_a_fresh_one() {
    let mut f = facts();
    f.specs_failing = Some(1);
    let v = verdict_of(&f);
    assert_eq!(
        (v.state, v.reason.as_str()),
        ("at_risk", "1 spec fails its checks")
    );

    let mut f = facts();
    f.pulls = Some(vec![pr(2)]);
    assert_eq!(verdict_of(&f).state, "on_track");

    let mut f = facts();
    let mut stuck = pr(9);
    stuck.waiting_on = vec!["Ann".into()];
    f.pulls = Some(vec![stuck]);
    let signals = project_signals(&f);
    assert_eq!(signals.len(), 1);
    assert_eq!(signals[0].key, "stuck");
    assert_eq!(signals[0].level, Level::Risk);
    assert_eq!(signals[0].phrase, "1 pull request stuck over 7 days");
    assert_eq!(signals[0].detail.as_deref(), Some("waiting on Ann"));

    let mut f = facts();
    let mut draft = pr(30);
    draft.draft = true;
    draft.waiting = "draft".into();
    f.pulls = Some(vec![draft]);
    assert_eq!(verdict_of(&f).state, "on_track");
}

#[test]
fn unread_sources_and_info_signals_do_not_move_it() {
    let mut f = facts();
    f.specs_failing = None;
    f.pulls = None;
    f.deployments = None;
    assert_eq!(verdict_of(&f).state, "on_track");
    let mut f = facts();
    f.waiting_on_me = Some(3);
    assert_eq!(verdict_of(&f).state, "on_track");
    let s = &project_signals(&f)[0];
    assert_eq!(
        (s.level, s.phrase.as_str()),
        (Level::Info, "3 comment threads wait on you")
    );
}

#[test]
fn an_unreadable_path_says_no_step_blocks_it() {
    let mut f = facts();
    f.path = None;
    assert_eq!(verdict_of(&f).reason, "no step blocks the path");
    f.specs_failing = Some(2);
    assert_eq!(verdict_of(&f).state, "at_risk");
}

#[test]
fn the_strip_marks_failures_warnings_and_unknowns() {
    let mut f = path();
    f.build = Some(BuildFacts::Last {
        status: "failed".into(),
        sha: String::new(),
    });
    f.findings = Some(FindingFacts { open: 1, high: 1 });
    f.model = None;
    let steps = project_path(&f);
    let by: std::collections::BTreeMap<&str, &str> =
        steps.iter().map(|s| (s.id, flow_state(s, &f))).collect();
    assert_eq!(by["build"], "failed");
    assert_eq!(by["findings"], "warn");
    assert_eq!(by["model"], "later");
    assert_eq!(by["repos"], "done");
    let mut done = path();
    done.build = Some(BuildFacts::Never);
    assert_eq!(next_step(&project_path(&done)).map(|s| s.id), Some("build"));
    assert!(next_step(&project_path(&path())).is_none());
}

#[test]
fn the_last_deploy_is_the_newest_that_ran_installs_only() {
    let a = dep("succeeded", "2026-11-01T00:00:00Z", "dev");
    let b = dep("failed", "2026-11-03T00:00:00Z", "dev");
    let mut c = dep("succeeded", "2026-11-04T00:00:00Z", "dev");
    c.action = Some("uninstall".into());
    let d = dep("queued", "2026-11-05T00:00:00Z", "dev");
    let all = [a, b.clone(), c, d];
    assert_eq!(last_deploy(&all), Some(&b));
    assert_eq!(last_deploy(&[]), None);
}

// ── the kits (ADR-0070 §7) ──────────────────────────────────────────────────

fn only(kits: &[&str]) -> Kits {
    Kits::Only(kits.iter().map(|k| (*k).to_string()).collect())
}

/// A project with every kind of signal at once.
fn troubled() -> Facts {
    let mut f = facts();
    f.health = Some(Health {
        refused: true,
        quiet_days: Some(20),
        ..Health::default()
    });
    f.specs_failing = Some(2);
    f.open_comments = Some(3);
    f.path.as_mut().unwrap().findings = Some(FindingFacts { open: 1, high: 1 });
    f.path.as_mut().unwrap().build = Some(BuildFacts::Last {
        status: "failed".into(),
        sha: String::new(),
    });
    let mut nobody = pr(1);
    nobody.waiting = "nobody".into();
    f.pulls = Some(vec![pr(9), nobody]);
    f
}

#[test]
fn every_signal_and_step_names_the_kit_whose_tab_it_opens() {
    let kit_of: Vec<(&str, Option<&str>)> = project_signals(&troubled())
        .iter()
        .map(|s| (s.key, s.kit))
        .collect();
    assert_eq!(
        kit_of,
        [
            ("refused", None),
            ("build", Some(RELEASES_KIT)),
            ("findings", Some(ISSUES_KIT)),
            ("specs", Some(SPECS_KIT)),
            ("stuck", Some(GIT_KIT)),
            ("nobody", Some(GIT_KIT)),
            ("threads", Some(ACTIVITY_KIT)),
            ("quiet", Some(ACTIVITY_KIT)),
        ]
    );
    let steps: Vec<(&str, Option<&str>)> = project_path(&path())
        .iter()
        .map(|s| (s.id, s.kit))
        .collect();
    assert_eq!(
        steps,
        [
            ("repos", None),
            ("types", Some(SPECS_KIT)),
            ("model", Some(DOMAIN_MODEL_KIT)),
            ("findings", Some(ISSUES_KIT)),
            ("product", Some(RELEASES_KIT)),
            ("build", Some(RELEASES_KIT)),
        ]
    );
}

#[test]
fn a_signal_of_a_kit_not_installed_is_left_out_and_the_verdict_is_the_rest_s() {
    let f = troubled();
    // Every kit: as before.
    assert_eq!(
        project_signals_for(&f, &Kits::All),
        project_signals(&f),
        "kits that cannot be told hide nothing"
    );
    // Without project-git the pull requests say nothing; at risk only for
    // the specs once the blocking ones' kits are gone too.
    let no_git = project_signals_for(
        &f,
        &only(&[SPECS_KIT, ISSUES_KIT, RELEASES_KIT, ACTIVITY_KIT]),
    );
    assert!(no_git.iter().all(|s| s.kit != Some(GIT_KIT)));
    let mut calm = f.clone();
    calm.health.as_mut().unwrap().refused = false;
    let kits = only(&[SPECS_KIT]);
    let signals = project_signals_for(&calm, &kits);
    let keys: Vec<&str> = signals.iter().map(|s| s.key).collect();
    assert_eq!(keys, ["specs"]);
    let steps = project_path_for(&calm.path.clone().unwrap(), &kits);
    let v = project_verdict(&signals, Some(&steps));
    assert_eq!(
        (v.state, v.reason.as_str(), v.more),
        ("at_risk", "2 specs fail their checks", 0)
    );
    // An organization without any kit: only the shell's own signal, and the
    // path is the repository alone.
    let none = only(&[]);
    let signals = project_signals_for(&f, &none);
    assert_eq!(
        signals.iter().map(|s| s.key).collect::<Vec<_>>(),
        ["refused"]
    );
    let steps = project_path_for(&f.path.clone().unwrap(), &none);
    assert_eq!(steps.iter().map(|s| s.id).collect::<Vec<_>>(), ["repos"]);
    let mut fine = f.clone();
    fine.health = None;
    let signals = project_signals_for(&fine, &none);
    assert!(signals.is_empty());
    let v = project_verdict(&signals, Some(&steps));
    assert_eq!((v.state, v.reason.as_str()), ("on_track", "path complete"));
}

#[test]
fn a_step_of_a_kit_not_installed_is_never_current() {
    // Specs is where a new project stands; without the kit, the next step
    // is the product.
    let mut f = path();
    f.specs = Some(SpecQueues::default());
    f.product = Some(ProductFacts::default());
    assert_eq!(next_step(&project_path(&f)).map(|s| s.id), Some("types"));
    let kits = only(&[DOMAIN_MODEL_KIT, ISSUES_KIT, RELEASES_KIT]);
    let steps = project_path_for(&f, &kits);
    assert!(steps.iter().all(|s| s.id != "types"));
    assert_eq!(next_step(&steps).map(|s| s.id), Some("product"));
}
