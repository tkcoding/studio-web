//! An organization's own kit's micro-frontends, read from its repository at
//! the commit the kit is pinned to (ADR-0068 phases 5 and 7,
//! `docs/design/studio-kits.md` §3.12).
//!
//! A shelf kit's `kit.json` names its bundles (`"mfe": ["mfe/<package>"]`),
//! directories beside the manifest at the pinned commit. The shelf keeps the
//! manifest and where the kit came from ([`super::shelf::KitOrigin`]) for
//! every version an installation still uses, so (organization, slug, commit)
//! names exactly one directory of one repository.
//!
//! The file route is anonymous and a page loads dozens of chunks, so the Git
//! host is not asked per request: a file at a commit never changes, and what
//! was read is kept in memory, keyed by connection, repository, commit and
//! path, up to [`CACHE_BYTES`] (oldest first out). A file that is not there
//! is remembered too. What the shelf says about a kit at a commit is kept the
//! same way. Reads go through the organization's own connection as this
//! gear's service identity in the organization: the caller proved, with the
//! grant, that a member was shown the kit.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

use anyhow::{Result, bail};
use async_trait::async_trait;
use uuid::Uuid;

use super::bundles::{BundleFile, BundleSource, MAX_FILE_BYTES, package_name};
use super::installed::{KitInstaller, service_context};
use super::shelf::KitOrigin;

/// The most bytes of files kept in memory.
pub const CACHE_BYTES: usize = 64 * 1024 * 1024;
/// The most files (or answers that there is none) kept.
const CACHE_FILES: usize = 4096;
/// The most kits' origins kept.
const CACHE_KITS: usize = 512;

/// A shelf kit at one commit: where it is and which packages it has.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PinnedBundles {
    pub origin: KitOrigin,
    pub packages: Vec<String>,
}

/// What the shelf says about a kit at a commit.
#[async_trait]
pub trait ShelfLookup: Send + Sync {
    /// `org`'s shelf kit `slug` at `version`, when the shelf has it (current,
    /// or kept for an installation).
    async fn pinned(&self, org: Uuid, slug: &str, version: &str) -> Result<Option<PinnedBundles>>;
    /// One file of the kit's repository at the commit, `None` when there is
    /// no such file.
    async fn read(&self, org: Uuid, origin: &KitOrigin, path: &str) -> Result<Option<Vec<u8>>>;
}

#[async_trait]
impl ShelfLookup for KitInstaller {
    async fn pinned(&self, org: Uuid, slug: &str, version: &str) -> Result<Option<PinnedBundles>> {
        let kit = self
            .shelf_kit_at(org, slug, version)
            .await
            .map_err(|r| anyhow::anyhow!("{r:?}"))?;
        Ok(kit.map(|k| PinnedBundles {
            packages: k
                .manifest
                .mfe
                .iter()
                .filter_map(|p| package_name(p).map(str::to_owned))
                .collect(),
            origin: k.origin,
        }))
    }

    async fn read(&self, org: Uuid, origin: &KitOrigin, path: &str) -> Result<Option<Vec<u8>>> {
        self.reader()
            .read_file(&service_context(org)?, org, origin, path)
            .await
            .map_err(|r| anyhow::anyhow!("{r:?}"))
    }
}

/// Bounded, oldest-out.
struct Bounded<V> {
    map: HashMap<String, (V, usize)>,
    order: VecDeque<String>,
    bytes: usize,
    max_bytes: usize,
    max_entries: usize,
}

impl<V: Clone> Bounded<V> {
    fn new(max_bytes: usize, max_entries: usize) -> Self {
        Self {
            map: HashMap::new(),
            order: VecDeque::new(),
            bytes: 0,
            max_bytes,
            max_entries,
        }
    }

    fn get(&self, key: &str) -> Option<V> {
        self.map.get(key).map(|(v, _)| v.clone())
    }

