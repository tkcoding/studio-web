//! A kit's micro-frontends, served to the shell at run time (ADR-0068 §8,
//! phase 5): a new kit's screens need no portal rebuild.
//!
//! # The bundle format
//!
//! A kit with screens carries them built. Its `kit.gdl` (GDL 1.7) names each
//! bundle, a directory beside it:
//!
//! ```text
//! <kit>/kit.gdl           kit(name = "hello-kit", version = "0.1.0",
//!                             levels = ["project"], mfe = [path("mfe/hello")])
//! <kit>/mfe/hello/        what `vite build` with Module Federation and the
//!   mfe-manifest.json       FrontX plugin (`frontxMfGts`) writes: the package's
//!   remoteEntry.js          manifest, entries and extensions, its remote entry,
//!   assets/…  shared/…      its chunks and the shared dependencies it externalizes
//! ```
//!
//! `mfe-manifest.json` is the same file the portal's build-time generator reads
//! (`scripts/lib/manifest-generator.ts`); the shell treats a runtime package
//! exactly like a built-in one once it knows where the files are.
//!
//! # Where the bytes come from
//!
//! A [`BundleSource`]. Two:
//!
//! - [`DirSource`], a directory named by `STUDIO_KIT_BUNDLES_DIR` whose every
//!   subdirectory holding a `kit.gdl` is a kit, added to the library on the
//!   organization shelf at the version its passport states (development and
//!   the demo, `examples/kits/`). Its kits are everybody's.
//! - The organization shelf ([`super::shelf_bundles::ShelfBundles`]): a kit an
//!   organization added from its own repository names its bundles in
//!   `kit.json` (`"mfe": ["mfe/<package>"]`), and they are read through the
//!   organization's connection at the commit the kit is pinned to. Its kits
//!   are one organization's ([`BundleSource::per_organization`]): one slug can
//!   sit on two organizations' shelves, so their grant names the organization
//!   ([`KitBundles::org_grant`]) and the file route reads it back from there.
//!
//! # Who may read the files
//!
//! The shell's module loader fetches a bundle's files itself and sends no
//! token, so the file route is anonymous, like a photo (`studio-user`). What
//! guards it is the `grant` in the path: an HMAC of the kit and the version
//! (and the organization, for an organization's kit), keyed by the deployment
//! (`STUDIO_KIT_BUNDLE_KEY`, else a key drawn at start). It is learned only
//! from `GET /mfe-manifests`, which answers only for kits effective where the
//! caller is a member. Uninstalling a kit takes it out of that answer; a grant
//! once learned stays valid for that version until the key changes, the same
//! as a cached bundle would.

use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result, bail};
use async_trait::async_trait;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::service::{KitDescriptor, SHELF_ORGANIZATION, normalize_slug};
use crate::components_catalog::{KIT_GDL_FILE, read_kit_gdl};

/// A directory of kits, each a subdirectory with a `kit.gdl` (development).
pub const BUNDLES_DIR_ENV: &str = "STUDIO_KIT_BUNDLES_DIR";
/// The key grants are signed with. Unset, one is drawn at start, so grants
/// change with every restart and differ between replicas.
pub const BUNDLE_KEY_ENV: &str = "STUDIO_KIT_BUNDLE_KEY";
/// The `source` of a kit a [`DirSource`] brings into the library.
pub const SOURCE_BUNDLE_DIR: &str = "bundle-dir";
/// A package's manifest, as the FrontX build plugin writes it.
pub const MFE_MANIFEST: &str = "mfe-manifest.json";
/// Where the gateway serves this backend's routes.
const GATEWAY_PREFIX: &str = "/cf";
/// The largest file served; a bundle's chunks are far smaller.
pub(super) const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
/// An organization's grant: its id (32 hex digits) and the HMAC (32).
const ORG_GRANT_LEN: usize = 64;
/// The largest `mfe-manifest.json` read.
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;

/// Where a kit's bundle files come from.
#[async_trait]
pub trait BundleSource: Send + Sync {
    /// Kits this source adds to the library; empty for a source that only
    /// carries files for kits the library lists already.
    fn kits(&self) -> Vec<KitDescriptor> {
        Vec::new()
    }
    /// Whether its kits are one organization's, so `org` decides which kit a
    /// slug is and the files are served under the organization. A source
    /// that is not ignores `org`.
    fn per_organization(&self) -> bool {
        false
    }
    /// The packages `slug` has at `version` for `org`; empty when this source
    /// has none.
    async fn packages(&self, org: Uuid, slug: &str, version: &str) -> Result<Vec<String>>;
    /// One file of a package, `None` when there is no such file.
    async fn read(
        &self,
        org: Uuid,
        slug: &str,
        version: &str,
        package: &str,
        file: &BundleFile,
    ) -> Result<Option<Vec<u8>>>;
}

