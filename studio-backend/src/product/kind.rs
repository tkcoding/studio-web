//! What the product is, proposed from the project's specs.
//!
//! A project does not say at creation what it will be. What it is built on,
//! and so how it is built and rolled out, is decided once its specs say what
//! is wanted: Studio proposes a kind with the reasons it read, and a member
//! confirms it or picks another. The choice is kept in the project's
//! configuration as `product_kind`.
//!
//! Moved from the portal (`product-kind.ts`), which read the proposal in the
//! browser "until a backend route proposes one". Experimental, as it was: the
//! rules are word matches and counts, and say so in their reasons. Pure: the
//! route reads the facts as the caller (`product_kind_rest`), this weighs
//! them.

use std::collections::BTreeSet;
use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

/// What a product can be.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Kind {
    GearProduct,
    GearService,
    FrontxApp,
    SourceBuilt,
}

/// The kinds in the order the portal lists them.
pub const KINDS: [Kind; 4] = [
    Kind::GearProduct,
    Kind::GearService,
    Kind::FrontxApp,
    Kind::SourceBuilt,
];

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::GearProduct => "gear_product",
            Kind::GearService => "gear_service",
            Kind::FrontxApp => "frontx_app",
            Kind::SourceBuilt => "source_built",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        KINDS.into_iter().find(|k| k.as_str() == raw)
    }

    pub fn title(self) -> &'static str {
        match self {
            Kind::GearProduct => "Full product on gears",
            Kind::GearService => "Gear service",
            Kind::FrontxApp => "FrontX app",
            Kind::SourceBuilt => "Built from its own source",
        }
    }

    /// What it is, in a line.
    pub fn what(self) -> &'static str {
        match self {
            Kind::GearProduct => {
                "Gears for the backend and a FrontX shell with micro-frontends for the screens."
            }
            Kind::GearService => "Gears and their APIs, with no screens of its own.",
            Kind::FrontxApp => {
                "Screens in a FrontX shell over gears the platform or the organization already runs."
            }
            Kind::SourceBuilt => {
                "Its own services, with their own Dockerfiles or CI, not composed from gears."
            }
        }
    }

    /// How it is built and rolled out.
    pub fn builds(self) -> &'static str {
        match self {
            Kind::GearProduct => {
                "Gearbox assembles it from product.gdl; Studio builds the images and the chart and deploys them."
            }
            Kind::GearService => {
                "Gearbox assembles it from product.gdl, with gears only; Studio builds and deploys it."
            }
            Kind::FrontxApp => {
                "The FrontX shell and its micro-frontends are built into one image; product.gdl names the frontend."
            }
            Kind::SourceBuilt => {
                "Its own CI or a BuildKit build of its Dockerfiles; Studio records the images and deploys them."
            }
        }
    }
}

/// The confirmed kind, as the project's configuration keeps it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Choice {
    pub kind: Kind,
    /// What Studio proposed when it was confirmed.
    pub proposed: Option<Kind>,
    pub confirmed_by: Option<String>,
    /// RFC 3339.
    pub confirmed_at: String,
}

/// A stored choice (`project.config` `product_kind`), or none when there is
/// none or it cannot be read.
pub fn read_choice(raw: Option<&Value>) -> Option<Choice> {
    let r = raw?.as_object()?;
    let kind = Kind::parse(r.get("kind")?.as_str()?)?;
    Some(Choice {
        kind,
        proposed: r
            .get("proposed")
            .and_then(Value::as_str)
            .and_then(Kind::parse),
        confirmed_by: r
            .get("confirmed_by")
            .and_then(Value::as_str)
            .map(str::to_string),
        confirmed_at: r
            .get("confirmed_at")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
    })
}

/// The choice as the configuration keeps it.
pub fn choice_value(c: &Choice) -> Value {
    serde_json::json!({
        "kind": c.kind.as_str(),
        "proposed": c.proposed.map(Kind::as_str),
        "confirmed_by": c.confirmed_by,
        "confirmed_at": c.confirmed_at,
    })
}

/// One capability the documents declare, with the documents that declare it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Capability {
    pub key: String,
    pub from: Vec<String>,
}

/// The components the project's own repositories hold, by passport.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Own {
    pub gears: usize,
    pub frontx: usize,
    pub services: usize,
}

