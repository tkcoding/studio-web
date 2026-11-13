//! Where each requirement is cited: the documents that refer to it, the code
//! that names it, the tests that name it (`docs/project-domain-model.md`,
//! "From requirement to code and test"; issue #738).
//!
//! Mechanical, as the work links are: a file cites a requirement when it
//! names the identifier as a whole token. No model guesses which code
//! implements what. A test is told from code by its path, the conventions of
//! the common languages; nothing about a project is assumed beyond them.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use uuid::Uuid;

use super::SourceText;
use super::index::SourceDoc;
use super::requirements::Requirement;
use super::work::{is_part, is_token, named_at, names};

/// One place an identifier is named.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cited {
    pub path: String,
    /// The first line that names it, from 1.
    pub line: usize,
}

/// One requirement and every place that names it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Trace {
    pub requirement: Requirement,
    /// Other documents (and other places in its own) that refer to it.
    pub documents: Vec<Cited>,
    /// Code that names it, tests left out.
    pub code: Vec<Cited>,
    pub tests: Vec<Cited>,
}

/// The most places of one kind kept per requirement.
const PER_KIND: usize = 20;

/// Whether a path is a test by the conventions of the common languages.
pub fn is_test_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    let name = lower.rsplit('/').next().unwrap_or(&lower);
    let in_test_dir = lower.split('/').any(|d| {
        matches!(
            d,
            "test" | "tests" | "__tests__" | "spec" | "e2e" | "testdata"
        )
    });
    in_test_dir
        || name.ends_with("_test.rs")
        || name.ends_with("_tests.rs")
        || name.ends_with("_test.go")
        || name.ends_with("_test.py")
        || name.starts_with("test_")
        || [".test.", ".spec."].iter().any(|m| name.contains(m))
        || name.ends_with("test.java")
        || name.ends_with("tests.cs")
}

/// Whether a path is something a requirement can be implemented in: source
/// code and configuration, not prose or data dumps.
pub(crate) fn is_code_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    const CODE: [&str; 22] = [
        ".rs", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".go", ".py", ".java", ".kt", ".cs", ".rb",
        ".php", ".swift", ".scala", ".c", ".cc", ".cpp", ".h", ".sql", ".proto", ".gdl",
    ];
    CODE.iter().any(|ext| lower.ends_with(ext))
}

/// The largest file a trace reads. Nobody writes a source file of a
/// megabyte by hand; a file that size is a bundle or a dump, and one of them
/// cost more to scan than the rest of a checkout.
pub(crate) const TRACED_BYTES_MAX: usize = 1 << 20;

/// Directories whose files a build or a package manager wrote: a bundle in
/// `dist/` repeats the identifiers of the source it was built from, so it
/// would only cite the same requirement twice, and it is most of the text.
const GENERATED_DIRS: [&str; 8] = [
    "dist",
    "build",
    "out",
    "target",
    "node_modules",
    "vendor",
    ".next",
    "coverage",
];

/// Whether a path is generated or vendored rather than written in the
/// project: under one of [`GENERATED_DIRS`], minified, or a source map.
pub(crate) fn is_generated_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    let mut segments = lower.split('/');
    let name = segments.next_back().unwrap_or_default();
    segments.any(|d| GENERATED_DIRS.contains(&d))
        || name.contains(".min.")
        || name.ends_with(".map")
}

/// Whether a trace reads the file at `path` at all: code or a test, written
/// in the project. What a checkout read for the trace asks the text of, so
/// the rest of a repository is never loaded.
pub(crate) fn is_traced_path(path: &str) -> bool {
    (is_code_path(path) || is_test_path(path)) && !is_generated_path(path)
}

/// Whether a trace reads this file: a traced path, and no larger than
/// [`TRACED_BYTES_MAX`] (which only the text, once read, can tell).
pub(crate) fn is_traced(path: &str, text: &str) -> bool {
    text.len() <= TRACED_BYTES_MAX && is_traced_path(path)
}

fn first_line_naming(text: &str, id: &str) -> Option<usize> {
    let lower_id = id.to_ascii_lowercase();
    text.lines()
        .enumerate()
        .find(|(_, line)| {
            let l = line.to_ascii_lowercase();
            l.contains(&lower_id) && names(&l, &lower_id)
        })
        .map(|(i, _)| i + 1)
}