/// A file path inside a package, checked: relative, no `..`, no hidden part,
/// and of a type a bundle carries. An HTML page is never served, so a
/// bundle's own `index.html` cannot be opened as a page of Studio's origin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleFile {
    segments: Vec<String>,
    content_type: &'static str,
}

impl BundleFile {
    pub fn parse(path: &str) -> Option<Self> {
        if path.is_empty() || path.len() > 512 {
            return None;
        }
        let mut segments = Vec::new();
        for seg in path.split('/') {
            let ok = !seg.is_empty()
                && !seg.starts_with('.')
                && seg.chars().all(|c| {
                    c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '@' | '+' | '~')
                });
            if !ok {
                return None;
            }
            segments.push(seg.to_owned());
        }
        let name = segments.last()?;
        let ext = name.rsplit_once('.')?.1.to_ascii_lowercase();
        Some(Self {
            content_type: content_type(&ext)?,
            segments,
        })
    }

    pub fn content_type(&self) -> &'static str {
        self.content_type
    }

    /// Hashed by the build (Vite's `assets/`), so it may be cached forever.
    pub fn is_immutable(&self) -> bool {
        self.segments.len() > 1 && self.segments[0] == "assets"
    }

    fn relative(&self) -> PathBuf {
        self.segments.iter().collect()
    }

    /// The path inside the package, `/`-separated.
    pub fn as_path(&self) -> String {
        self.segments.join("/")
    }
}

/// The types a bundle is made of. Anything else is not served.
fn content_type(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "txt" => "text/plain; charset=utf-8",
        _ => return None,
    })
}

/// A package name: the `<package>` of `mfe/<package>`.
pub(super) fn package_name(path: &str) -> Option<&str> {
    let name = path.strip_prefix("mfe/")?;
    let ok = name.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_');
    ok.then_some(name)
}

/// A version that can stand in a URL path segment.
fn url_safe_version(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= 64
        && version.starts_with(|c: char| c.is_ascii_alphanumeric())
        && !version.contains("..")
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+'))
}

/// One package of one kit, as the shell registers it.
#[derive(Debug, Clone, PartialEq)]
pub struct KitMfeManifest {
    pub kit_slug: String,
    pub version: String,
    pub package: String,
    /// Where the package's files are served, through the gateway, ending in `/`.
    pub base_path: String,
    /// The package's `mfe-manifest.json`; `None` when it does not read.
    pub config: Option<serde_json::Value>,
    /// Why `config` is `None`.
    pub error: Option<String>,
}

/// Every source, and the key grants are signed with.
pub struct KitBundles {
    sources: std::sync::RwLock<Vec<Arc<dyn BundleSource>>>,
    key: Vec<u8>,
}

impl KitBundles {
    pub fn new(sources: Vec<Arc<dyn BundleSource>>, key: Vec<u8>) -> Self {
        Self {
            sources: std::sync::RwLock::new(sources),
            key,
        }
    }

    /// Add a source after start: the organization shelf, which needs the
    /// installer that is built after the catalogue.
    pub fn add_source(&self, source: Arc<dyn BundleSource>) {
        if let Ok(mut sources) = self.sources.write() {
            sources.push(source);
        }
    }

    fn sources(&self) -> Vec<Arc<dyn BundleSource>> {
        self.sources.read().map(|s| s.clone()).unwrap_or_default()
    }

    /// `STUDIO_KIT_BUNDLES_DIR` and `STUDIO_KIT_BUNDLE_KEY`. A directory that
    /// is named and cannot be read stops the gear at start.
    pub fn from_env() -> Result<Self> {
        let mut sources: Vec<Arc<dyn BundleSource>> = Vec::new();
        if let Some(dir) = std::env::var(BUNDLES_DIR_ENV)
            .ok()
            .filter(|v| !v.trim().is_empty())
        {
            let source = DirSource::open(Path::new(dir.trim())).context(BUNDLES_DIR_ENV)?;
            tracing::info!(
                dir = %dir.trim(),
                kits = source.kits.len(),
                "studio-kits: serving kit bundles from a directory"
            );
            sources.push(Arc::new(source));
        }
        let key = match std::env::var(BUNDLE_KEY_ENV)
            .ok()
            .filter(|v| !v.trim().is_empty())
        {
            Some(key) if key.trim().len() >= 16 => key.trim().as_bytes().to_vec(),
            Some(_) => bail!("{BUNDLE_KEY_ENV} must be at least 16 characters"),
            None => {
                let mut key = uuid::Uuid::new_v4().as_bytes().to_vec();
                key.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
                key
            }
        };
        Ok(Self::new(sources, key))
    }