/// The product as configured so far.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Configured {
    pub gears: usize,
    pub frontend: bool,
}

/// What the proposal reads. `None` for a read that failed: it then counts as
/// nothing, and the reasons say what could not be read.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Facts {
    pub brief: Option<String>,
    pub capabilities: Option<Vec<Capability>>,
    pub requirements: Option<Vec<String>>,
    pub own: Option<Own>,
    pub product: Option<Configured>,
}

/// How much there was to read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Basis {
    Specs,
    Sources,
    None,
}

impl Basis {
    pub fn as_str(self) -> &'static str {
        match self {
            Basis::Specs => "specs",
            Basis::Sources => "sources",
            Basis::None => "none",
        }
    }
}

/// Studio's proposal.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Proposal {
    pub kind: Kind,
    /// Why, one sentence each, in the order they weigh.
    pub reasons: Vec<String>,
    pub basis: Basis,
    /// The kinds after it, best first.
    pub alternatives: Vec<Kind>,
}

static SCREEN_WORDS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(ui|screens?|pages?|dashboards?|portal|web ?app|frontend|front-end|user interface|forms?|wizard|log ?in|sign[- ]in|mobile|browser|admin panel)\b").expect("constant")
});
static API_WORDS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(apis?|services?|endpoints?|rest|grpc|graphql|backend|back-end|integrations?|webhooks?|workers?|queues?|events?|storage|database|persist\w*|tenants?|authori[sz]\w*)\b").expect("constant")
});
static SOURCE_WORDS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(dockerfiles?|docker|helm|existing (?:app|application|service|system|codebase)|legacy|monolith|spring|django|rails|laravel|\.net|java|node\.?js|golang|python service)\b").expect("constant")
});
static SEPARATORS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[._-]+").expect("constant"));

/// The distinct words a pattern found, lower-cased, at most `n`.
fn found(re: &Regex, text: &str, n: usize) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    for m in re.find_iter(text) {
        let w = m.as_str().to_lowercase();
        if !seen.contains(&w) {
            seen.push(w);
        }
        if seen.len() >= n {
            break;
        }
    }
    seen
}

