//! A project's status for its project manager: one verdict, the signals
//! behind it, and the path from an empty tenant to a product that builds.
//!
//! Moved from the portal (`project-overview-model.ts` `projectSignals`,
//! `projectVerdict`, `nextStep`, `stripState`, `lastDeploy`, `stuckPulls`;
//! `project-path.ts` `projectPath`) so an agent reads the verdict a person
//! does. Pure: the route reads the facts, this words them.
//!
//! Every fact may be `None`: the read failed or the source is not part of
//! this deployment. A fact that is not known is never a reason — it leaves the
//! verdict to the ones that answered, and its path step says it does not know
//! rather than claiming the step is not done.
//!
//! THE VERDICT is the worst of the signals:
//!
//! * `blocked` — the repository connection is refused; the product does not
//!   resolve; the last build on the main branch failed; the last deploy
//!   failed; a high finding is open.
//! * `at_risk` — specs fail their checks; pull requests have waited a week or
//!   more; pull requests have nobody asked to review them.
//! * `on_track` — none of those, with the path's next step as its reason
//!   ("next: compose the product"), or "path complete".
//!
//! Signals of level `info` (comment threads waiting, a quiet project) are
//! listed and do not move the verdict.
//!
//! EVERY SIGNAL AND STEP NAMES THE KIT whose tab it opens (ADR-0070 §7,
//! `docs/design/domain-model-split.md` §7): pull requests are project-git's,
//! specs project-specs', findings project-issues', the project domain model
//! project-domain-model's, the product, builds and deploys product-releases',
//! comment threads and quiet projects project-activity's. A signal or step
//! whose kit does not apply to the project is left out ([`Kits`]) and the
//! verdict is computed from the rest; the repository connection and the IDE
//! are the shell's and always stay.

/// A pull request quiet this many days or more is stuck.
pub const QUIET_DAYS: u32 = 7;

/// The kits a project's status reads for (`kit_registry/builtin`).
pub const GIT_KIT: &str = "project-git";
pub const SPECS_KIT: &str = "project-specs";
pub const ISSUES_KIT: &str = "project-issues";
pub const DOMAIN_MODEL_KIT: &str = "project-domain-model";
pub const RELEASES_KIT: &str = "product-releases";
pub const ACTIVITY_KIT: &str = "project-activity";

/// The kits that apply to a project: `All` where they cannot be told (an
/// assembly without studio-kits, or its answer could not be read), so
/// nothing is hidden for a failed read.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Kits {
    All,
    Only(Vec<String>),
}

impl Kits {
    /// Whether something owned by `kit` shows; the shell's own (`None`)
    /// always does.
    pub fn has(&self, kit: Option<&str>) -> bool {
        match (self, kit) {
            (_, None) | (Kits::All, _) => true,
            (Kits::Only(kits), Some(k)) => kits.iter().any(|x| x == k),
        }
    }
}

fn plural(n: u32, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

fn plural_s(n: u32, one: &str) -> String {
    plural(n, one, &format!("{one}s"))
}

// ── The path ────────────────────────────────────────────────────────────────

/// The Specs queues: typed (bound), waiting for a decision, not read yet.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SpecQueues {
    pub bound: u32,
    pub needs_review: u32,
    pub not_scanned: u32,
}

/// The project domain model: documents read out of how many, facts, a build running.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ModelFacts {
    pub documents: u32,
    pub extracted: u32,
    pub facts: u32,
    pub running: bool,
}

/// Findings nobody has decided yet, and how many of them are high.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FindingFacts {
    pub open: u32,
    pub high: u32,
}

/// The product record: gears picked and what the last check said.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ProductFacts {
    pub gears: u32,
    /// `None` before it was ever checked.
    pub resolves: Option<bool>,
    pub errors: u32,
    /// Saved to the repository.
    pub written: bool,
}

/// What the product is: confirmed, or what Studio proposes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KindFacts {
    pub done: bool,
    pub status: String,
}

/// The newest finished build on the main branch.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BuildFacts {
    /// No build was ever seen.
    Never,
    Last {
        status: String,
        sha: String,
    },
}

