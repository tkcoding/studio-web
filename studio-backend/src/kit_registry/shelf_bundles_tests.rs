use std::sync::atomic::{AtomicUsize, Ordering};

use super::super::bundles::KitBundles;
use super::*;

const COMMIT: &str = "0123456789abcdef0123456789abcdef01234567";
const MANIFEST: &str = r#"{"manifest": {"id": "m"}, "entries": [], "extensions": []}"#;

fn origin(path: &str) -> KitOrigin {
    KitOrigin {
        connection_id: Uuid::from_u128(7),
        provider: "github".into(),
        repository: "acme/kits".into(),
        path: path.into(),
        git_ref: None,
        commit: COMMIT.into(),
        manifest_file: "kit.json".into(),
        added_by: "someone".into(),
        added_at: "2026-11-01T00:00:00Z".into(),
        refreshed_at: None,
    }
}

/// One organization's shelf with `hello-kit` at [`COMMIT`], in `kits/hello`
/// of its repository, and the files there; counts what is read.
struct Fake {
    org: Uuid,
    files: Vec<(String, Vec<u8>)>,
    reads: AtomicUsize,
    lookups: AtomicUsize,
}

#[async_trait]
impl ShelfLookup for Fake {
    async fn pinned(&self, org: Uuid, slug: &str, version: &str) -> Result<Option<PinnedBundles>> {
        self.lookups.fetch_add(1, Ordering::SeqCst);
        Ok(
            (org == self.org && slug == "hello-kit" && version == COMMIT).then(|| PinnedBundles {
                origin: origin("kits/hello"),
                packages: vec!["hello".into()],
            }),
        )
    }

    async fn read(&self, org: Uuid, origin: &KitOrigin, path: &str) -> Result<Option<Vec<u8>>> {
        assert_eq!(org, self.org);
        assert_eq!(origin.commit, COMMIT, "read at the pinned commit");
        self.reads.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .files
            .iter()
            .find(|(p, _)| p == path)
            .map(|(_, b)| b.clone()))
    }
}

fn fake(org: Uuid) -> Arc<Fake> {
    Arc::new(Fake {
        org,
        files: vec![
            (
                "kits/hello/mfe/hello/mfe-manifest.json".into(),
                MANIFEST.as_bytes().to_vec(),
            ),
            (
                "kits/hello/mfe/hello/remoteEntry.js".into(),
                b"export const x = 1;".to_vec(),
            ),
            // Not text: a font, served as bytes.
            (
                "kits/hello/mfe/hello/assets/font-1.woff2".into(),
                vec![0, 159, 146, 150],
            ),
        ],
        reads: AtomicUsize::new(0),
        lookups: AtomicUsize::new(0),
    })
}

fn bundles(source: Arc<Fake>) -> KitBundles {
    let b = KitBundles::new(Vec::new(), b"a key of sixteen bytes or more".to_vec());
    b.add_source(Arc::new(ShelfBundles::new(source)));
    b
}

#[tokio::test]
async fn an_organizations_kit_is_served_under_the_organization() {
    let org = Uuid::new_v4();
    let b = bundles(fake(org));
    let listed = b
        .manifests(org, &[("hello-kit".into(), COMMIT.into())])
        .await;
    assert_eq!(listed.len(), 1);
    let grant = b.org_grant(org, "hello-kit", COMMIT);
    assert_eq!(
        listed[0].base_path,
        format!("/cf/studio-kits/v1/kits/hello-kit/{COMMIT}/mfe/{grant}/hello/")
    );
    assert_eq!(listed[0].config.as_ref().unwrap()["manifest"]["id"], "m");
    // Another organization has no such kit on its shelf.
    assert!(
        b.manifests(Uuid::new_v4(), &[("hello-kit".into(), COMMIT.into())])
            .await
            .is_empty()
    );
}