/// [`first_line_naming`] over a text lower-cased once for every id, rather
/// than line by line for each: the same line, since an id with no line break
/// in it cannot be found across one, and a line's ends read as no token
/// character either way. An id that is empty or holds a carriage return is
/// where the two could differ, so it goes the line-by-line way.
fn first_line_naming_lower(text: &str, lower_text: &str, lower_id: &str) -> Option<usize> {
    if lower_id.is_empty() || lower_id.contains('\r') {
        return first_line_naming(text, lower_id);
    }
    if lower_id.contains('\n') {
        return None;
    }
    let at = named_at(lower_text, lower_id)?;
    Some(
        lower_text.as_bytes()[..at]
            .iter()
            .filter(|&&b| b == b'\n')
            .count()
            + 1,
    )
}

/// The lines of `text` (from 1) naming each of `wanted` (lower-cased ids),
/// at most `keep` per id, read in one pass over the text.
///
/// One buffer is lower-cased into for every token: a checkout holds millions
/// of tokens and almost none is an id, so a string apiece was most of the
/// work. A token longer or shorter than every id is not even copied.
fn lines_naming(text: &str, wanted: &HashSet<String>, keep: usize) -> HashMap<String, Vec<usize>> {
    let mut out: HashMap<String, Vec<usize>> = HashMap::new();
    let shortest = wanted.iter().map(String::len).min().unwrap_or(0);
    let longest = wanted.iter().map(String::len).max().unwrap_or(0);
    let mut lower = String::with_capacity(longest);
    for (i, line) in text.lines().enumerate() {
        for token in line.split(|c: char| !is_part(c)) {
            if token.is_empty() || token.len() < shortest || token.len() > longest {
                continue;
            }
            lower.clear();
            lower.push_str(token);
            lower.make_ascii_lowercase();
            if !wanted.contains(lower.as_str()) {
                continue;
            }
            let add = |at: &mut Vec<usize>| {
                if at.len() < keep && at.last() != Some(&(i + 1)) {
                    at.push(i + 1);
                }
            };
            if let Some(at) = out.get_mut(lower.as_str()) {
                add(at);
            } else {
                let mut at = Vec::new();
                add(&mut at);
                out.insert(lower.clone(), at);
            }
        }
    }
    out
}

/// Every requirement with the places that name it, in the requirements' order.
///
/// Each file is read once, whatever the number of requirements: a project
/// with hundreds of requirements over a checkout of thousands of files asked
/// one scan per pair before, which held a request for a minute and the
/// backend's health check with it.
pub fn trace(
    requirements: &[Requirement],
    docs: &[SourceDoc<'_>],
    files: &[(String, String)],
) -> Vec<Trace> {
    let wanted: HashSet<String> = requirements
        .iter()
        .filter(|r| is_token(&r.id))
        .map(|r| r.id.to_ascii_lowercase())
        .collect();
    // Two lines per document: a definition is not a reference to itself, so
    // the line after it may be the one that counts.
    let in_docs: Vec<HashMap<String, Vec<usize>>> = docs
        .iter()
        .map(|d| lines_naming(d.text, &wanted, 2))
        .collect();
    let sources: Vec<&(String, String)> = files
        .iter()
        .filter(|(path, text)| is_traced(path, text))
        .collect();
    let in_files: Vec<HashMap<String, Vec<usize>>> = sources
        .iter()
        .map(|(_, text)| lines_naming(text, &wanted, 1))
        .collect();
    // An id that is not one token is searched for in every file, once per
    // id: lower-case each file once for all of them, and only when there is
    // such an id at all.
    let lower_files: Vec<String> = if requirements.iter().any(|r| !is_token(&r.id)) {
        sources
            .iter()
            .map(|(_, text)| text.to_ascii_lowercase())
            .collect()
    } else {
        Vec::new()
    };

    requirements
        .iter()
        .map(|r| {
            let key = r.id.to_ascii_lowercase();
            let indexed = wanted.contains(&key);
            let mut documents: Vec<Cited> = docs
                .iter()
                .zip(&in_docs)
                .filter_map(|(d, found)| {
                    let own = d.path == r.path;
                    let line = if indexed {
                        found
                            .get(&key)?
                            .iter()
                            .copied()
                            .find(|&l| !own || l != r.line)?
                    } else {
                        // Its own definition is not a reference to it: look past it.
                        let text: String = if own {
                            d.text
                                .lines()
                                .enumerate()
                                .filter(|(i, _)| i + 1 != r.line)
                                .map(|(_, l)| l)
                                .collect::<Vec<_>>()
                                .join("\n")
                        } else {
                            d.text.to_string()
                        };
                        let line = first_line_naming(&text, &r.id)?;
                        if own && line >= r.line {
                            line + 1
                        } else {
                            line
                        }
                    };
                    Some(Cited {
                        path: d.path.to_string(),
                        line,
                    })
                })
                .collect();
            documents.truncate(PER_KIND);
            let (mut tests, mut code): (Vec<Cited>, Vec<Cited>) = sources
                .iter()
                .zip(&in_files)
                .enumerate()
                .filter_map(|(k, ((path, text), found))| {
                    let line = if indexed {
                        found.get(&key)?.first().copied()?
                    } else {
                        first_line_naming_lower(text, &lower_files[k], &key)?
                    };
                    Some(Cited {
                        path: path.clone(),
                        line,
                    })
                })
                .partition(|c| is_test_path(&c.path));
            code.truncate(PER_KIND);
            tests.truncate(PER_KIND);
            Trace {
                requirement: r.clone(),
                documents,
                code,
                tests,
            }
        })
        .collect()
}

/// A project's trace as `/project-domain-model/trace` answers it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Traced {
    pub traces: Vec<Trace>,
    /// The code and test files read.
    pub files: usize,
}