/// What the path is read from. `None` on any field: that read failed.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PathFacts {
    pub repositories: Option<u32>,
    /// How many of them a sync has read.
    pub synced: Option<u32>,
    pub specs: Option<SpecQueues>,
    pub model: Option<ModelFacts>,
    pub findings: Option<FindingFacts>,
    /// Outer `None`: the path has no such step (it was not asked);
    /// `Some(None)`: it could not be read.
    pub kind: Option<Option<KindFacts>>,
    pub product: Option<ProductFacts>,
    pub build: Option<BuildFacts>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StepState {
    Done,
    Current,
    Todo,
    Unknown,
}

impl StepState {
    pub fn as_str(self) -> &'static str {
        match self {
            StepState::Done => "done",
            StepState::Current => "current",
            StepState::Todo => "todo",
            StepState::Unknown => "unknown",
        }
    }
}

/// One step of the path.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Step {
    /// `repos`, `types`, `model`, `findings`, `kind`, `product` or `build`.
    pub id: &'static str,
    pub title: &'static str,
    pub state: StepState,
    /// One line from the data, e.g. "74 of 75 documents typed."
    pub status: String,
    /// The project tab where the step is done.
    pub tab: &'static str,
    pub action: &'static str,
    /// The kit whose tab that is; `None` for the shell's own (Sources).
    pub kit: Option<&'static str>,
}

/// The kit a step of the path is done in.
pub fn step_kit(id: &str) -> Option<&'static str> {
    match id {
        "types" => Some(SPECS_KIT),
        "model" => Some(DOMAIN_MODEL_KIT),
        "findings" => Some(ISSUES_KIT),
        "kind" | "product" | "build" => Some(RELEASES_KIT),
        _ => None,
    }
}

struct Draft {
    id: &'static str,
    title: &'static str,
    tab: &'static str,
    action: &'static str,
    done: Option<bool>,
    status: String,
}

fn draft(
    id: &'static str,
    title: &'static str,
    tab: &'static str,
    action: &'static str,
    done: Option<bool>,
    status: String,
) -> Draft {
    Draft {
        id,
        title,
        tab,
        action,
        done,
        status,
    }
}

fn repos(f: &PathFacts) -> Draft {
    let d = |done, status: String| {
        draft(
            "repos",
            "Connect a repository",
            "sources",
            "Open Sources",
            done,
            status,
        )
    };
    let Some(n) = f.repositories else {
        return d(None, "Could not read the project's sources.".into());
    };
    if n == 0 {
        return d(
            Some(false),
            "No repository yet. Attach one so Studio can read its documents.".into(),
        );
    }
    let synced = match f.synced {
        None => String::new(),
        Some(s) if s == n => {
            if s == 1 {
                ", synced".into()
            } else {
                ", all synced".into()
            }
        }
        Some(s) => format!(", {s} synced"),
    };
    d(
        Some(true),
        format!(
            "{} attached{synced}.",
            plural(n, "repository", "repositories")
        ),
    )
}

fn types(f: &PathFacts) -> Draft {
    let d = |done, status: String| {
        draft(
            "types",
            "Type the documents",
            "specs",
            "Open Specs",
            done,
            status,
        )
    };
    let Some(s) = f.specs else {
        return d(None, "Could not read the Specs queues.".into());
    };
    let total = s.bound + s.needs_review + s.not_scanned;
    if total == 0 {
        return d(
            Some(false),
            "No documents found yet. Sync a repository or write one.".into(),
        );
    }
    let left: Vec<String> = [
        (s.needs_review > 0).then(|| format!("{} need review", s.needs_review)),
        (s.not_scanned > 0).then(|| format!("{} not scanned", s.not_scanned)),
    ]
    .into_iter()
    .flatten()
    .collect();
    let left = if left.is_empty() {
        String::new()
    } else {
        format!(" ({})", left.join(", "))
    };
    d(
        Some(s.bound > 0 && s.needs_review == 0 && s.not_scanned == 0),
        format!(
            "{} of {} typed{left}.",
            s.bound,
            plural_s(total, "document")
        ),
    )
}

