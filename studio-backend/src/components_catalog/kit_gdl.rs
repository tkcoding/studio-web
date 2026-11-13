//! A kit's passport, `kit.gdl` (GDL 1.6, ADR-0061), read without evaluating
//! it.
//!
//! A kit -- specification templates, workflows and the rules that check them,
//! installed into a project by `cfs` -- says what it is in one file beside its
//! `.cf-studio-kit.toml`, one passport per kit:
//!
//! ```text
//! gdl_version = "1.6"
//!
//! kit(
//!     name = "sdlc",
//!     title = "Software Delivery Lifecycle",
//!     version = "1.4.0",
//!     description = "Product-to-code traceability with PRD, ADR and DESIGN workflows",
//!     publisher = "Constructor Fabric",
//!     visibility = "public",
//!     manifest = ".cf-studio-kit.toml",
//!     kinds = ["PRD", "ADR", "DESIGN", "FEATURE"],
//!     docs = ["README.md"],
//! )
//! ```
//!
//! `name` is the slug the kit registry and the installer know it by, and the
//! only argument required. The installer still reads the manifest; the
//! passport is what the catalogue shows and versions.
//!
//! GDL 1.7 (ADR-0068 phase 5) adds what a kit with screens says: `levels`,
//! where it may be installed, and `mfe`, its built FrontX bundles, each a
//! directory `mfe/<package>` beside the passport, as `path("mfe/<package>")`
//! or a list of them. `studio-kits` serves those bundles to the shell
//! (`kit_registry/bundles.rs`).
//!
//! ```text
//! gdl_version = "1.7"
//!
//! kit(
//!     name = "hello-kit",
//!     title = "Hello",
//!     version = "0.1.0",
//!     levels = ["organization", "project"],
//!     mfe = [path("mfe/hello")],
//! )
//! ```

use super::gdl_literal::{self, Args, Lit};

/// The GDL version `kit.gdl` was introduced in.
pub(crate) const GDL_VERSION: &str = "1.6";

/// The file that marks a kit.
pub(crate) const FILE: &str = "kit.gdl";

/// What a `kit.gdl` declares.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct KitPassport {
    /// Its slug: what a project installs it by.
    pub name: String,
    /// What a person calls it.
    pub title: Option<String>,
    pub version: Option<String>,
    pub description: Option<String>,
    pub publisher: Option<String>,
    /// `public` or `private`.
    pub visibility: Option<String>,
    /// The installer's manifest, relative to the passport's directory.
    pub manifest: Option<String>,
    /// The kinds of artifact it brings templates and rules for.
    pub kinds: Vec<String>,
    /// Its documents, relative to the passport's directory.
    pub docs: Vec<String>,
    /// The levels it may be installed on (GDL 1.7): `platform`,
    /// `organization`, `workspace`, `project`.
    pub levels: Vec<String>,
    /// Its built micro-frontend bundles (GDL 1.7), relative to the passport's
    /// directory.
    pub mfe: Vec<String>,
}

/// The levels a kit may name.
pub(crate) const LEVELS: [&str; 4] = ["platform", "organization", "workspace", "project"];

const ARGS: [&str; 11] = [
    "name",
    "title",
    "version",
    "description",
    "publisher",
    "visibility",
    "manifest",
    "kinds",
    "docs",
    "levels",
    "mfe",
];

/// `mfe`: one `path(...)` or a list of them, each relative to the passport.
fn bundles(a: &Args) -> Result<Vec<String>, String> {
    let paths = match a.get("mfe") {
        None | Some((Lit::None, _)) => return Ok(Vec::new()),
        Some((Lit::Str(one), _)) => vec![one.clone()],
        Some((Lit::List(many), _)) => many.clone(),
        Some((_, l)) => {
            return Err(format!(
                "line {l}: `mfe` is a path or a list of paths: `mfe = [path(\"mfe/app\")]`"
            ));
        }
    };
    let line = a.get("mfe").map_or(0, |(_, l)| l);
    for p in &paths {
        gdl_literal::relative_path(p).map_err(|e| format!("line {line}: mfe: \"{p}\" {e}"))?;
    }
    Ok(paths)
}

/// Read a `kit.gdl`. `Err` says why it is not one this reads.
pub(crate) fn read(src: &str) -> Result<KitPassport, String> {
    let call = gdl_literal::read_call(src, FILE, &["kit"], GDL_VERSION)?;
    let a = Args { call: &call };
    a.only(&ARGS)?;
    let name = a.string("name", gdl_literal::kebab)?.ok_or_else(|| {
        format!(
            "line {}: `kit()` must name itself: `name = \"…\"`",
            call.line
        )
    })?;
    Ok(KitPassport {
        name,
        title: a.string("title", gdl_literal::one_line)?,
        version: a.string("version", gdl_literal::word)?,
        description: a.string("description", gdl_literal::one_line)?,
        publisher: a.string("publisher", gdl_literal::one_line)?,
        visibility: a.string("visibility", |v| {
            if matches!(v, "public" | "private") {
                Ok(())
            } else {
                Err("is not \"public\" or \"private\"".into())
            }
        })?,
        manifest: a.string("manifest", gdl_literal::relative_path)?,
        kinds: a.list("kinds", gdl_literal::word)?.unwrap_or_default(),
        docs: a
            .list("docs", gdl_literal::relative_path)?
            .unwrap_or_default(),
        levels: a
            .list("levels", |v| {
                if LEVELS.contains(&v) {
                    Ok(())
                } else {
                    Err(format!("is not a level ({})", LEVELS.join(", ")))
                }
            })?
            .unwrap_or_default(),
        mfe: bundles(&a)?,
    })
}

#[cfg(test)]
#[path = "kit_gdl_tests.rs"]
mod tests;
