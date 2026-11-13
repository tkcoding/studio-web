//! Which documents a build reads when a person names them: one `path`, a
//! list of `paths`, a `glob`, or any of them together
//! (`docs/project-domain-model.md`, "A build").
//!
//! Pure: the documents are the model's own ([`super::SourceText`]), so a
//! name that is not one of them is reported, never guessed at.

use std::collections::BTreeSet;

use super::SourceText;

/// The longest list of paths one build takes.
pub const PATHS_MAX: usize = 500;

/// The longest glob taken.
pub const GLOB_MAX: usize = 300;

/// What a person asked a build to read.
#[derive(Clone, Copy, Debug, Default)]
pub struct Selection<'a> {
    pub path: Option<&'a str>,
    pub paths: &'a [String],
    pub glob: Option<&'a str>,
}

impl Selection<'_> {
    /// Nothing named: the build reads every document not read at its
    /// revision.
    pub fn is_empty(&self) -> bool {
        self.path.is_none_or(|p| p.trim().is_empty())
            && self.paths.iter().all(|p| p.trim().is_empty())
            && self.glob.is_none_or(|g| g.trim().is_empty())
    }
}

/// Why a selection reads nothing: the paths that are not documents of the
/// model, and the glob when it matches none.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Unknown {
    pub paths: Vec<String>,
    pub glob: Option<String>,
}

impl Unknown {
    pub fn is_empty(&self) -> bool {
        self.paths.is_empty() && self.glob.is_none()
    }

    /// In a sentence, for the refusal.
    pub fn message(&self) -> String {
        let mut parts = Vec::new();
        if !self.paths.is_empty() {
            parts.push(format!(
                "not a document of the project's model: {}",
                self.paths.join(", ")
            ));
        }
        if let Some(g) = &self.glob {
            parts.push(format!("`{g}` matches no document of the project's model"));
        }
        parts.join("; ")
    }
}

/// The documents `selection` names, in the model's order, each once. `Err`
/// names every path that is not one of `documents` and a glob that matches
/// none of them: a build reads all of what it was asked or nothing.
pub fn select(
    documents: &[SourceText],
    selection: Selection<'_>,
) -> Result<Vec<SourceText>, Unknown> {
    let known: BTreeSet<&str> = documents.iter().map(|d| d.path.as_str()).collect();
    let mut wanted: BTreeSet<String> = BTreeSet::new();
    let mut unknown = Unknown::default();
    let named = selection
        .path
        .into_iter()
        .chain(selection.paths.iter().map(String::as_str))
        .map(str::trim)
        .filter(|p| !p.is_empty());
    for p in named {
        if known.contains(p) {
            wanted.insert(p.to_owned());
        } else if !unknown.paths.iter().any(|u| u == p) {
            unknown.paths.push(p.to_owned());
        }
    }
    if let Some(glob) = selection.glob.map(str::trim).filter(|g| !g.is_empty()) {
        let matched: Vec<&str> = known
            .iter()
            .copied()
            .filter(|p| glob_match(glob, p))
            .collect();
        if matched.is_empty() {
            unknown.glob = Some(glob.to_owned());
        }
        wanted.extend(matched.into_iter().map(str::to_owned));
    }
    if !unknown.is_empty() {
        return Err(unknown);
    }
    Ok(documents
        .iter()
        .filter(|d| wanted.contains(&d.path))
        .cloned()
        .collect())
}

/// Whether `path` matches `pattern`, segment by segment: `**` is any number
/// of whole segments (none included), `*` any run of characters within one
/// segment, `?` one character; everything else is itself.
pub fn glob_match(pattern: &str, path: &str) -> bool {
    let pattern: Vec<&str> = pattern.split('/').filter(|s| !s.is_empty()).collect();
    let path: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    segments_match(&pattern, &path)
}

fn segments_match(pattern: &[&str], path: &[&str]) -> bool {
    match pattern.split_first() {
        None => path.is_empty(),
        Some((&"**", rest)) => (0..=path.len()).any(|skip| segments_match(rest, &path[skip..])),
        Some((first, rest)) => match path.split_first() {
            Some((seg, path_rest)) => segment_match(first, seg) && segments_match(rest, path_rest),
            None => false,
        },
    }
}

fn segment_match(pattern: &str, segment: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let s: Vec<char> = segment.chars().collect();
    // Classic wildcard matching with one backtrack point for `*`.
    let (mut pi, mut si) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while si < s.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == s[si]) {
            pi += 1;
            si += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some((pi, si));
            pi += 1;
        } else if let Some((sp, ss)) = star {
            pi = sp + 1;
            si = ss + 1;
            star = Some((sp, ss + 1));
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

#[cfg(test)]
#[path = "select_tests.rs"]
mod tests;