fn model(f: &PathFacts) -> Draft {
    let d = |done, status: String| {
        draft(
            "model",
            "Build the project domain model",
            "model",
            "Open Project domain model",
            done,
            status,
        )
    };
    let Some(m) = f.model else {
        return d(None, "Could not read the project domain model.".into());
    };
    if m.running {
        return d(
            Some(false),
            format!(
                "Building: {} of {} read.",
                m.extracted,
                plural_s(m.documents, "document")
            ),
        );
    }
    if m.documents == 0 {
        return d(
            Some(false),
            "Not built yet. Type the documents first, then build it.".into(),
        );
    }
    d(
        Some(m.extracted == m.documents && m.facts > 0),
        format!(
            "{} of {} read, {}.",
            m.extracted,
            plural_s(m.documents, "document"),
            plural_s(m.facts, "fact")
        ),
    )
}

fn findings(f: &PathFacts) -> Draft {
    let d = |done, status: String| {
        draft(
            "findings",
            "Resolve what blocks a build",
            "model",
            "Open findings",
            done,
            status,
        )
    };
    let Some(x) = f.findings else {
        return d(None, "Could not read the findings.".into());
    };
    if x.open == 0 {
        return d(Some(true), "No open findings.".into());
    }
    let open = plural_s(x.open, "open finding");
    let status = if x.high > 0 {
        format!("{open}, {} high.", x.high)
    } else {
        format!("{open}, none high.")
    };
    d(Some(x.high == 0), status)
}

fn kind(k: Option<&KindFacts>) -> Draft {
    let d = |done, status: String| {
        draft(
            "kind",
            "Decide what the product is",
            "components",
            "Open Product",
            done,
            status,
        )
    };
    match k {
        None => d(None, "Could not read what the product is.".into()),
        Some(k) => d(Some(k.done), k.status.clone()),
    }
}

fn product(f: &PathFacts) -> Draft {
    let d = |done, status: String| {
        draft(
            "product",
            "Compose the product",
            "components",
            "Open Product",
            done,
            status,
        )
    };
    let Some(p) = f.product else {
        return d(None, "Could not read the product.".into());
    };
    if p.gears == 0 {
        return d(Some(false), "No gears picked yet.".into());
    }
    let gears = plural_s(p.gears, "gear");
    match p.resolves {
        None => d(Some(false), format!("{gears} picked, not previewed yet.")),
        Some(true) => {
            let saved = if p.written {
                ", saved to the repository"
            } else {
                ""
            };
            d(Some(true), format!("{gears}, resolves{saved}."))
        }
        Some(false) => d(
            Some(false),
            format!(
                "{gears}, does not resolve ({}).",
                plural_s(p.errors, "error")
            ),
        ),
    }
}

fn build(f: &PathFacts) -> Draft {
    let d = |done, status: String| {
        draft(
            "build",
            "Build and deploy",
            "releases",
            "Open Releases",
            done,
            status,
        )
    };
    match &f.build {
        None => d(None, "Could not read the CI runs.".into()),
        Some(BuildFacts::Never) => d(Some(false), "No CI run seen yet.".into()),
        Some(BuildFacts::Last { status, sha }) => {
            let at = if sha.is_empty() {
                String::new()
            } else {
                format!(" at {sha}")
            };
            d(
                Some(status == "passed"),
                format!("Last build {status}{at}."),
            )
        }
    }
}

/// The steps in order. The current one is the first that is known and not
/// done; an unknown step is skipped rather than made current, because a
/// failed read is not where the project stands. Every kit is installed:
/// the server asks [`project_path_for`]; the tests read the whole path.
#[cfg(test)]
pub fn project_path(f: &PathFacts) -> Vec<Step> {
    project_path_for(f, &Kits::All)
}

/// [`project_path`] of a project with `kits`: a step whose kit does not
/// apply is not on its path, and is never current.
pub fn project_path_for(f: &PathFacts, kits: &Kits) -> Vec<Step> {
    let mut drafts = vec![repos(f), types(f), model(f), findings(f)];
    if let Some(k) = &f.kind {
        drafts.push(kind(k.as_ref()));
    }
    drafts.push(product(f));
    drafts.push(build(f));
    drafts.retain(|d| kits.has(step_kit(d.id)));
    let current = drafts.iter().position(|d| d.done == Some(false));
    drafts
        .into_iter()
        .enumerate()
        .map(|(i, d)| Step {
            id: d.id,
            title: d.title,
            state: match d.done {
                None => StepState::Unknown,
                Some(true) => StepState::Done,
                Some(false) if Some(i) == current => StepState::Current,
                Some(false) => StepState::Todo,
            },
            status: d.status,
            tab: d.tab,
            action: d.action,
            kit: step_kit(d.id),
        })
        .collect()
}

