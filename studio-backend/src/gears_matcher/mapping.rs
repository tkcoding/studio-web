//! Which Studio component a matcher Gear is (HYP-3180, M3 of the T9 design).
//!
//! The matcher names a Gear `gears-rust/<slug>`. Studio's catalogue names a component after its
//! crate, or `cf-gears-<last directory segment>` when the Gear has none, and keeps the **gear
//! directory** (`gears/bss/ledger`). The two are joined on that directory, never on a name: a
//! Gear without a crate is still a component (shown by the keyword matcher as design only), and a
//! stale snapshot can hold `cf-gears-ledger` beside `cf-gears-bss-ledger`. The component's name is
//! for display only.
//!
//! The matcher's report carries a Gear id and nothing else, so the directory of each id comes from
//! `fixtures/gear-directories.json`, a snapshot at the matcher's catalogue pins. It moves with them.
//! A Gear with no directory there, or whose directory Studio does not list, is `Unmapped`, never
//! dropped, and the pilot does not count it as missed for the keyword matcher.

use std::collections::BTreeMap;

const GEAR_DIRECTORIES: &str = include_str!("fixtures/gear-directories.json");

/// A component of Studio's catalogue, as far as the mapping needs it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Component {
    /// The gear directory, e.g. `gears/bss/ledger`. The join key.
    pub(crate) gear_dir: String,
    /// For display, e.g. `cf-gears-bss-ledger`.
    pub(crate) name: String,
}

/// The outcome for one matcher Gear id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Mapping {
    Mapped { gear_dir: String, name: String },
    Unmapped,
}

/// Matcher Gear id to gear directory.
#[derive(Debug, Clone)]
pub(crate) struct GearDirectories(BTreeMap<String, String>);

#[derive(serde::Deserialize)]
struct Snapshot {
    gear_dirs: BTreeMap<String, String>,
}

impl GearDirectories {
    /// The snapshot at the matcher's catalogue pins.
    pub(crate) fn pinned() -> Self {
        let snapshot: Snapshot = serde_json::from_str(GEAR_DIRECTORIES)
            .expect("fixtures/gear-directories.json is valid");
        Self(snapshot.gear_dirs)
    }

    pub(crate) fn dir_of(&self, gear_id: &str) -> Option<&str> {
        self.0.get(gear_id).map(String::as_str)
    }

    /// The component for `gear_id` among Studio's `components`; `Unmapped` when either side lacks
    /// the directory.
    pub(crate) fn map(&self, gear_id: &str, components: &[Component]) -> Mapping {
        let Some(dir) = self.dir_of(gear_id) else {
            return Mapping::Unmapped;
        };
        match components.iter().find(|c| c.gear_dir == dir) {
            Some(c) => Mapping::Mapped {
                gear_dir: c.gear_dir.clone(),
                name: c.name.clone(),
            },
            None => Mapping::Unmapped,
        }
    }
}
