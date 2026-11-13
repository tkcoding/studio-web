//! Why a build or a deploy failed, in words a person acts on, and the action
//! that fixes it (#1054).
//!
//! A build's record keeps its failure and the step it failed in (PR #928); a
//! deploy's record keeps what its run said (`outcome`) and, for a refusal,
//! its `reason`. Neither is a code: they are the words the run wrote. This
//! reads them for the causes a person can do something about -- a gear that
//! did not build, a configuration secret nobody set, a quota or a hardware
//! limit, a Research sign-in that ran out, an image the cluster could not
//! pull, a cluster that did not answer, an application that keeps crashing --
//! and names the action for each. Anything else is `UNKNOWN`, with the log
//! as the action. No I/O: the routes put it beside the record they answer.

use std::sync::LazyLock;

use regex::Regex;

/// A gear's diagnostic names it as ``gear `id` `` (gearbox), a Rust build as
/// ``could not compile `crate` ``.
static GEAR: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:\bgear `([^`]+)`|could not compile `([^`]+)`)").expect("a valid pattern")
});

/// A secret the chart reads that nobody made: `secret NAME (KEY) is read by
/// the chart` (preflight), `secret "NAME" not found`, `couldn't find key KEY
/// in Secret`, a configuration secret named as missing.
static SECRET: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)(?:couldn't find key ([A-Za-z0-9_.-]+) in secret|secret "?([A-Za-z0-9_.-]+)"? not found|secret ([A-Za-z0-9_.-]+)(?: \(([^)]*)\))? is read by the chart|missing (?:configuration )?secrets?:? ([A-Z][A-Z0-9_]+))"#,
    )
    .expect("a valid pattern")
});

/// One thing to do about a failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FailureAction {
    /// `open_gear`, `retry`, `provide_secret`, `choose_hardware`,
    /// `ask_organization`, `sign_in`, `check_environment`, `open_log`.
    pub kind: &'static str,
    /// What the button says.
    pub label: String,
    /// The gear to open, for `open_gear`.
    pub gear: Option<String>,
    /// The configuration secret to provide, for `provide_secret`.
    pub key: Option<String>,
}

impl FailureAction {
    fn new(kind: &'static str, label: &str) -> Self {
        Self {
            kind,
            label: label.to_owned(),
            gear: None,
            key: None,
        }
    }
}

/// Why it failed, and what fixes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FailureCause {
    /// `GEAR_BUILD_FAILED`, `SECRET_MISSING`, `QUOTA_OR_HARDWARE_LIMIT`,
    /// `RESEARCH_SIGN_IN_EXPIRED`, `IMAGE_PULL_FAILED`,
    /// `CLUSTER_UNREACHABLE`, `CONNECTION_UNREADABLE`, `APP_CRASHED`,
    /// `UNKNOWN`.
    pub code: &'static str,
    /// One sentence: what went wrong.
    pub summary: String,
    /// The gear that did not build, when the failure names one.
    pub gear: Option<String>,
    /// The configuration secret that is missing, when the failure names one.
    pub key: Option<String>,
    /// The lines of the failure that matter, at most [`MAX_LINES`].
    pub lines: Vec<String>,
    /// What to do, the first one first.
    pub actions: Vec<FailureAction>,
}

/// How many lines of a failure a cause keeps.
pub const MAX_LINES: usize = 6;

/// Whether a build or a deploy failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Of {
    Build,
    Deploy,
}

fn has(text: &str, any: &[&str]) -> bool {
    let lower = text.to_lowercase();
    any.iter().any(|n| lower.contains(&n.to_lowercase()))
}

/// The lines that say what went wrong: the ones that name an error, else the
/// first ones.
fn telling_lines(text: &str) -> Vec<String> {
    let all: Vec<&str> = text
        .lines()
        .flat_map(|l| l.split("; "))
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    let telling: Vec<&str> = all
        .iter()
        .copied()
        .filter(|l| {
            has(
                l,
                &[
                    "error",
                    "failed",
                    "fatal",
                    "not found",
                    "denied",
                    "quota",
                    "exceed",
                    "cannot",
                    "could not",
                    "lacks",
                    "gear `",
                ],
            )
        })
        .collect();
    let chosen = if telling.is_empty() { all } else { telling };
    chosen
        .into_iter()
        .take(MAX_LINES)
        .map(|l| match l.char_indices().nth(300) {
            Some((i, _)) => format!("{}…", &l[..i]),
            None => l.to_owned(),
        })
        .collect()
}

