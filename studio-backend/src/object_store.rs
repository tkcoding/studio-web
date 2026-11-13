//! Object storage seam — hide S3 behind the file-storage gear.
//!
//! Architecture (agreed): **S3 holds the bytes, a gear holds only a
//! reference.** Consumers never speak S3 (or the gear's signed-URL dance)
//! directly — they go through [`ObjectStore`], get back an [`ObjectRef`]
//! (`storage` + `file_id` + metadata), and keep *that*. Swap Virtuozzo S3 for
//! MinIO/AWS/Azure later and consumers don't change.
//!
//! The real implementation, [`FileStorageStore`], drives the
//! `cf-gears-file-storage` gear's REST control plane (create → signed PUT →
//! sidecar finalize → bind; signed download URL → GET; delete). The gear's
//! in-process client (`FileStorageClientV1`) offers no operations yet, so
//! this is the way in. It is **config-gated**: without `STUDIO_FILE_STORAGE_*`
//! set, no object store is built and callers keep the bytes themselves. It
//! activates once the file-storage gear and its storage sidecar are deployed
//! and pointed at a bucket.
//!
//! Used by: the project domain model's uploaded sources
//! (`documents::uploads`).

use std::time::Duration;

use anyhow::{Context, anyhow};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A durable reference to an object stored in the file-storage gear.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectRef {
    /// Backend/storage id. `"file-storage"` when the gear did not report a
    /// specific one.
    pub storage: String,
    /// The gear's logical file id (stable across versions).
    pub file_id: String,
    /// The bound content version id.
    pub version_id: String,
    /// Original display name.
    pub name: String,
    /// MIME type as stored.
    pub mime: String,
    /// Size in bytes.
    pub size: u64,
    /// Content hash the gear computed (`"<algorithm>:<hex>"`), when available.
    pub checksum: Option<String>,
}

/// Store, read back and remove object bytes. Implementations hide the
/// storage backend.
#[async_trait]
pub trait ObjectStore: Send + Sync {
    /// Store `bytes` as a new file and return a durable reference.
    async fn put(&self, name: &str, mime: &str, bytes: Vec<u8>) -> anyhow::Result<ObjectRef>;

    /// The bytes of a stored file's current version.
    async fn get(&self, file_id: &str) -> anyhow::Result<Vec<u8>>;

    /// Remove a stored file and every version of it. A file already gone is
    /// not an error.
    async fn delete(&self, file_id: &str) -> anyhow::Result<()>;
}

/// The store this process was configured with, or `None`.
pub fn from_env() -> Option<std::sync::Arc<dyn ObjectStore>> {
    FileStorageStore::from_env().map(|s| std::sync::Arc::new(s) as std::sync::Arc<dyn ObjectStore>)
}

// ── file-storage gear REST DTOs (subset we use) ─────────────────────────────

#[derive(Serialize)]
struct CreateFileReq<'a> {
    owner_kind: &'a str,
    owner_id: &'a str,
    name: &'a str,
    gts_file_type: &'a str,
    mime_type: &'a str,
    custom_metadata: Vec<MetadataEntry>,
}

#[derive(Serialize, Deserialize)]
struct MetadataEntry {
    key: String,
    value: String,
}

#[derive(Deserialize)]
struct UploadTicket {
    file_id: String,
    version_id: String,
    #[serde(default)]
    upload_url: Option<String>,
}

#[derive(Serialize)]
struct BindReq {
    version_id: String,
}

#[derive(Deserialize)]
struct DownloadTicket {
    download_url: String,
}

#[derive(Deserialize)]
struct Version {
    version_id: String,
    #[serde(default)]
    size: i64,
    #[serde(default)]
    hash_algorithm: Option<String>,
    #[serde(default)]
    hash: Option<String>,
    #[serde(default)]
    status: String,
}

/// The versions out of a listing page (`{"items": [...]}`), or a bare array
/// from an older gear.
fn versions_of(page: Value) -> Vec<Version> {
    let items = match page {
        Value::Array(items) => items,
        Value::Object(mut o) => match o.remove("items") {
            Some(Value::Array(items)) => items,
            _ => Vec::new(),
        },
        _ => Vec::new(),
    };
    items
        .into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .collect()
}

/// The real object store: the `cf-gears-file-storage` gear over HTTP.
pub struct FileStorageStore {
    http: reqwest::Client,
    /// Control-plane base, e.g. `http://127.0.0.1:8090/api/file-storage/v1`.
    base_url: String,
    /// Bearer token for the gear's authenticated control-plane routes.
    token: String,
    owner_kind: String,
    owner_id: String,
    /// Registered GTS file type the gear stores these under.
    gts_file_type: String,
}

impl FileStorageStore {
    /// Build from env, or `None` when not configured (base URL + token required).
    ///   - `STUDIO_FILE_STORAGE_BASE_URL` — control-plane root
    ///   - `STUDIO_FILE_STORAGE_TOKEN`    — service bearer token
    ///   - `STUDIO_FILE_STORAGE_OWNER_ID` — owning principal (defaults to nil uuid)
    ///   - `STUDIO_FILE_STORAGE_OWNER_KIND` — `app` (default) or `user`
    ///   - `STUDIO_FILE_STORAGE_TYPE`     — GTS file type id (has a default)
    pub fn from_env() -> Option<Self> {
        let var = |k: &str| {
            std::env::var(k)
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        };
        let base_url = var("STUDIO_FILE_STORAGE_BASE_URL")?
            .trim_end_matches('/')
            .to_string();
        let token = var("STUDIO_FILE_STORAGE_TOKEN")?;
        let owner_kind = var("STUDIO_FILE_STORAGE_OWNER_KIND").unwrap_or_else(|| "app".to_string());
        let owner_id = var("STUDIO_FILE_STORAGE_OWNER_ID")
            .unwrap_or_else(|| "00000000-0000-0000-0000-000000000000".to_string());
        let gts_file_type = var("STUDIO_FILE_STORAGE_TYPE")
            .unwrap_or_else(|| "gts.cf.file_storage.file.v1~".to_string());
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .ok()?;
        Some(Self {
            http,
            base_url,
            token,
            owner_kind,
            owner_id,
            gts_file_type,
        })
    }

