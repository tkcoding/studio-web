//! A fact's review key: what a member's accept or reject on a fact is stored
//! under (`POST /studio-documents/v1/project-domain-model/reviews`).
//!
//! The portal computed it in the browser until the server returned it on
//! every fact. The reviews already stored carry the browser's keys, so this is
//! the browser's algorithm to the bit, not a better one: the kind, the subject
//! folded as the browser folded it, and the aspect and the passage (or the
//! sentence, when there is no passage) with markup and spacing folded away,
//! hashed by a 64-bit FNV-1a variant over UTF-16 code units. Another line
//! number or revision is the same reading; a changed passage is a new one.
//!
//! Two places differ from the rest of the gear on purpose. The subject is
//! folded by splitting on what is not a Unicode letter or number (JavaScript's
//! `[^\p{L}\p{N}]`), where [`super::rules::subject_key`] splits on what is not
//! `char::is_alphanumeric` — the two part on combining marks. And whitespace is
//! JavaScript's `\s`, which counts U+FEFF and not U+0085, where Rust's
//! `char::is_whitespace` does the opposite.

use std::sync::LazyLock;

use regex::Regex;

use super::extract::Fact;

/// Separates the parts of the hashed text (U+001F, the unit separator).
const SEP: char = '\u{1f}';

/// A run of what is not a letter or a number: where a subject splits into
/// words.
static NOT_A_WORD: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[^\p{L}\p{N}]+").expect("a constant pattern"));

/// 64-bit FNV-1a as 16 lowercase hex digits, over the text's UTF-16 code units:
/// two 32-bit lanes, the second fed from the first.
pub fn fnv64(text: &str) -> String {
    let mut h1: u32 = 0x811c_9dc5;
    let mut h2: u32 = 0x050c_5d1f;
    for c in text.encode_utf16() {
        let c = u32::from(c);
        h1 = (h1 ^ c).wrapping_mul(0x0100_0193);
        h2 = (h2 ^ c).wrapping_mul(0x0100_0193);
        h2 = h2.wrapping_add(h1 >> 7);
    }
    format!("{h1:08x}{h2:08x}")
}

/// JavaScript's `\s`: its WhiteSpace and LineTerminator characters.
fn js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0b}' | '\u{0c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// A subject folded as the browser folded it: lower case, split on what is
/// not a letter or a number, articles dropped, a plural `s` dropped from a
/// word longer than three UTF-16 units that does not end in `ss`, `us` or
/// `is`.
pub fn subject_key(subject: &str) -> String {
    let lower = subject.to_lowercase();
    NOT_A_WORD
        .split(&lower)
        .filter(|w| !w.is_empty() && !matches!(*w, "the" | "a" | "an"))
        .map(|w| {
            let plural = w.encode_utf16().count() > 3
                && w.ends_with('s')
                && !["ss", "us", "is"].iter().any(|e| w.ends_with(e));
            if plural { &w[..w.len() - 1] } else { w }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Words as compared: `*`, `` ` ``, `|` and `_` dropped, every run of
/// whitespace one space, trimmed, lower case.
fn words(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut space = false;
    for c in text.chars() {
        if matches!(c, '*' | '`' | '|' | '_') {
            continue;
        }
        if js_space(c) {
            space = true;
            continue;
        }
        if space && !out.is_empty() {
            out.push(' ');
        }
        space = false;
        out.push(c);
    }
    out.to_lowercase()
}

/// The key of a fact from its parts: `quote` is the passage, `text` the
/// sentence used when the passage is empty.
pub fn key_of(kind: &str, subject: &str, aspect: &str, quote: &str, text: &str) -> String {
    let said = if quote.is_empty() { text } else { quote };
    fnv64(&format!(
        "{kind}{SEP}{}{SEP}{}{SEP}{}",
        subject_key(subject),
        words(aspect),
        words(said)
    ))
}

/// A fact's review key.
pub fn fact_key(f: &Fact) -> String {
    key_of(&f.kind, &f.subject, &f.aspect, &f.quote, &f.text)
}

#[cfg(test)]
#[path = "fact_key_tests.rs"]
mod fact_key_tests;