/// Why `text` -- a build's failure or a deploy's outcome or reason -- says it
/// failed. `step` is the build's failure step (`start` when it never reached
/// the cluster); `research` whether it ran in Constructor Research.
pub fn explain(of: Of, text: &str, step: Option<&str>, research: bool) -> FailureCause {
    let lines = telling_lines(text);
    let retry_label = match of {
        Of::Build => "Build again",
        Of::Deploy => "Deploy again",
    };
    let cause = |code, summary: String, actions| FailureCause {
        code,
        summary,
        gear: None,
        key: None,
        lines: lines.clone(),
        actions,
    };

    // A Research sign-in that ran out: nothing else works until it is renewed.
    if has(
        text,
        &[
            "ENVIRONMENT_RESEARCH_NOT_SIGNED_IN",
            "research connection cannot be used",
            "invalid_grant",
            "refresh token",
            "sign-in has run out",
            "sign in again",
        ],
    ) || (research
        && has(
            text,
            &["401", "unauthorized", "token expired", "expired token"],
        ))
    {
        return cause(
            "RESEARCH_SIGN_IN_EXPIRED",
            "Your Constructor Research sign-in has run out or was withdrawn, so Studio could \
             not act for you there."
                .to_owned(),
            vec![FailureAction::new(
                "sign_in",
                "Sign in to Constructor Research again",
            )],
        );
    }

    if has(
        text,
        &[
            "quota",
            "insufficient",
            "limit exceeded",
            "exceeds the limit",
            "exceeded",
            "out of capacity",
            "no capacity",
            "not enough",
            "hardware is not available",
            "trial has ended",
            "trial ended",
        ],
    ) {
        let summary = if research {
            "Constructor Research refused the hardware: the project's quota or the chosen \
             configuration's limit is reached."
        } else {
            "The cluster refused it: a quota or a resource limit of the namespace is reached."
        };
        let mut actions = Vec::new();
        if research {
            actions.push(FailureAction::new(
                "choose_hardware",
                "Choose other hardware",
            ));
        }
        actions.push(FailureAction::new(
            "ask_organization",
            "Ask the organization for more",
        ));
        return cause("QUOTA_OR_HARDWARE_LIMIT", summary.to_owned(), actions);
    }

    if let Some(c) = SECRET.captures(text) {
        // The key a person sets, before the secret it goes into.
        let first_key = c
            .get(4)
            .and_then(|m| m.as_str().split(',').next())
            .map(|k| k.trim().to_owned());
        let key = c
            .get(1)
            .map(|m| m.as_str().to_owned())
            .or(first_key)
            .or_else(|| {
                [2, 3, 5]
                    .into_iter()
                    .find_map(|i| c.get(i))
                    .map(|m| m.as_str().to_owned())
            });
        let mut provide = FailureAction::new("provide_secret", "Provide the secret");
        provide.key.clone_from(&key);
        let mut out = cause(
            "SECRET_MISSING",
            match &key {
                Some(k) => format!("The product reads the secret {k}, and nothing sets it."),
                None => "The product reads a secret nothing sets.".to_owned(),
            },
            vec![provide, FailureAction::new("retry", retry_label)],
        );
        out.key = key;
        return out;
    }
    if has(text, &["CreateContainerConfigError"]) {
        return cause(
            "SECRET_MISSING",
            "A container could not start: its configuration names a secret or a key that is \
             not there."
                .to_owned(),
            vec![
                FailureAction::new("provide_secret", "Provide the secret"),
                FailureAction::new("retry", retry_label),
            ],
        );
    }

    if of == Of::Build
        && let Some(c) = GEAR.captures(text)
    {
        let gear = c.get(1).or_else(|| c.get(2)).map(|m| m.as_str().to_owned());
        let mut open = FailureAction::new("open_gear", "Open the gear");
        open.gear.clone_from(&gear);
        let mut out = cause(
            "GEAR_BUILD_FAILED",
            match &gear {
                Some(g) => format!("Gear {g} did not build; the build around it is fine."),
                None => "A gear did not build.".to_owned(),
            },
            vec![open, FailureAction::new("retry", retry_label)],
        );
        out.gear = gear;
        return out;
    }

    if has(
        text,
        &[
            "ImagePullBackOff",
            "ErrImagePull",
            "manifest unknown",
            "pull access denied",
            "InvalidImageName",
        ],
    ) {
        return cause(
            "IMAGE_PULL_FAILED",
            "The cluster could not pull the product's image: it is not in the registry, or \
             the environment's pull login cannot read it."
                .to_owned(),
            vec![
                FailureAction::new("check_environment", "Check the environment"),
                FailureAction::new("retry", retry_label),
            ],
        );
    }

    if has(
        text,
        &[
            "PERSONAL",
            "UNREADABLE",
            "not readable",
            "personal connection",
        ],
    ) {
        return cause(
            "CONNECTION_UNREADABLE",
            "Studio could not read a connection the run needs as the organization's service: \
             most often a personal connection to the repository or the registry."
                .to_owned(),
            vec![FailureAction::new(
                "check_environment",
                "Check the connections",
            )],
        );
    }

    if step == Some("start")
        || has(
            text,
            &[
                "CLUSTER_UNREACHABLE",
                "did not answer",
                "connection refused",
                "CLUSTER_CANNOT",
                "CLUSTER_NOT_BOOTSTRAPPED",
                "NAMESPACE_NOT_ASSIGNED",
                "CLUSTER_NAMESPACE_RIGHTS_MISSING",
            ],
        )
    {
        return cause(
            "CLUSTER_UNREACHABLE",
            "It never reached the cluster: the environment's cluster did not answer, or its \
             connection may not do what the run needs there."
                .to_owned(),
            vec![
                FailureAction::new("check_environment", "Check the environment"),
                FailureAction::new("retry", retry_label),
            ],
        );
    }

    if has(
        text,
        &[
            "CrashLoopBackOff",
            "restarted",
            "keeps crashing",
            "does not answer",
            "did not become ready",
        ],
    ) {
        return cause(
            "APP_CRASHED",
            "The application started and then stopped or did not answer: its log says why."
                .to_owned(),
            vec![
                FailureAction::new("open_log", "Open the log"),
                FailureAction::new("retry", retry_label),
            ],
        );
    }

    cause(
        "UNKNOWN",
        match of {
            Of::Build => "The build failed; its log says why.".to_owned(),
            Of::Deploy => "The deploy failed; its log says why.".to_owned(),
        },
        vec![
            FailureAction::new("open_log", "Open the log"),
            FailureAction::new("retry", retry_label),
        ],
    )
}