/// The step to do next: the current one; `None` when the path is done.
pub fn next_step(steps: &[Step]) -> Option<&Step> {
    steps.iter().find(|s| s.state == StepState::Current)
}

/// A step as the path strip draws it: a failed build or product is
/// `failed`, open high findings `warn`, an unknown step `later`.
pub fn flow_state(step: &Step, f: &PathFacts) -> &'static str {
    let build_failed =
        matches!(&f.build, Some(BuildFacts::Last { status, .. }) if status == "failed");
    if step.id == "build" && build_failed {
        return "failed";
    }
    if step.id == "product" && f.product.and_then(|p| p.resolves) == Some(false) {
        return "failed";
    }
    if step.id == "findings" && f.findings.is_some_and(|x| x.high > 0) {
        return "warn";
    }
    if step.state == StepState::Unknown {
        return "later";
    }
    step.state.as_str()
}

// ── Signals ─────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    Blocked,
    Risk,
    Info,
}

impl Level {
    pub fn as_str(self) -> &'static str {
        match self {
            Level::Blocked => "blocked",
            Level::Risk => "risk",
            Level::Info => "info",
        }
    }
}

/// One reason, with where to act on it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Signal {
    pub key: &'static str,
    pub level: Level,
    /// The reason in a few words.
    pub phrase: String,
    pub detail: Option<String>,
    pub action_label: &'static str,
    /// A project tab, `pulls` (the pull requests list) or `ide`.
    pub action_target: &'static str,
    /// The kit the signal is read for and whose tab it opens; `None` for the
    /// shell's own (the repository connection, the IDE).
    pub kit: Option<&'static str>,
}

/// The kit a signal belongs to, by its key.
pub fn signal_kit(key: &str) -> Option<&'static str> {
    match key {
        "stuck" | "nobody" => Some(GIT_KIT),
        "specs" => Some(SPECS_KIT),
        "findings" => Some(ISSUES_KIT),
        "product" | "build" | "deploy" => Some(RELEASES_KIT),
        "threads" | "quiet" => Some(ACTIVITY_KIT),
        _ => None,
    }
}

/// An open pull request as the signals read it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Pull {
    pub draft: bool,
    /// `review`, `author`, `nobody`, `draft`, …
    pub waiting: String,
    /// Who it waits on, by name.
    pub waiting_on: Vec<String>,
    pub days_since_update: Option<u32>,
}

/// A deployment as the signals read it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Deploy {
    /// `install` when absent.
    pub action: Option<String>,
    pub preview: bool,
    pub state: String,
    pub environment_name: String,
    pub reason: Option<String>,
    pub outcome: Option<String>,
    /// Decided, else requested; RFC 3339.
    pub at: String,
}

/// The project's line of the organization's health.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Health {
    pub refused: bool,
    /// Days without activity, when the project is quiet.
    pub quiet_days: Option<u32>,
    pub specs_failing: Option<u32>,
    pub stuck: u32,
}

/// What the signals are read from; `None`: not readable.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Facts {
    pub path: Option<PathFacts>,
    pub specs: Option<u32>,
    pub specs_failing: Option<u32>,
    pub open_comments: Option<u32>,
    pub pulls: Option<Vec<Pull>>,
    pub deployments: Option<Vec<Deploy>>,
    pub health: Option<Health>,
    /// Comment threads waiting on the caller.
    pub waiting_on_me: Option<u32>,
}

/// The newest deploy that ran (succeeded or failed), installs only.
pub fn last_deploy(deployments: &[Deploy]) -> Option<&Deploy> {
    deployments
        .iter()
        .filter(|d| {
            d.action.as_deref().unwrap_or("install") == "install"
                && !d.preview
                && (d.state == "succeeded" || d.state == "failed")
        })
        .fold(None, |a: Option<&Deploy>, d| match a {
            Some(a) if d.at <= a.at => Some(a),
            _ => Some(d),
        })
}