/// How long a kept trace answers. A trace keeps no state of its own, so an
/// answer this old is only as stale as a code edit that moved no file.
const KEPT_FOR: Duration = Duration::from_secs(10 * 60);

/// The most projects whose trace is kept at once; past it the oldest goes.
const KEPT_MAX: usize = 64;

/// The last trace of each project, under the fingerprint of what it was read
/// from (see [`fingerprint`]).
///
/// Keyed by the workspace and the project the caller was authorized for, so
/// one project's trace is never another's answer; the caller authorizes
/// before it asks.
#[derive(Debug, Default)]
pub struct TraceCache {
    kept: Mutex<HashMap<(Uuid, Uuid), Kept>>,
}

#[derive(Debug)]
struct Kept {
    fingerprint: u64,
    at: Instant,
    traced: Arc<Traced>,
}

impl TraceCache {
    /// The project's kept trace, when it was read from the same documents and
    /// listing and is young enough.
    pub fn get(&self, project: (Uuid, Uuid), fingerprint: u64) -> Option<Arc<Traced>> {
        let kept = self.kept.lock().unwrap_or_else(PoisonError::into_inner);
        kept.get(&project)
            .filter(|k| k.fingerprint == fingerprint && k.at.elapsed() < KEPT_FOR)
            .map(|k| Arc::clone(&k.traced))
    }

    /// Keep a project's trace, in place of the one it had.
    pub fn put(&self, project: (Uuid, Uuid), fingerprint: u64, traced: Arc<Traced>) {
        let mut kept = self.kept.lock().unwrap_or_else(PoisonError::into_inner);
        kept.retain(|_, k| k.at.elapsed() < KEPT_FOR);
        let oldest = (kept.len() >= KEPT_MAX && !kept.contains_key(&project))
            .then(|| kept.iter().min_by_key(|(_, k)| k.at).map(|(p, _)| *p))
            .flatten();
        if let Some(oldest) = oldest {
            kept.remove(&oldest);
        }
        kept.insert(
            project,
            Kept {
                fingerprint,
                at: Instant::now(),
                traced,
            },
        );
    }
}

/// What a trace was read from, as one number: every document's path, type
/// and text, and every path of the checkout. Cheap, since both are read on
/// every call anyway; the code's text is not in it, which is what a kept
/// trace saves reading.
pub fn fingerprint(documents: &[SourceText], tree: &BTreeSet<String>) -> u64 {
    let mut hasher = DefaultHasher::new();
    documents.len().hash(&mut hasher);
    for d in documents {
        d.path.hash(&mut hasher);
        d.doc_type.hash(&mut hasher);
        d.text.hash(&mut hasher);
    }
    tree.len().hash(&mut hasher);
    for path in tree {
        path.hash(&mut hasher);
    }
    hasher.finish()
}

#[cfg(test)]
#[path = "trace_tests.rs"]
mod tests;
