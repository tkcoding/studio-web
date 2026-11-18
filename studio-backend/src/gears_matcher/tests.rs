use super::mapping::*;

const DEV_CATALOGUE: &str = include_str!("fixtures/dev-catalogue-gears.csv");

/// Dev's catalogue as Andrej attached it: `name,gear_dir,crates`. Plugin crates (a directory under
/// `plugins/`) are components of their own but not Gears of the matcher's catalogue.
fn dev_components() -> Vec<(Component, u32)> {
    DEV_CATALOGUE
        .lines()
        .skip(1)
        .map(|line| {
            let mut f = line.split(',');
            let (name, dir, crates) = (f.next().unwrap(), f.next().unwrap(), f.next().unwrap());
            (
                Component {
                    gear_dir: dir.into(),
                    name: name.into(),
                },
                crates.parse().unwrap(),
            )
        })
        .collect()
}

fn gears() -> Vec<Component> {
    dev_components()
        .into_iter()
        .map(|(c, _)| c)
        .filter(|c| !c.gear_dir.contains("/plugins/"))
        .collect()
}

fn pinned_ids(dirs: &GearDirectories) -> Vec<String> {
    let snapshot: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/gear-directories.json")).unwrap();
    let mut ids: Vec<String> = snapshot["gear_dirs"]
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();
    ids.retain(|id| dirs.dir_of(id).is_some());
    ids
}

#[test]
fn a_gear_is_the_component_of_its_directory_not_of_its_name() {
    let dirs = GearDirectories::pinned();
    // The id minus its prefix is `ledger`; the component is named after its crate.
    assert_eq!(
        dirs.map("gears-rust/ledger", &gears()),
        Mapping::Mapped {
            gear_dir: "gears/bss/ledger".into(),
            name: "cf-gears-bss-ledger".into()
        }
    );
    assert!(matches!(
        dirs.map("gears-rust/chat-engine", &gears()),
        Mapping::Mapped { name, .. } if name == "cf-chat-engine"
    ));
}

#[test]
fn a_stale_snapshot_with_two_names_for_one_directory_does_not_move_the_join() {
    let dirs = GearDirectories::pinned();
    let mut components = gears();
    // One organization on Dev still holds a snapshot from before the naming fix.
    components.push(Component {
        gear_dir: "gears/bss/ledger".into(),
        name: "cf-gears-ledger".into(),
    });
    let Mapping::Mapped { gear_dir, .. } = dirs.map("gears-rust/ledger", &components) else {
        panic!("ledger is a component");
    };
    assert_eq!(gear_dir, "gears/bss/ledger");
}

#[test]
fn a_gear_without_a_crate_is_a_component_named_after_its_last_segment() {
    let dirs = GearDirectories::pinned();
    let components = gears();
    let no_crate: Vec<String> = dev_components()
        .into_iter()
        .filter(|(_, crates)| *crates == 0)
        .map(|(c, _)| c.gear_dir)
        .collect();
    assert_eq!(no_crate.len(), 8);
    // `gears/bss/rating` is `cf-gears-rating`, not `cf-gears-bss-rating`.
    assert!(matches!(
        dirs.map("gears-rust/bss-rating", &components),
        Mapping::Mapped { name, .. } if name == "cf-gears-rating"
    ));
    for dir in no_crate {
        let id = pinned_ids(&dirs)
            .into_iter()
            .find(|id| dirs.dir_of(id) == Some(dir.as_str()))
            .unwrap_or_else(|| panic!("no matcher Gear for {dir}"));
        assert!(
            matches!(dirs.map(&id, &components), Mapping::Mapped { .. }),
            "{id} is on Dev and must not be unmapped"
        );
    }
}

#[test]
fn the_pinned_catalogue_against_dev() {
    let dirs = GearDirectories::pinned();
    let components = gears();
    assert_eq!(components.len(), 37, "42 rows, 5 of them plugin crates");

    let ids = pinned_ids(&dirs);
    assert_eq!(ids.len(), 39, "Gears with a gear.gdl at the pin");
    let unmapped: Vec<&String> = ids
        .iter()
        .filter(|id| dirs.map(id, &components) == Mapping::Unmapped)
        .collect();
    // Present in the pin, absent from Dev's catalogue.
    assert_eq!(
        unmapped,
        ["gears-rust/github-mirror", "gears-rust/graph-storage"]
    );

    // Every component of Dev is reached by exactly one Gear: none is left over.
    for c in &components {
        let hits = ids
            .iter()
            .filter(|id| dirs.dir_of(id) == Some(&c.gear_dir))
            .count();
        assert_eq!(hits, 1, "{} ({})", c.name, c.gear_dir);
    }
}

#[test]
fn a_gear_the_directories_do_not_know_is_unmapped_not_dropped() {
    let dirs = GearDirectories::pinned();
    // Planned in GEARS.md, no gear.gdl and no directory.
    assert_eq!(
        dirs.map("gears-rust/invoicing", &gears()),
        Mapping::Unmapped
    );
    assert_eq!(
        dirs.map("gears-rust/not-a-gear", &gears()),
        Mapping::Unmapped
    );
}