/// Open pull requests quiet for a week or more, drafts aside.
pub fn stuck_pulls(pulls: &[Pull]) -> Vec<&Pull> {
    pulls
        .iter()
        .filter(|p| {
            !p.draft && p.waiting != "draft" && p.days_since_update.unwrap_or(0) >= QUIET_DAYS
        })
        .collect()
}

fn waiting_on_text(pulls: &[&Pull]) -> String {
    let mut names: Vec<String> = Vec::new();
    for p in pulls {
        let these = if p.waiting == "nobody" {
            vec!["nobody asked".to_string()]
        } else {
            p.waiting_on.clone()
        };
        for n in these {
            if !names.contains(&n) {
                names.push(n);
            }
        }
    }
    if names.is_empty() {
        return String::new();
    }
    let more = if names.len() > 3 {
        format!(" +{}", names.len() - 3)
    } else {
        String::new()
    };
    format!(
        "waiting on {}{more}",
        names[..names.len().min(3)].join(", ")
    )
}

fn signal(
    key: &'static str,
    level: Level,
    phrase: String,
    detail: Option<String>,
    action_label: &'static str,
    action_target: &'static str,
) -> Signal {
    Signal {
        key,
        level,
        phrase,
        detail,
        action_label,
        action_target,
        kit: signal_kit(key),
    }
}

/// [`project_signals`] of a project with `kits`: a signal whose kit does not
/// apply is left out, so the verdict is the remaining signals'.
pub fn project_signals_for(f: &Facts, kits: &Kits) -> Vec<Signal> {
    let mut out = project_signals(f);
    out.retain(|s| kits.has(s.kit));
    out
}

/// Everything that waits on the project manager or the team, worst first.
pub fn project_signals(f: &Facts) -> Vec<Signal> {
    let mut out = Vec::new();
    let health = f.health.as_ref();
    if health.is_some_and(|h| h.refused) {
        out.push(signal(
            "refused",
            Level::Blocked,
            "repository connection refused".into(),
            Some("nothing syncs until the connection is fixed".into()),
            "Open Sources",
            "sources",
        ));
    }
    let p = f.path.as_ref();
    if let Some(product) = p.and_then(|p| p.product)
        && product.resolves == Some(false)
    {
        out.push(signal(
            "product",
            Level::Blocked,
            "product does not resolve".into(),
            Some(plural_s(product.errors, "error")),
            "Open Product",
            "components",
        ));
    }
    if let Some(BuildFacts::Last { status, sha }) = p.and_then(|p| p.build.as_ref())
        && status == "failed"
    {
        out.push(signal(
            "build",
            Level::Blocked,
            "last build failed".into(),
            (!sha.is_empty()).then(|| format!("at {sha}")),
            "Open Releases",
            "releases",
        ));
    }
    if let Some(d) = f.deployments.as_deref().and_then(last_deploy)
        && d.state == "failed"
    {
        let detail = d
            .reason
            .clone()
            .filter(|r| !r.is_empty())
            .or_else(|| d.outcome.clone().filter(|o| !o.is_empty()));
        out.push(signal(
            "deploy",
            Level::Blocked,
            format!("last deploy to {} failed", d.environment_name),
            detail,
            "Open Releases",
            "releases",
        ));
    }
    if let Some(x) = p.and_then(|p| p.findings)
        && x.high > 0
    {
        out.push(signal(
            "findings",
            Level::Blocked,
            format!("{} open", plural_s(x.high, "high finding")),
            Some("a high finding blocks the build".into()),
            "Open findings",
            "model",
        ));
    }

    let failing = f
        .specs_failing
        .or_else(|| health.and_then(|h| h.specs_failing));
    if let Some(n) = failing.filter(|n| *n > 0) {
        out.push(signal(
            "specs",
            Level::Risk,
            if n == 1 {
                "1 spec fails its checks".into()
            } else {
                format!("{n} specs fail their checks")
            },
            f.specs.filter(|s| *s > 0).map(|s| format!("of {s} specs")),
            "Open Specs",
            "specs",
        ));
    }
    let stuck = f.pulls.as_deref().map(stuck_pulls);
    let stuck_count = match &stuck {
        Some(s) => u32::try_from(s.len()).unwrap_or(u32::MAX),
        None => health.map_or(0, |h| h.stuck),
    };
    if stuck_count > 0 {
        out.push(signal(
            "stuck",
            Level::Risk,
            format!(
                "{} stuck over {QUIET_DAYS} days",
                plural_s(stuck_count, "pull request")
            ),
            stuck
                .as_deref()
                .map(waiting_on_text)
                .filter(|t| !t.is_empty()),
            "Who they wait on",
            "pulls",
        ));
    }
    let nobody = match (&f.pulls, &stuck) {
        (Some(pulls), stuck) => {
            let stuck = stuck.as_deref().unwrap_or_default();
            pulls
                .iter()
                .filter(|x| x.waiting == "nobody" && !stuck.iter().any(|s| std::ptr::eq(*s, *x)))
                .count()
        }
        (None, _) => 0,
    };
    if nobody > 0 {
        out.push(signal(
            "nobody",
            Level::Risk,
            format!(
                "{} with no reviewer asked",
                plural_s(u32::try_from(nobody).unwrap_or(u32::MAX), "pull request")
            ),
            None,
            "Who they wait on",
            "pulls",
        ));
    }

    if let Some(n) = f.waiting_on_me.filter(|n| *n > 0) {
        out.push(signal(
            "threads-me",
            Level::Info,
            format!(
                "{} {} on you",
                plural_s(n, "comment thread"),
                if n == 1 { "waits" } else { "wait" }
            ),
            Some("answered in the IDE, on the text each is about".into()),
            "Open IDE",
            "ide",
        ));
    } else if let Some(n) = f.open_comments.filter(|n| *n > 0) {
        out.push(signal(
            "threads",
            Level::Info,
            format!("{} unanswered", plural_s(n, "comment thread")),
            Some("questions the team left in the documents".into()),
            "Open Activity",
            "activity",
        ));
    }
    if let Some(days) = health.and_then(|h| h.quiet_days) {
        out.push(signal(
            "quiet",
            Level::Info,
            format!("no activity for {days} days"),
            None,
            "Open Activity",
            "activity",
        ));
    }
    out
}