    /// Kits the sources add to the library.
    pub fn kits(&self) -> Vec<KitDescriptor> {
        self.sources().iter().flat_map(|s| s.kits()).collect()
    }

    /// The source that has bundles for `slug` at `version` in `org`, and
    /// their packages. `scoped` picks the organization's sources (`Some`
    /// true), the shared ones (`Some` false) or either (`None`). A source
    /// that cannot say is logged and passed over.
    async fn source_for(
        &self,
        org: Uuid,
        slug: &str,
        version: &str,
        scoped: Option<bool>,
    ) -> Option<(Arc<dyn BundleSource>, Vec<String>)> {
        for source in self.sources() {
            if scoped.is_some_and(|s| s != source.per_organization()) {
                continue;
            }
            match source.packages(org, slug, version).await {
                Ok(packages) if !packages.is_empty() => return Some((source, packages)),
                Ok(_) => {}
                Err(error) => tracing::warn!(
                    kit = %slug, %version, organization_id = %org,
                    "studio-kits: a bundle source cannot say what a kit has: {error:#}"
                ),
            }
        }
        None
    }

    /// What proves a caller was shown `slug` at `version`.
    pub fn grant(&self, slug: &str, version: &str) -> String {
        self.sign(&format!("studio-kits/mfe\n{slug}\n{version}"))
    }

    /// What proves a caller was shown `org`'s own kit `slug` at `version`:
    /// the organization (32 hex digits) and an HMAC over it, the slug and the
    /// version. The anonymous file route learns from it whose shelf to read,
    /// and nobody can name another organization without the key.
    pub fn org_grant(&self, org: Uuid, slug: &str, version: &str) -> String {
        format!(
            "{}{}",
            org.simple(),
            self.sign(&format!("studio-kits/mfe\n{org}\n{slug}\n{version}"))
        )
    }

    /// Whether `grant` is an organization's ([`Self::org_grant`]): everything
    /// it covers is at a pinned commit, so it never changes.
    pub fn is_org_grant(grant: &str) -> bool {
        grant.len() == ORG_GRANT_LEN
    }

    fn sign(&self, message: &str) -> String {
        let mac = hmac_sha256(&self.key, message.as_bytes());
        hex::encode(&mac[..16])
    }

    /// The packages of each kit in `kits` (slug, version) that has bundles
    /// where `org` is, with where their files are served.
    pub async fn manifests(&self, org: Uuid, kits: &[(String, String)]) -> Vec<KitMfeManifest> {
        let mut out = Vec::new();
        for (slug, version) in kits {
            let Some((source, packages)) = self.source_for(org, slug, version, None).await else {
                continue;
            };
            let grant = if source.per_organization() {
                self.org_grant(org, slug, version)
            } else {
                self.grant(slug, version)
            };
            let prefix =
                format!("{GATEWAY_PREFIX}/studio-kits/v1/kits/{slug}/{version}/mfe/{grant}");
            for package in packages {
                let base_path = format!("{prefix}/{package}/");
                let (config, error) = match read_config(
                    source.as_ref(),
                    org,
                    slug,
                    version,
                    &package,
                )
                .await
                {
                    Ok(config) => (Some(config), None),
                    Err(error) => {
                        tracing::warn!(kit = %slug, %version, %package, "studio-kits: a bundle does not read: {error:#}");
                        (None, Some(format!("{error:#}")))
                    }
                };
                out.push(KitMfeManifest {
                    kit_slug: slug.clone(),
                    version: version.clone(),
                    package,
                    base_path,
                    config,
                    error,
                });
            }
        }
        out
    }

    /// One file of a kit's bundle, for a holder of the kit's grant: a shared
    /// kit's, or an organization's own ([`Self::org_grant`], whose shelf the
    /// grant names). `None` for anything else: a wrong grant reads the same
    /// as a missing file.
    pub async fn file(
        &self,
        slug: &str,
        version: &str,
        grant: &str,
        package: &str,
        path: &str,
    ) -> Result<Option<(BundleFile, Vec<u8>)>> {
        if Self::is_org_grant(grant) {
            // `get`, not indexing: the path segment may not be ASCII.
            let Some(Ok(org)) = grant.get(..32).map(Uuid::try_parse) else {
                return Ok(None);
            };
            return self
                .org_file(org, slug, version, grant, package, path)
                .await;
        }
        if !same(&self.grant(slug, version), grant) {
            return Ok(None);
        }
        self.read_file(Uuid::nil(), false, slug, version, package, path)
            .await
    }

