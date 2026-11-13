//! Ported from the portal's `product-kind.test.ts`.

use serde_json::json;

use super::*;

fn empty() -> Facts {
    Facts {
        brief: None,
        capabilities: Some(Vec::new()),
        requirements: Some(Vec::new()),
        own: Some(Own::default()),
        product: Some(Configured::default()),
    }
}

fn with_brief(brief: &str) -> Facts {
    Facts {
        brief: Some(brief.to_string()),
        ..empty()
    }
}

#[test]
fn a_full_product_on_gears_is_proposed_with_its_reason_when_the_specs_say_nothing() {
    let p = propose(&empty());
    assert_eq!(p.kind, Kind::GearProduct);
    assert_eq!(p.basis, Basis::None);
    assert!(p.reasons[0].contains("too little"));
    assert_eq!(p.alternatives.len(), 3);
}

#[test]
fn screens_and_services_in_the_brief_read_as_a_full_product() {
    let p = propose(&with_brief(
        "A dashboard where tenants see their invoices, over a REST API.",
    ));
    assert_eq!(p.kind, Kind::GearProduct);
    assert_eq!(p.basis, Basis::Specs);
    assert!(p.reasons.join(" ").contains("\u{201c}dashboard\u{201d}"));
}

#[test]
fn services_and_no_screens_read_as_a_gear_service() {
    let p = propose(&Facts {
        capabilities: Some(vec![Capability {
            key: "billing.invoices".into(),
            from: vec!["PRD".into()],
        }]),
        ..with_brief("A billing service: an API and webhooks for payment events.")
    });
    assert_eq!(p.kind, Kind::GearService);
}

#[test]
fn screens_over_nothing_of_its_own_read_as_a_frontx_app() {
    let p = propose(&Facts {
        capabilities: None,
        ..with_brief("A portal with screens for the help desk.")
    });
    assert_eq!(p.kind, Kind::FrontxApp);
    assert!(
        p.reasons
            .join(" ")
            .contains("Could not read the declared capabilities")
    );
}

#[test]
fn own_services_without_gears_read_as_built_from_its_own_source() {
    let p = propose(&Facts {
        own: Some(Own {
            gears: 0,
            frontx: 0,
            services: 2,
        }),
        ..with_brief("Our existing application, a Spring monolith with its own Dockerfile.")
    });
    assert_eq!(p.kind, Kind::SourceBuilt);
    assert!(p.reasons.join(" ").contains("service.gdl"));
}

#[test]
fn gears_in_the_repositories_outweigh_a_dockerfile() {
    let p = propose(&Facts {
        own: Some(Own {
            gears: 4,
            frontx: 2,
            services: 0,
        }),
        ..with_brief("Screens and APIs; a Dockerfile for local runs.")
    });
    assert_eq!(p.kind, Kind::GearProduct);
    assert_eq!(p.basis, Basis::Specs);
}

#[test]
fn the_product_as_configured_counts() {
    let p = propose(&Facts {
        product: Some(Configured {
            gears: 3,
            frontend: true,
        }),
        ..empty()
    });
    assert_eq!(p.kind, Kind::GearProduct);
    assert_eq!(p.basis, Basis::Sources);
}

#[test]
fn only_a_known_kind_is_read_as_a_choice() {
    assert_eq!(
        read_choice(Some(&json!({ "kind": "frontx_app", "confirmed_at": "x" }))).map(|c| c.kind),
        Some(Kind::FrontxApp)
    );
    assert_eq!(read_choice(Some(&json!({ "kind": "recipe" }))), None);
    assert_eq!(read_choice(None), None);
}

#[test]
fn a_choice_is_kept_as_the_portal_kept_it() {
    let c = Choice {
        kind: Kind::GearService,
        proposed: Some(Kind::GearProduct),
        confirmed_by: None,
        confirmed_at: "2026-11-04T00:00:00Z".into(),
    };
    assert_eq!(
        choice_value(&c),
        json!({ "kind": "gear_service", "proposed": "gear_product", "confirmed_by": null,
            "confirmed_at": "2026-11-04T00:00:00Z" })
    );
    assert_eq!(read_choice(Some(&choice_value(&c))), Some(c));
}

#[test]
fn a_confirmed_kind_says_what_studio_had_proposed() {
    let c = Choice {
        kind: Kind::GearService,
        proposed: Some(Kind::GearProduct),
        confirmed_by: None,
        confirmed_at: String::new(),
    };
    let (done, text) = status(Some(&c), None);
    assert!(done);
    assert!(text.contains("Gear service, confirmed (Studio proposed Full product on gears)"));
    assert!(!status(None, Some(&propose(&empty()))).0);
}