// ── Verdict ─────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Verdict {
    /// `blocked`, `at_risk` or `on_track`.
    pub state: &'static str,
    pub label: &'static str,
    /// The main reason, in one short phrase.
    pub reason: String,
    /// How many more blocking or at-risk reasons there are.
    pub more: u32,
}

/// The worst of the signals; on track, the next step of the path. `steps`
/// is `None` when the path could not be read at all.
pub fn project_verdict(signals: &[Signal], steps: Option<&[Step]>) -> Verdict {
    let count = |l: Level| signals.iter().filter(|s| s.level == l).count();
    let (blocked, risk) = (count(Level::Blocked), count(Level::Risk));
    let first = |l: Level| {
        signals
            .iter()
            .find(|s| s.level == l)
            .map(|s| s.phrase.clone())
            .unwrap_or_default()
    };
    let n = |v: usize| u32::try_from(v).unwrap_or(u32::MAX);
    if blocked > 0 {
        return Verdict {
            state: "blocked",
            label: "Blocked",
            reason: first(Level::Blocked),
            more: n(blocked + risk - 1),
        };
    }
    if risk > 0 {
        return Verdict {
            state: "at_risk",
            label: "At risk",
            reason: first(Level::Risk),
            more: n(risk - 1),
        };
    }
    let reason = match steps.and_then(next_step) {
        Some(next) => {
            let mut title = next.title.chars();
            let head: String = title
                .next()
                .map(|c| c.to_lowercase().collect())
                .unwrap_or_default();
            format!("next: {head}{}", title.as_str())
        }
        None if steps
            .is_some_and(|s| !s.is_empty() && s.iter().all(|x| x.state == StepState::Done)) =>
        {
            "path complete".into()
        }
        None => "no step blocks the path".into(),
    };
    Verdict {
        state: "on_track",
        label: "On track",
        reason,
        more: 0,
    }
}

#[cfg(test)]
#[path = "status_tests.rs"]
mod status_tests;
