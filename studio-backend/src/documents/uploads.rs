//! Sources a member uploads for the project domain model to read — CSV, JSON
//! or plain text — without committing them to the repository
//! (`docs/project-domain-model.md`, "Uploaded sources").
//!
//! Pure: what is accepted and how it is kept. An upload is read under
//! `upload:<name>`, like a repository file under its path, so it takes part
//! in builds and in selection; its revision is the hash of its content, as
//! for any document.

/// The prefix the model reads an upload under.
pub const PREFIX: &str = "upload:";

/// The largest upload, after a JSON file is laid out one value per line.
pub const MAX_BYTES: usize = 512 * 1024;

/// The most uploads one project keeps.
pub const MAX_PER_PROJECT: usize = 50;

/// The longest name.
const NAME_MAX: usize = 120;

/// An upload as it is kept.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Accepted {
    /// The name, trimmed.
    pub name: String,
    /// `csv`, `json` or `text`.
    pub kind: &'static str,
    /// The text read: as uploaded, but a JSON file laid out with one value
    /// per line so its passages can be quoted by line.
    pub content: String,
}

/// The path the model reads an upload under.
pub fn path_of(name: &str) -> String {
    format!("{PREFIX}{name}")
}

/// The MIME type an upload is stored as.
pub fn mime(kind: &str) -> &'static str {
    match kind {
        "csv" => "text/csv",
        "json" => "application/json",
        _ => "text/plain",
    }
}

/// Whether `name` and `content` make an upload, and what is kept. `Err` says
/// why not, in a sentence.
pub fn accept(name: &str, content: &str) -> Result<Accepted, String> {
    let name = name.trim();
    let well_named = !name.is_empty()
        && name.chars().count() <= NAME_MAX
        && !name.starts_with('.')
        && !name.contains("..")
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || " -_.()".contains(c));
    if !well_named {
        return Err(format!(
            "a name of at most {NAME_MAX} characters: letters, digits, spaces and - _ . ( )"
        ));
    }
    let ext = name
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    let kind = match ext.as_str() {
        "csv" | "tsv" => "csv",
        "json" => "json",
        "txt" | "text" => "text",
        _ => {
            return Err(
                "only CSV (.csv, .tsv), JSON (.json) and plain text (.txt) are read".to_owned(),
            );
        }
    };
    if content.trim().is_empty() {
        return Err("the file is empty".to_owned());
    }
    if content.contains('\0') {
        return Err("the file is not text".to_owned());
    }
    let content = if kind == "json" {
        let value: serde_json::Value =
            serde_json::from_str(content).map_err(|e| format!("the file is not JSON: {e}"))?;
        serde_json::to_string_pretty(&value).map_err(|e| e.to_string())? + "\n"
    } else {
        content.replace("\r\n", "\n")
    };
    if content.len() > MAX_BYTES {
        return Err(format!("at most {} KiB", MAX_BYTES / 1024));
    }
    Ok(Accepted {
        name: name.to_owned(),
        kind,
        content,
    })
}

#[cfg(test)]
#[path = "uploads_tests.rs"]
mod tests;