fn quoted(words: &[String]) -> String {
    words
        .iter()
        .map(|w| format!("\u{201c}{w}\u{201d}"))
        .collect::<Vec<_>>()
        .join(", ")
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

/// Studio's proposal: the kind the facts point to, and why.
pub fn propose(f: &Facts) -> Proposal {
    let mut reasons: Vec<String> = Vec::new();
    let (mut screens, mut apis, mut source) = (0i64, 0i64, 0i64);

    // The specs: the brief, the capabilities and their documents, the
    // requirements. Words only: a capability is named by what it does.
    let mut parts: Vec<String> = vec![f.brief.clone().unwrap_or_default()];
    for c in f.capabilities.iter().flatten() {
        parts.push(SEPARATORS.replace_all(&c.key, " ").into_owned());
        parts.extend(c.from.iter().cloned());
    }
    parts.extend(f.requirements.iter().flatten().cloned());
    let spec_text = parts.join("\n");
    let s = found(&SCREEN_WORDS, &spec_text, 3);
    let a = found(&API_WORDS, &spec_text, 3);
    let o = found(&SOURCE_WORDS, &spec_text, 3);
    let count = |v: &[String]| i64::try_from(v.len()).unwrap_or(i64::MAX);
    if !s.is_empty() {
        screens += count(&s);
        reasons.push(format!("The specs speak of screens: {}.", quoted(&s)));
    }
    if !a.is_empty() {
        apis += count(&a);
        reasons.push(format!("They speak of services and data: {}.", quoted(&a)));
    }
    if !o.is_empty() {
        source += count(&o) * 2;
        reasons.push(format!("They speak of code of its own: {}.", quoted(&o)));
    }
    let caps = f.capabilities.as_ref().map_or(0, Vec::len);
    if caps > 0 {
        apis += 1;
        reasons.push(format!(
            "Its documents declare {}, which gears can cover.",
            plural(caps, "capability", "capabilities")
        ));
    }

    // The repositories: what their passports say they hold.
    let own = f.own;
    if let Some(own) = own {
        if own.gears > 0 {
            apis += 2;
            reasons.push(format!(
                "Its repositories hold {} (gear.gdl).",
                plural(own.gears, "gear", "gears")
            ));
        }
        if own.frontx > 0 {
            screens += 2;
            reasons.push(format!(
                "They hold {} (frontx.gdl).",
                plural(own.frontx, "FrontX package", "FrontX packages")
            ));
        }
        if own.services > 0 {
            source += 3;
            reasons.push(format!(
                "They hold {} of their own, not gears (service.gdl).",
                plural(own.services, "service", "services")
            ));
        }
    }

    // The product as configured so far.
    if let Some(p) = f.product {
        if p.gears > 0 {
            apis += 2;
            reasons.push(format!(
                "The product already picks {}.",
                plural(p.gears, "gear", "gears")
            ));
        }
        if p.frontend {
            screens += 2;
            reasons.push("The product already has a frontend.".to_string());
        }
    }

    let unread: Vec<&str> = [
        (f.capabilities.is_none(), "the declared capabilities"),
        (f.requirements.is_none(), "the requirements"),
        (f.own.is_none(), "the project's own components"),
        (f.product.is_none(), "the product"),
    ]
    .into_iter()
    .filter_map(|(missing, what)| missing.then_some(what))
    .collect();
    if !unread.is_empty() {
        reasons.push(format!("Could not read {}.", unread.join(", ")));
    }

    let specs_said = s.len() + a.len() + o.len() + caps > 0;
    let sources_said = own.is_some_and(|o| o.gears + o.frontx + o.services > 0);
    let product_gears = f.product.map_or(0, |p| p.gears);
    let basis = if specs_said {
        Basis::Specs
    } else if sources_said || product_gears > 0 {
        Basis::Sources
    } else {
        Basis::None
    };

    // Own code without gears is built from its own source; gears beside it
    // still make it a product on gears.
    let own_gears = i64::try_from(own.map_or(0, |o| o.gears)).unwrap_or(i64::MAX);
    let picked = i64::try_from(product_gears).unwrap_or(i64::MAX);
    let score = |k: Kind| -> i64 {
        match k {
            Kind::SourceBuilt => source - own_gears * 2 - picked,
            Kind::GearProduct => {
                screens.min(apis) * 2 + if screens > 0 && apis > 0 { 2 } else { 0 }
            }
            Kind::FrontxApp => screens - apis,
            Kind::GearService => apis - screens,
        }
    };

    let kind = if basis == Basis::None {
        reasons.insert(
            0,
            "The specs say too little yet to tell; a full product on gears is where most projects start."
                .to_string(),
        );
        Kind::GearProduct
    } else {
        // The browser sorted its score object's entries stably, so a tie
        // goes to the earlier of gear_product, gear_service, frontx_app,
        // source_built.
        let mut best = KINDS[0];
        for k in KINDS {
            if score(k) > score(best) {
                best = k;
            }
        }
        if score(best) <= 0 {
            Kind::GearProduct
        } else {
            best
        }
    };
    let mut alternatives: Vec<Kind> = KINDS.into_iter().filter(|k| *k != kind).collect();
    alternatives.sort_by_key(|k| std::cmp::Reverse(score(*k)));
    Proposal {
        kind,
        reasons,
        basis,
        alternatives,
    }
}

/// The step as the project's path shows it: confirmed, proposed, or waiting
/// for the specs.
pub fn status(choice: Option<&Choice>, proposal: Option<&Proposal>) -> (bool, String) {
    if let Some(c) = choice {
        let against = match c.proposed {
            Some(p) if p != c.kind => format!(" (Studio proposed {})", p.title()),
            _ => String::new(),
        };
        return (true, format!("{}, confirmed{against}.", c.kind.title()));
    }
    let Some(p) = proposal else {
        return (false, "Not decided yet.".to_string());
    };
    let text = if p.basis == Basis::None {
        format!(
            "Not decided yet: the specs say too little, so Studio proposes {}.",
            p.kind.title()
        )
    } else {
        format!(
            "Not decided yet: Studio proposes {}. Confirm it or pick another.",
            p.kind.title()
        )
    };
    (false, text)
}

/// The capabilities' document titles, each once.
pub fn titles(labels: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    labels
        .into_iter()
        .filter(|l| seen.insert(l.clone()))
        .collect()
}

#[cfg(test)]
#[path = "kind_tests.rs"]
mod tests;
