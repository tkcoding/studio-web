use super::*;

/// A kit directory on disk, removed when dropped.
struct Kits(PathBuf);

impl Drop for Kits {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn write(path: &Path, body: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, body).unwrap();
}

const MANIFEST: &str = r#"{"manifest": {"id": "m", "metaData": {"publicPath": "auto"}}, "entries": [], "extensions": []}"#;

/// `hello-kit` at 0.1.0 with one built package, and a kit that does not read.
fn kits() -> Kits {
    let dir = std::env::temp_dir().join(format!("kit-bundles-{}", uuid::Uuid::new_v4().simple()));
    write(
        &dir.join("hello-kit/kit.gdl"),
        "gdl_version = \"1.7\"\nkit(\n  name = \"hello-kit\",\n  title = \"Hello\",\n  version = \"0.1.0\",\n  levels = [\"organization\", \"project\"],\n  mfe = [path(\"mfe/hello\")],\n)\n",
    );
    let pkg = dir.join("hello-kit/mfe/hello");
    write(&pkg.join(MFE_MANIFEST), MANIFEST);
    write(&pkg.join("remoteEntry.js"), "export const x = 1;");
    write(&pkg.join("assets/lifecycle-abc.js"), "export default 1;");
    write(&pkg.join("index.html"), "<html></html>");
    write(&pkg.join(".vite/manifest.json"), "{}");
    write(&dir.join("hello-kit/secret.js"), "outside the bundle");
    write(
        &dir.join("broken/kit.gdl"),
        "gdl_version = \"1.7\"\nkit(name = \"broken\")\n",
    );
    write(&dir.join("not-a-kit/README.md"), "no passport");
    Kits(dir)
}

fn bundles(dir: &Path) -> KitBundles {
    let source: Arc<dyn BundleSource> = Arc::new(DirSource::open(dir).unwrap());
    KitBundles::new(vec![source], b"a key of sixteen bytes or more".to_vec())
}

#[test]
fn a_directory_kit_joins_the_library_at_its_passports_version() {
    let k = kits();
    let b = bundles(&k.0);
    let kits = b.kits();
    // `broken` names no bundle and no version: left out, not fatal.
    assert_eq!(kits.len(), 1);
    let kit = &kits[0];
    assert_eq!(kit.slug, "hello-kit");
    assert_eq!(kit.name, "Hello");
    assert_eq!(kit.default_version, "0.1.0");
    assert_eq!(kit.shelf, SHELF_ORGANIZATION);
    assert_eq!(kit.source, SOURCE_BUNDLE_DIR);
    assert_eq!(kit.levels, vec!["organization", "project"]);
}

#[tokio::test]
async fn the_manifests_name_where_each_package_is_served() {
    let k = kits();
    let b = bundles(&k.0);
    let listed = b
        .manifests(
            uuid::Uuid::nil(),
            &[
                ("hello-kit".into(), "0.1.0".into()),
                // Another version, and a kit with no bundles: nothing.
                ("hello-kit".into(), "0.2.0".into()),
                ("project-tests".into(), "1.0.0".into()),
            ],
        )
        .await;
    assert_eq!(listed.len(), 1);
    let m = &listed[0];
    assert_eq!(m.package, "hello");
    let grant = b.grant("hello-kit", "0.1.0");
    assert_eq!(
        m.base_path,
        format!("/cf/studio-kits/v1/kits/hello-kit/0.1.0/mfe/{grant}/hello/")
    );
    assert_eq!(m.config.as_ref().unwrap()["manifest"]["id"], "m");
    assert!(m.error.is_none());
}

#[tokio::test]
async fn a_package_that_was_not_built_is_listed_with_why() {
    let k = kits();
    std::fs::remove_file(k.0.join("hello-kit/mfe/hello").join(MFE_MANIFEST)).unwrap();
    let b = bundles(&k.0);
    let listed = b
        .manifests(uuid::Uuid::nil(), &[("hello-kit".into(), "0.1.0".into())])
        .await;
    assert!(listed[0].config.is_none());
    assert!(
        listed[0]
            .error
            .as_deref()
            .unwrap()
            .contains("build the bundle")
    );
}

