//! Ported from the portal's `infra-gdl.test.ts`, `infra-store.test.ts` and
//! the `productGdlLines` block of `product-map.test.ts`.

use serde_json::json;

use super::*;

const PRODUCT: &str = r#"# The product.
product(
    id = "shop",
    sources = [source(id = "gears-rust", at = git(url = "https://github.com/x/gears-rust", rev = "abc")),
               source(id = "shop-repo", at = path("."))],
    profiles = [kubernetes(id = "dev", discovery = "static")],
    gears = [
        use_gear("api-gateway", source = "gears-rust"),
    ],
)
"#;

fn keycloak() -> UseService {
    UseService {
        name: "keycloak".into(),
        source: "shop-repo".into(),
        image: Some("quay.io/keycloak/keycloak:26.0.7".into()),
        config: BTreeMap::from([("KC_PROXY_HEADERS".into(), "xforwarded".into())]),
        ..UseService::default()
    }
}

fn postgresql() -> UseService {
    UseService {
        name: "postgresql".into(),
        source: "shop-repo".into(),
        ..UseService::default()
    }
}

#[test]
fn infra_is_none_when_the_product_says_no_infra() {
    assert_eq!(read_infra(PRODUCT), None);
}

#[test]
fn infra_is_added_before_the_gears_and_read_back_as_written() {
    let text = write_infra(PRODUCT, &[keycloak(), postgresql()]).unwrap();
    assert!(text.contains(&format!(
        "    infra = [\n        {},\n",
        use_service_text(&keycloak())
    )));
    assert!(text.find("infra = [").unwrap() < text.find("gears = [").unwrap());
    assert_eq!(read_infra(&text), Some(vec![keycloak(), postgresql()]));
    assert!(text.starts_with("# The product.\n"));
}