    /// One file of `org`'s own kit's bundle, for a holder of its grant.
    pub async fn org_file(
        &self,
        org: Uuid,
        slug: &str,
        version: &str,
        grant: &str,
        package: &str,
        path: &str,
    ) -> Result<Option<(BundleFile, Vec<u8>)>> {
        if !same(&self.org_grant(org, slug, version), grant) {
            return Ok(None);
        }
        self.read_file(org, true, slug, version, package, path)
            .await
    }

    async fn read_file(
        &self,
        org: Uuid,
        scoped: bool,
        slug: &str,
        version: &str,
        package: &str,
        path: &str,
    ) -> Result<Option<(BundleFile, Vec<u8>)>> {
        let Some(file) = BundleFile::parse(path) else {
            return Ok(None);
        };
        let Some((source, packages)) = self.source_for(org, slug, version, Some(scoped)).await
        else {
            return Ok(None);
        };
        if !packages.iter().any(|p| p == package) {
            return Ok(None);
        }
        Ok(source
            .read(org, slug, version, package, &file)
            .await?
            .map(|bytes| (file, bytes)))
    }
}

/// Two grants are the same, compared in constant time.
fn same(expected: &str, grant: &str) -> bool {
    expected.len() == grant.len()
        && expected
            .bytes()
            .zip(grant.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

async fn read_config(
    source: &dyn BundleSource,
    org: Uuid,
    slug: &str,
    version: &str,
    package: &str,
) -> Result<serde_json::Value> {
    let file = BundleFile::parse(MFE_MANIFEST).context("the manifest's name")?;
    let bytes = source
        .read(org, slug, version, package, &file)
        .await?
        .with_context(|| format!("no {MFE_MANIFEST}: build the bundle first"))?;
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        bail!("{MFE_MANIFEST} is larger than {MAX_MANIFEST_BYTES} bytes");
    }
    let config: serde_json::Value =
        serde_json::from_slice(&bytes).with_context(|| format!("{MFE_MANIFEST} is not JSON"))?;
    if !config
        .get("manifest")
        .is_some_and(serde_json::Value::is_object)
    {
        bail!("{MFE_MANIFEST} has no `manifest`: was it built with the frontxMfGts plugin?");
    }
    if !config
        .get("entries")
        .is_some_and(serde_json::Value::is_array)
    {
        bail!("{MFE_MANIFEST} has no `entries`");
    }
    Ok(config)
}

/// HMAC-SHA-256 (RFC 2104).
fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    let mut block = [0u8; 64];
    if key.len() > block.len() {
        block[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let pad = |byte: u8| -> [u8; 64] {
        let mut out = [byte; 64];
        for (o, k) in out.iter_mut().zip(block.iter()) {
            *o ^= k;
        }
        out
    };
    let inner = Sha256::new()
        .chain_update(pad(0x36))
        .chain_update(message)
        .finalize();
    Sha256::new()
        .chain_update(pad(0x5c))
        .chain_update(inner)
        .finalize()
        .into()
}

/// One kit of a [`DirSource`].
#[derive(Debug, Clone)]
struct DirKit {
    kit: KitDescriptor,
    root: PathBuf,
    packages: Vec<String>,
}

/// A directory of kits: each subdirectory with a `kit.gdl` that names its
/// bundles (`mfe = [path("mfe/<package>")]`) is one, at the version it states.
/// Read once at start; a kit whose passport does not read is left out with a
/// warning, so one half-written kit does not hide the others.
pub struct DirSource {
    kits: Vec<DirKit>,
}

impl DirSource {
    pub fn open(dir: &Path) -> Result<Self> {
        let entries = std::fs::read_dir(dir)
            .with_context(|| format!("cannot read the directory {}", dir.display()))?;
        let mut kits: Vec<DirKit> = Vec::new();
        let mut roots: Vec<PathBuf> = entries
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.join(KIT_GDL_FILE).is_file())
            .collect();
        roots.sort();
        for root in roots {
            match read_kit(&root) {
                Ok(kit) if kits.iter().any(|k| k.kit.slug == kit.kit.slug) => tracing::warn!(
                    kit = %kit.kit.slug,
                    "studio-kits: two kits in {} share a slug; the second is left out",
                    dir.display()
                ),
                Ok(kit) => kits.push(kit),
                Err(error) => tracing::warn!(
                    path = %root.display(),
                    "studio-kits: a kit is left out: {error:#}"
                ),
            }
        }
        Ok(Self { kits })
    }

    fn kit(&self, slug: &str, version: &str) -> Option<&DirKit> {
        self.kits
            .iter()
            .find(|k| k.kit.slug == slug && k.kit.default_version == version)
    }
}

/// A kit of a [`DirSource`] from its `kit.gdl`.
fn read_kit(root: &Path) -> Result<DirKit> {
    let src = std::fs::read_to_string(root.join(KIT_GDL_FILE))
        .with_context(|| format!("cannot read {KIT_GDL_FILE}"))?;
    let passport = read_kit_gdl(&src).map_err(|e| anyhow::anyhow!("{KIT_GDL_FILE}: {e}"))?;
    let slug = normalize_slug(&passport.name)?;
    let Some(version) = passport.version.clone() else {
        bail!("`{slug}` states no version: a bundle is served at the version it was built as");
    };
    if !url_safe_version(&version) {
        bail!(
            "`{slug}`: version \"{version}\" cannot stand in a URL (letters, digits, `.`, `-`, `_`, `+`)"
        );
    }
    if passport.mfe.is_empty() {
        bail!("`{slug}` names no bundle (`mfe = [path(\"mfe/<package>\")]`)");
    }
    let mut packages = Vec::new();
    for path in &passport.mfe {
        let Some(name) = package_name(path) else {
            bail!(
                "`{slug}`: mfe \"{path}\" is not `mfe/<package>` (lowercase letters, digits, `-`, `_`)"
            );
        };
        packages.push(name.to_owned());
    }
    Ok(DirKit {
        kit: KitDescriptor {
            name: passport.title.clone().unwrap_or_else(|| slug.clone()),
            description: passport.description.clone().unwrap_or_default(),
            publisher: passport.publisher.clone().unwrap_or_default(),
            visibility: passport
                .visibility
                .clone()
                .unwrap_or_else(|| "public".into()),
            source: SOURCE_BUNDLE_DIR.to_owned(),
            repository_url: String::new(),
            default_version: version,
            manifest_path: KIT_GDL_FILE.to_owned(),
            shelf: SHELF_ORGANIZATION.to_owned(),
            levels: passport.levels.clone(),
            slug,
        },
        root: root.to_path_buf(),
        packages,
    })
}

#[async_trait]
impl BundleSource for DirSource {
    fn kits(&self) -> Vec<KitDescriptor> {
        self.kits.iter().map(|k| k.kit.clone()).collect()
    }

    async fn packages(&self, _org: Uuid, slug: &str, version: &str) -> Result<Vec<String>> {
        Ok(self
            .kit(slug, version)
            .map(|k| k.packages.clone())
            .unwrap_or_default())
    }

    async fn read(
        &self,
        _org: Uuid,
        slug: &str,
        version: &str,
        package: &str,
        file: &BundleFile,
    ) -> Result<Option<Vec<u8>>> {
        let Some(kit) = self.kit(slug, version) else {
            return Ok(None);
        };
        if !kit.packages.iter().any(|p| p == package) {
            return Ok(None);
        }
        let dir = kit.root.join("mfe").join(package);
        let path = dir.join(file.relative());
        // `BundleFile` admits no `..`; a link inside the bundle that points out
        // of it is refused here, by where it really leads.
        let (Ok(dir), Ok(path)) = (
            tokio::fs::canonicalize(&dir).await,
            tokio::fs::canonicalize(&path).await,
        ) else {
            return Ok(None);
        };
        if !path.starts_with(&dir) || path.components().any(|c| matches!(c, Component::ParentDir)) {
            return Ok(None);
        }
        let meta = match tokio::fs::metadata(&path).await {
            Ok(meta) if meta.is_file() => meta,
            _ => return Ok(None),
        };
        if meta.len() > MAX_FILE_BYTES {
            bail!("{} is larger than {MAX_FILE_BYTES} bytes", path.display());
        }
        Ok(Some(tokio::fs::read(&path).await.with_context(|| {
            format!("cannot read {}", path.display())
        })?))
    }
}

#[cfg(test)]
#[path = "bundles_tests.rs"]
mod tests;
