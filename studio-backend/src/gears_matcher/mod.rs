//! The gears-matcher on the Studio side (ADR-0071, `docs/design/studio-gears-matcher.md`).
//!
//! Only the id mapping is here so far; the client of the service and the pilot records are later
//! pull requests.

// Nothing calls it until the client does.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) mod mapping;

#[cfg(test)]
mod tests;