#[test]
fn infra_is_replaced_where_it_is_and_a_profiles_values_are_carried_over_unread() {
    let with_profiles = write_infra(PRODUCT, &[keycloak()]).unwrap().replace(
        r#"config = {"KC_PROXY_HEADERS": "xforwarded"})"#,
        r#"config = {"KC_PROXY_HEADERS": "xforwarded"}, profile_config = {"dev": {"KC_HEALTH_ENABLED": "false"}})"#,
    );
    let read = read_infra(&with_profiles).unwrap().remove(0);
    assert_eq!(
        read.profile_config_text.as_deref(),
        Some(r#"{"dev": {"KC_HEALTH_ENABLED": "false"}}"#)
    );
    let again = write_infra(
        &with_profiles,
        &[UseService {
            image: Some("quay.io/keycloak/keycloak:26.0.8".into()),
            ..read
        }],
    )
    .unwrap();
    assert!(again.contains(r#"profile_config = {"dev": {"KC_HEALTH_ENABLED": "false"}}"#));
    assert!(again.contains("keycloak:26.0.8"));
    assert_eq!(again.matches("infra = [").count(), 1);
}

#[test]
fn infra_is_taken_out_with_its_line_when_the_list_is_empty() {
    let text = write_infra(&write_infra(PRODUCT, &[keycloak()]).unwrap(), &[]).unwrap();
    assert_eq!(read_infra(&text), None);
    assert_eq!(text, PRODUCT);
}

#[test]
fn infra_goes_at_the_end_of_a_product_with_no_gears() {
    let bare = "product(\n    id = \"shop\",\n)\n";
    let text = write_infra(bare, &[keycloak()]).unwrap();
    assert_eq!(read_infra(&text), Some(vec![keycloak()]));
    assert!(text.trim_end().ends_with(')'));
}

#[test]
fn a_comment_and_a_gears_string_that_look_like_infra_are_ignored() {
    let tricky = PRODUCT
        .replace(
            "# The product.",
            r#"# infra = [use_service("x", source = "y")]"#,
        )
        .replace(
            r#"use_gear("api-gateway", source = "gears-rust")"#,
            r#"use_gear("api-gateway", source = "gears-rust", config = {"note": "infra = []"})"#,
        );
    assert_eq!(read_infra(&tricky), None);
    assert_eq!(
        read_infra(&write_infra(&tricky, &[keycloak()]).unwrap()),
        Some(vec![keycloak()])
    );
}

#[test]
fn a_description_without_a_product_cannot_take_infra() {
    assert!(write_infra("gdl_version = \"1.5\"\n", &[keycloak()]).is_err());
}

#[test]
fn the_products_own_repository_is_where_a_new_service_comes_from() {
    assert_eq!(home_source(PRODUCT).as_deref(), Some("shop-repo"));
    assert_eq!(home_source(r#"product(id = "x")"#), None);
}

#[test]
fn the_profiles_are_read_in_order_with_their_kind() {
    assert_eq!(
        read_profiles(PRODUCT),
        Some(vec![ProfileDecl {
            id: "dev".into(),
            kind: "kubernetes".into()
        }])
    );
    assert_eq!(read_profiles(r#"product(id = "x")"#), None);
}

const MAP_GDL: &str = r#"gdl_version = "1.5"

product(
    id = "web",
    profiles = [
        embedded(id = "dev", development = True,
                 database = postgres(host = "127.0.0.1")),
        kubernetes(id = "prod", discovery = "static", namespace = "web",
                   database = postgres(host = "postgres")),
    ],
    # The product's screens (GDL 1.5)
    frontend = frontx_product(
        source = "frontx-web",
        shell = path("web"),
        mfes = [
            frontx_mfe(package = path("web/mfe/people"), source = "frontx-web", requires = ["account-management"]),
        ],
    ),
    gears = [
        use_gear("account-management", source = "gears-rust", plugins = [plugin("static-idp-plugin")]),
        use_gear("studio-documents", source = "studio"),
    ],
)
"#;

#[test]
fn each_part_of_the_product_has_its_lines() {
    let by_node: BTreeMap<String, Vec<usize>> =
        lines_by_node(&node_lines(MAP_GDL)).into_iter().collect();
    assert_eq!(
        by_node,
        BTreeMap::from([
            ("infra:postgres".to_string(), vec![7, 9]),
            ("shell".to_string(), vec![14]),
            ("mfe:web/mfe/people".to_string(), vec![16]),
            ("gear:account-management".to_string(), vec![20]),
            ("gear:static-idp-plugin".to_string(), vec![20]),
            ("gear:studio-documents".to_string(), vec![21]),
        ])
    );
}

#[test]
fn a_line_names_the_gear_before_the_plugins_written_on_it() {
    let lines = node_lines(MAP_GDL);
    let (_, ids) = lines.iter().find(|(n, _)| *n == 20).unwrap();
    assert_eq!(ids[0], "gear:account-management");
}

#[test]
fn a_description_without_a_frontend_has_no_frontend_lines() {
    let start = MAP_GDL.find("    frontend = frontx_product(").unwrap();
    let end = MAP_GDL[start..].find("\n    ),\n").unwrap() + start + "\n    ),\n".len();
    let plain = format!("{}{}", &MAP_GDL[..start], &MAP_GDL[end..]);
    let ids: Vec<String> = lines_by_node(&node_lines(&plain))
        .into_iter()
        .map(|(id, _)| id)
        .collect();
    assert!(!ids.contains(&"shell".to_string()));
    assert!(!ids.iter().any(|id| id.starts_with("mfe:")));
}

fn passport() -> Value {
    json!({
        "name": "keycloak",
        "version": "26.0.7",
        "image": "quay.io/keycloak/keycloak:26.0.7",
        "ports": { "http": 8080 },
        "args": ["start-dev"],
        "config": { "KC_HEALTH_ENABLED": "true", "KC_PROXY_HEADERS": "" },
        "secrets": ["KC_BOOTSTRAP_ADMIN_PASSWORD"],
        "provides": { "oidc.issuer": "{public_url}/realms/product" },
        "stateful": false,
    })
}

fn record() -> Value {
    json!({
        "passport": passport(),
        "image": "registry.example/acme/shop/mirror/keycloak@sha256:abc",
        "public_url": "https://id.shop.example",
    })
}

#[test]
fn a_service_is_the_catalogues_passport_with_the_descriptions_choice_over_it() {
    let u = UseService {
        name: "keycloak".into(),
        source: "shop".into(),
        image: Some("quay.io/keycloak/keycloak:26.0.8".into()),
        config: BTreeMap::from([("KC_PROXY_HEADERS".into(), "xforwarded".into())]),
        ..UseService::default()
    };
    let s = service_of(&u, &[passport()], &[record()]);
    assert_eq!(
        s["passport"]["image"],
        json!("quay.io/keycloak/keycloak:26.0.8")
    );
    assert_eq!(
        s["passport"]["config"],
        json!({ "KC_HEALTH_ENABLED": "true", "KC_PROXY_HEADERS": "xforwarded" })
    );
    assert_eq!(s["image"], record()["image"]);
    assert_eq!(s["public_url"], json!("https://id.shop.example"));
}

#[test]
fn a_call_says_only_what_differs_from_the_catalogues_passport() {
    let mut edited = record();
    edited["passport"]["config"]["KC_PROXY_HEADERS"] = json!("xforwarded");
    assert_eq!(
        use_of(&edited, &[passport()], None, "shop"),
        UseService {
            name: "keycloak".into(),
            source: "shop".into(),
            config: BTreeMap::from([("KC_PROXY_HEADERS".into(), "xforwarded".into())]),
            ..UseService::default()
        }
    );
}

#[test]
fn a_call_keeps_the_source_and_a_profiles_values_the_description_said() {
    let was = UseService {
        name: "keycloak".into(),
        source: "infra-repo".into(),
        profile_config_text: Some(r#"{"dev": {}}"#.into()),
        ..UseService::default()
    };
    let u = use_of(&record(), &[passport()], Some(&was), "shop");
    assert_eq!(u.source, "infra-repo");
    assert_eq!(u.profile_config_text.as_deref(), Some(r#"{"dev": {}}"#));
}

#[test]
fn a_call_keeps_what_the_description_said_when_the_catalogue_no_longer_offers_it() {
    let was = UseService {
        name: "keycloak".into(),
        source: "shop".into(),
        image: Some("quay.io/keycloak/keycloak:26.0.8".into()),
        config: BTreeMap::from([("KC_PROXY_HEADERS".into(), "xforwarded".into())]),
        ..UseService::default()
    };
    let u = use_of(&record(), &[], Some(&was), "shop");
    assert_eq!(u.image, was.image);
    assert_eq!(u.config, was.config);
}

const SHOP: &str = "product(\n    id = \"shop\",\n    sources = [source(id = \"shop\", at = path(\".\"))],\n    gears = [],\n)\n";

#[test]
fn the_first_save_writes_the_projects_list_into_the_description() {
    let text = infra_text_for(SHOP, &[record()], &[]).unwrap();
    assert!(text.contains(r#"use_service("keycloak", source = "shop")"#));
}

#[test]
fn services_as_the_description_says_them_change_nothing() {
    let text = SHOP.replace(
        "gears = []",
        "infra = [\n        use_service(\"keycloak\", source = \"shop\"),\n    ],\n    gears = []",
    );
    assert_eq!(
        infra_text_for(&text, &[record()], &[passport()]).unwrap(),
        text
    );
}

#[test]
fn an_infra_passport_is_read_off_its_catalogue_node_and_nothing_else() {
    let node = json!({ "value": {
        "kind": "service", "service_kind": "infra", "name": "keycloak",
        "image": "quay.io/keycloak/keycloak:26.0.7",
        "infra": { "config": { "A": "1", "B": 2 }, "provides": { "oidc.issuer": "x" } }
    }});
    let gear = json!({ "value": { "kind": "gear", "name": "studio-documents" } });
    let offered = offered_infra(&[gear, node]);
    assert_eq!(offered.len(), 1);
    assert_eq!(offered[0]["config"], json!({ "A": "1" }));
    assert_eq!(offered[0]["stateful"], json!(false));
}

#[test]
fn a_gears_key_drops_the_crate_prefixes() {
    assert_eq!(
        gear_key("cf-gears-account-management"),
        "account-management"
    );
    assert_eq!(gear_key(" CF-Studio-Documents "), "studio-documents");
}