#[tokio::test]
async fn files_are_served_to_a_grant_holder_with_their_type() {
    let k = kits();
    let b = bundles(&k.0);
    let grant = b.grant("hello-kit", "0.1.0");
    let (file, bytes) = b
        .file("hello-kit", "0.1.0", &grant, "hello", "remoteEntry.js")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(bytes, b"export const x = 1;");
    assert_eq!(file.content_type(), "text/javascript; charset=utf-8");
    assert!(!file.is_immutable());
    let (asset, _) = b
        .file(
            "hello-kit",
            "0.1.0",
            &grant,
            "hello",
            "assets/lifecycle-abc.js",
        )
        .await
        .unwrap()
        .unwrap();
    assert!(asset.is_immutable());
}

#[tokio::test]
async fn nothing_is_served_without_the_grant_or_outside_the_bundle() {
    let k = kits();
    let b = bundles(&k.0);
    let grant = b.grant("hello-kit", "0.1.0");
    let get = |grant: String, package: &'static str, path: &'static str| {
        let b = &b;
        async move {
            b.file("hello-kit", "0.1.0", &grant, package, path)
                .await
                .unwrap()
        }
    };
    // A wrong grant, another version's grant, an empty one.
    assert!(
        get("0".repeat(32), "hello", "remoteEntry.js")
            .await
            .is_none()
    );
    assert!(
        get(b.grant("hello-kit", "0.2.0"), "hello", "remoteEntry.js")
            .await
            .is_none()
    );
    assert!(
        get(String::new(), "hello", "remoteEntry.js")
            .await
            .is_none()
    );
    // Out of the package, hidden files, pages, unknown types, unknown packages.
    for path in [
        "../secret.js",
        "../../hello-kit/secret.js",
        "assets/../../secret.js",
        "/etc/passwd",
        ".vite/manifest.json",
        "index.html",
        "remoteEntry",
        "a\\b.js",
        "",
    ] {
        assert!(get(grant.clone(), "hello", path).await.is_none(), "{path}");
    }
    assert!(
        get(grant.clone(), "other", "remoteEntry.js")
            .await
            .is_none()
    );
    assert!(get(grant.clone(), "..", "secret.js").await.is_none());
}

#[test]
fn a_grant_is_the_kit_and_version_signed() {
    let k = kits();
    let b = bundles(&k.0);
    let g = b.grant("hello-kit", "0.1.0");
    assert_eq!(g.len(), 32);
    assert_eq!(g, b.grant("hello-kit", "0.1.0"));
    assert_ne!(g, b.grant("hello-kit", "0.1.1"));
    let other = KitBundles::new(Vec::new(), b"another key of sixteen bytes".to_vec());
    assert_ne!(g, other.grant("hello-kit", "0.1.0"));
}

#[test]
fn hmac_matches_rfc_4231() {
    // Test case 2.
    let mac = hmac_sha256(b"Jefe", b"what do ya want for nothing?");
    assert_eq!(
        hex::encode(mac),
        "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
    );
}

#[test]
fn a_bundle_file_is_checked_before_it_is_looked_for() {
    assert!(BundleFile::parse("assets/x-1.css").is_some());
    assert!(BundleFile::parse("shared/gears-frontx-react.js").is_some());
    assert!(BundleFile::parse("fonts/a.woff2").is_some());
    for bad in [
        "x",
        "a/./b.js",
        "a//b.js",
        "a/../b.js",
        "~/.ssh/id.txt",
        "a b.js",
        "x.html",
        "x.ts",
    ] {
        assert!(BundleFile::parse(bad).is_none(), "{bad}");
    }
}

#[test]
fn a_version_that_breaks_a_url_is_refused() {
    assert!(url_safe_version("0.1.0"));
    assert!(url_safe_version("1.0.0-rc.1+build"));
    for bad in ["", "a/b", "..", "1..2", "-1", "v 1"] {
        assert!(!url_safe_version(bad), "{bad}");
    }
    assert_eq!(package_name("mfe/hello"), Some("hello"));
    assert_eq!(package_name("mfe/a/b"), None);
    assert_eq!(package_name("dist/hello"), None);
}