    fn put(&mut self, key: String, value: V, size: usize) {
        if size > self.max_bytes {
            return;
        }
        if let Some((_, old)) = self.map.remove(&key) {
            self.bytes -= old;
            self.order.retain(|k| *k != key);
        }
        while self.bytes + size > self.max_bytes || self.map.len() >= self.max_entries {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if let Some((_, s)) = self.map.remove(&oldest) {
                self.bytes -= s;
            }
        }
        self.bytes += size;
        self.order.push_back(key.clone());
        self.map.insert(key, (value, size));
    }
}

/// The organization shelf as a [`BundleSource`].
pub struct ShelfBundles {
    lookup: Arc<dyn ShelfLookup>,
    kits: Mutex<Bounded<PinnedBundles>>,
    files: Mutex<Bounded<Option<Arc<Vec<u8>>>>>,
}

impl ShelfBundles {
    pub fn new(lookup: Arc<dyn ShelfLookup>) -> Self {
        Self::with_limit(lookup, CACHE_BYTES)
    }

    pub fn with_limit(lookup: Arc<dyn ShelfLookup>, bytes: usize) -> Self {
        Self {
            lookup,
            kits: Mutex::new(Bounded::new(usize::MAX, CACHE_KITS)),
            files: Mutex::new(Bounded::new(bytes, CACHE_FILES)),
        }
    }

    async fn pinned(&self, org: Uuid, slug: &str, version: &str) -> Result<Option<PinnedBundles>> {
        let key = format!("{org}\n{slug}\n{version}");
        if let Some(found) = self.kits.lock().ok().and_then(|c| c.get(&key)) {
            return Ok(Some(found));
        }
        // Not remembered when absent: the kit may be added to the shelf later.
        let found = self.lookup.pinned(org, slug, version).await?;
        if let (Some(found), Ok(mut cache)) = (&found, self.kits.lock()) {
            cache.put(key, found.clone(), 0);
        }
        Ok(found)
    }
}

/// The repository path of `file` in `package` of a kit at `dir`.
pub fn repository_path(dir: &str, package: &str, file: &BundleFile) -> String {
    let inner = format!("mfe/{package}/{}", file.as_path());
    if dir.is_empty() {
        inner
    } else {
        format!("{dir}/{inner}")
    }
}

#[async_trait]
impl BundleSource for ShelfBundles {
    fn per_organization(&self) -> bool {
        true
    }

    async fn packages(&self, org: Uuid, slug: &str, version: &str) -> Result<Vec<String>> {
        Ok(self
            .pinned(org, slug, version)
            .await?
            .map(|p| p.packages)
            .unwrap_or_default())
    }

    async fn read(
        &self,
        org: Uuid,
        slug: &str,
        version: &str,
        package: &str,
        file: &BundleFile,
    ) -> Result<Option<Vec<u8>>> {
        let Some(pinned) = self.pinned(org, slug, version).await? else {
            return Ok(None);
        };
        if !pinned.packages.iter().any(|p| p == package) {
            return Ok(None);
        }
        let origin = &pinned.origin;
        let path = repository_path(&origin.path, package, file);
        let key = format!(
            "{}\n{}\n{}\n{path}",
            origin.connection_id, origin.repository, origin.commit
        );
        if let Some(found) = self.files.lock().ok().and_then(|c| c.get(&key)) {
            return Ok(found.map(|bytes| bytes.as_ref().clone()));
        }
        let bytes = self.lookup.read(org, origin, &path).await?;
        if let Some(b) = &bytes
            && b.len() as u64 > MAX_FILE_BYTES
        {
            bail!("{path} is larger than {MAX_FILE_BYTES} bytes");
        }
        let size = bytes.as_ref().map_or(0, Vec::len);
        let kept = bytes.clone().map(Arc::new);
        if let Ok(mut cache) = self.files.lock() {
            cache.put(key, kept, size);
        }
        Ok(bytes)
    }
}

#[cfg(test)]
#[path = "shelf_bundles_tests.rs"]
mod tests;