/// The first public address in a Research deploy's outcome
/// (`… runs in Constructor Research: https://a, https://b`).
pub fn public_url(outcome: &str) -> Option<String> {
    outcome
        .split(|c: char| c.is_whitespace() || c == ',' || c == ';' || c == '(' || c == ')')
        .find(|w| w.starts_with("https://") || w.starts_with("http://"))
        .map(|w| w.trim_end_matches(['.', ',']).to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_gear_that_did_not_build_is_named_with_open_gear_then_retry() {
        let c = explain(
            Of::Build,
            "generate failed\nerror: gear `billing` · help: the field `currency` is required\nwarning: x",
            Some("prepare"),
            false,
        );
        assert_eq!(c.code, "GEAR_BUILD_FAILED");
        assert_eq!(c.gear.as_deref(), Some("billing"));
        assert_eq!(c.actions[0].kind, "open_gear");
        assert_eq!(c.actions[0].gear.as_deref(), Some("billing"));
        assert_eq!(c.actions[1].kind, "retry");
        assert!(c.lines.iter().any(|l| l.contains("gear `billing`")));
        assert!(!c.lines.iter().any(|l| l.starts_with("warning")));

        let rust = explain(
            Of::Build,
            "error: could not compile `shop-api`",
            None,
            false,
        );
        assert_eq!(rust.gear.as_deref(), Some("shop-api"));
    }

    #[test]
    fn a_missing_secret_names_its_key_and_offers_to_provide_it() {
        let c = explain(
            Of::Deploy,
            "namespace shop-dev lacks what the chart reads, so its pods could not start: secret \
             shop-smtp (SMTP_PASSWORD) is read by the chart and nothing creates it",
            None,
            false,
        );
        assert_eq!(c.code, "SECRET_MISSING");
        assert_eq!(c.key.as_deref(), Some("SMTP_PASSWORD"));
        assert_eq!(c.actions[0].kind, "provide_secret");

        let k = explain(
            Of::Deploy,
            "pod a container b: CreateContainerConfigError: couldn't find key SMTP_PASSWORD in Secret shop/x",
            None,
            false,
        );
        assert_eq!(k.key.as_deref(), Some("SMTP_PASSWORD"));
    }

    #[test]
    fn a_quota_in_research_offers_other_hardware_and_the_organization() {
        let c = explain(
            Of::Deploy,
            "Research refused the service: GPU quota exceeded for project ml-team",
            None,
            true,
        );
        assert_eq!(c.code, "QUOTA_OR_HARDWARE_LIMIT");
        let kinds: Vec<_> = c.actions.iter().map(|a| a.kind).collect();
        assert_eq!(kinds, ["choose_hardware", "ask_organization"]);
        // On a cluster there is no hardware to choose.
        let k = explain(Of::Deploy, "exceeded quota: compute-resources", None, false);
        assert_eq!(k.actions[0].kind, "ask_organization");
    }

    #[test]
    fn an_expired_research_sign_in_asks_to_sign_in_again() {
        let c = explain(
            Of::Deploy,
            "the Constructor Research connection cannot be used: invalid_grant",
            None,
            true,
        );
        assert_eq!(c.code, "RESEARCH_SIGN_IN_EXPIRED");
        assert_eq!(c.actions[0].kind, "sign_in");
        // A 401 means the sign-in only in Research.
        assert_eq!(
            explain(Of::Deploy, "HTTP 401 Unauthorized", None, true).code,
            "RESEARCH_SIGN_IN_EXPIRED"
        );
        assert_ne!(
            explain(Of::Deploy, "HTTP 401 Unauthorized", None, false).code,
            "RESEARCH_SIGN_IN_EXPIRED"
        );
    }

    #[test]
    fn a_build_that_never_started_points_at_the_environment() {
        let c = explain(
            Of::Build,
            "the Job could not be created",
            Some("start"),
            false,
        );
        assert_eq!(c.code, "CLUSTER_UNREACHABLE");
        assert_eq!(c.actions[0].kind, "check_environment");
        let p = explain(
            Of::Build,
            "REPOSITORY_CONNECTION_PERSONAL: the repository is reached through a personal connection",
            Some("start"),
            false,
        );
        assert_eq!(p.code, "CONNECTION_UNREADABLE");
    }

    #[test]
    fn pull_and_crash_and_anything_else() {
        assert_eq!(
            explain(
                Of::Deploy,
                "pod x container y: ImagePullBackOff",
                None,
                false
            )
            .code,
            "IMAGE_PULL_FAILED"
        );
        assert_eq!(
            explain(
                Of::Deploy,
                "pod x container y: CrashLoopBackOff, restarted 5 times",
                None,
                false
            )
            .code,
            "APP_CRASHED"
        );
        let u = explain(Of::Deploy, "helm said no", None, false);
        assert_eq!(u.code, "UNKNOWN");
        assert_eq!(u.lines, ["helm said no"]);
        assert_eq!(u.actions[0].kind, "open_log");
    }

    #[test]
    fn a_research_outcome_gives_its_first_public_address() {
        assert_eq!(
            public_url(
                "shop-dev runs in Constructor Research: https://shop.research.example/app, https://b.example (note: x)"
            )
            .as_deref(),
            Some("https://shop.research.example/app")
        );
        assert_eq!(
            public_url("shop runs in Constructor Research: no public address"),
            None
        );
    }
}