    fn auth(&self, rb: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        rb.header("Authorization", format!("Bearer {}", self.token))
    }

    /// Poll the file's versions until `version_id` is `available` (the sidecar
    /// finalizes asynchronously after the PUT). Bounded so a stuck upload fails
    /// rather than hanging the request.
    async fn await_available(&self, file_id: &str, version_id: &str) -> anyhow::Result<Version> {
        const ATTEMPTS: usize = 30;
        for _ in 0..ATTEMPTS {
            let page: Value = self
                .auth(
                    self.http
                        .get(format!("{}/files/{}/versions", self.base_url, file_id)),
                )
                .send()
                .await
                .context("file-storage list versions")?
                .error_for_status()
                .context("file-storage list versions status")?
                .json()
                .await
                .context("decode versions")?;
            if let Some(v) = versions_of(page)
                .into_iter()
                .find(|v| v.version_id == version_id)
                && v.status == "available"
            {
                return Ok(v);
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        Err(anyhow!(
            "file-storage version {version_id} did not become available in time"
        ))
    }
}

#[async_trait]
impl ObjectStore for FileStorageStore {
    async fn put(&self, name: &str, mime: &str, bytes: Vec<u8>) -> anyhow::Result<ObjectRef> {
        // 1. Create the file + presign the first content upload.
        let ticket: UploadTicket = self
            .auth(self.http.post(format!("{}/files", self.base_url)))
            .json(&CreateFileReq {
                owner_kind: &self.owner_kind,
                owner_id: &self.owner_id,
                name,
                gts_file_type: &self.gts_file_type,
                mime_type: mime,
                custom_metadata: Vec::new(),
            })
            .send()
            .await
            .context("file-storage create")?
            .error_for_status()
            .context("file-storage create status")?
            .json()
            .await
            .context("decode upload ticket")?;
        let upload_url = ticket
            .upload_url
            .ok_or_else(|| anyhow!("file-storage planned a multipart upload for a small file"))?;

        // 2. PUT the bytes to the signed URL (the sidecar streams them to S3).
        //    The URL carries its own auth — do not attach our bearer.
        let size = bytes.len() as u64;
        self.http
            .put(&upload_url)
            .header("Content-Type", mime)
            .body(bytes)
            .send()
            .await
            .context("signed upload PUT")?
            .error_for_status()
            .context("signed upload status")?;

        // 3. Wait for the sidecar to finalize the version (status → available).
        let version = self
            .await_available(&ticket.file_id, &ticket.version_id)
            .await?;

        // 4. Bind the version as the file's current content.
        self.auth(
            self.http
                .post(format!("{}/files/{}/bind", self.base_url, ticket.file_id)),
        )
        .header("If-Match", "*")
        .json(&BindReq {
            version_id: ticket.version_id.clone(),
        })
        .send()
        .await
        .context("file-storage bind")?
        .error_for_status()
        .context("file-storage bind status")?;

        let checksum = match (version.hash_algorithm, version.hash) {
            (Some(alg), Some(h)) if !alg.is_empty() && !h.is_empty() => Some(format!("{alg}:{h}")),
            _ => None,
        };
        Ok(ObjectRef {
            storage: "file-storage".to_string(),
            file_id: ticket.file_id,
            version_id: ticket.version_id,
            name: name.to_string(),
            mime: mime.to_string(),
            size: u64::try_from(version.size)
                .ok()
                .filter(|s| *s > 0)
                .unwrap_or(size),
            checksum,
        })
    }

    async fn get(&self, file_id: &str) -> anyhow::Result<Vec<u8>> {
        let ticket: DownloadTicket = self
            .auth(
                self.http
                    .get(format!("{}/files/{}/download-url", self.base_url, file_id)),
            )
            .send()
            .await
            .context("file-storage download url")?
            .error_for_status()
            .context("file-storage download url status")?
            .json()
            .await
            .context("decode download ticket")?;
        // The signed URL carries its own auth.
        let bytes = self
            .http
            .get(&ticket.download_url)
            .send()
            .await
            .context("signed download GET")?
            .error_for_status()
            .context("signed download status")?
            .bytes()
            .await
            .context("signed download body")?;
        Ok(bytes.to_vec())
    }

    async fn delete(&self, file_id: &str) -> anyhow::Result<()> {
        let response = self
            .auth(
                self.http
                    .delete(format!("{}/files/{}", self.base_url, file_id)),
            )
            .header("If-Match", "*")
            .send()
            .await
            .context("file-storage delete")?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(());
        }
        response
            .error_for_status()
            .context("file-storage delete status")?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_are_read_from_a_page_or_a_bare_list() {
        let v = serde_json::json!({ "version_id": "v1", "size": 3, "status": "available" });
        let paged = versions_of(serde_json::json!({ "items": [v.clone()], "page_info": {} }));
        assert_eq!(paged.len(), 1);
        assert_eq!(paged[0].version_id, "v1");
        assert_eq!(versions_of(serde_json::json!([v])).len(), 1);
        assert!(versions_of(serde_json::json!({ "error": "x" })).is_empty());
    }
}