#[tokio::test]
async fn a_file_is_read_once_per_commit_and_bytes_pass_unchanged() {
    let org = Uuid::new_v4();
    let source = fake(org);
    let b = bundles(Arc::clone(&source));
    let grant = b.org_grant(org, "hello-kit", COMMIT);
    for _ in 0..3 {
        let (file, bytes) = b
            .org_file(
                org,
                "hello-kit",
                COMMIT,
                &grant,
                "hello",
                "assets/font-1.woff2",
            )
            .await
            .unwrap()
            .unwrap();
        assert_eq!(bytes, vec![0, 159, 146, 150]);
        assert_eq!(file.content_type(), "font/woff2");
    }
    assert_eq!(
        source.reads.load(Ordering::SeqCst),
        1,
        "the Git host is asked once"
    );
    assert_eq!(
        source.lookups.load(Ordering::SeqCst),
        1,
        "the shelf is read once"
    );
    // A missing file is remembered too.
    for _ in 0..2 {
        assert!(
            b.org_file(org, "hello-kit", COMMIT, &grant, "hello", "assets/none.js")
                .await
                .unwrap()
                .is_none()
        );
    }
    assert_eq!(source.reads.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn the_grant_covers_the_organization() {
    let org = Uuid::new_v4();
    let other = Uuid::new_v4();
    let b = bundles(fake(org));
    let get = |o: Uuid, grant: String| {
        let b = &b;
        async move {
            b.org_file(o, "hello-kit", COMMIT, &grant, "hello", "remoteEntry.js")
                .await
                .unwrap()
        }
    };
    assert!(
        get(org, b.org_grant(org, "hello-kit", COMMIT))
            .await
            .is_some()
    );
    // Another organization's grant, the shared route's grant, another package.
    assert!(
        get(org, b.org_grant(other, "hello-kit", COMMIT))
            .await
            .is_none()
    );
    assert!(get(org, b.grant("hello-kit", COMMIT)).await.is_none());
    assert!(
        b.org_file(
            org,
            "hello-kit",
            COMMIT,
            &b.org_grant(org, "hello-kit", COMMIT),
            "other",
            "remoteEntry.js"
        )
        .await
        .unwrap()
        .is_none()
    );
    // The file route reads the organization back from its grant.
    let (_, bytes) = b
        .file(
            "hello-kit",
            COMMIT,
            &b.org_grant(org, "hello-kit", COMMIT),
            "hello",
            "remoteEntry.js",
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(bytes, b"export const x = 1;");
    assert!(KitBundles::is_org_grant(&b.org_grant(
        org,
        "hello-kit",
        COMMIT
    )));
    // A shared kit's grant does not reach an organization's kit.
    assert!(
        b.file(
            "hello-kit",
            COMMIT,
            &b.grant("hello-kit", COMMIT),
            "hello",
            "remoteEntry.js"
        )
        .await
        .unwrap()
        .is_none()
    );
}

#[test]
fn a_kits_directory_prefixes_the_path_in_its_repository() {
    let file = BundleFile::parse("assets/a.js").unwrap();
    assert_eq!(
        repository_path("kits/hello", "hello", &file),
        "kits/hello/mfe/hello/assets/a.js"
    );
    assert_eq!(repository_path("", "hello", &file), "mfe/hello/assets/a.js");
}

#[test]
fn the_cache_lets_the_oldest_go_first() {
    let mut c: Bounded<u8> = Bounded::new(10, 100);
    c.put("a".into(), 1, 6);
    c.put("b".into(), 2, 4);
    c.put("c".into(), 3, 5);
    assert_eq!(c.get("a"), None);
    assert_eq!(c.get("b"), Some(2));
    assert_eq!(c.get("c"), Some(3));
    // Larger than the whole cache: not kept, nothing pushed out.
    c.put("d".into(), 4, 11);
    assert_eq!(c.get("d"), None);
    assert_eq!(c.get("b"), Some(2));
}
