//! Ported from the portal's `doc-quality.test.ts`, `domain-layers.test.ts`
//! and `glossary-view.test.ts` (`similarPairs`): which things the rows ask
//! about, the text they propose, and that a saved change takes the row off.

use std::collections::BTreeMap;

use super::*;

fn fact(subject: &str, kind: &str) -> Fact {
    Fact {
        kind: kind.to_string(),
        subject: subject.to_string(),
        aspect: String::new(),
        value: String::new(),
        text: format!("{subject} {kind}"),
        status: "active".to_string(),
        status_because: String::new(),
        path: "docs/prd/x.md".to_string(),
        line_start: 1,
        line_end: 0,
        quote: String::new(),
        layer: None,
    }
}

fn with(mut f: Fact, change: impl FnOnce(&mut Fact)) -> Fact {
    change(&mut f);
    f
}

fn attr(subject: &str, aspect: &str) -> Fact {
    with(fact(subject, "attribute"), |f| {
        f.aspect = aspect.to_string();
        f.value = format!("its {aspect}");
    })
}

fn rel(subject: &str, verb: &str, target: &str) -> Fact {
    with(fact(subject, "relation"), |f| {
        f.aspect = verb.to_string();
        f.value = target.to_string();
        f.text = format!("{subject} {verb} {target}");
    })
}

fn at_path(f: Fact, path: &str) -> Fact {
    with(f, |f| f.path = path.to_string())
}

fn items(facts: &[Fact]) -> Vec<Item> {
    doc_quality(&entities_of(facts, &[]), &[], &BTreeMap::new())
}

fn kinds(facts: &[Fact]) -> Vec<String> {
    items(facts)
        .into_iter()
        .map(|i| format!("{}:{}", i.kind.as_str(), i.key))
        .collect()
}

fn one(facts: &[Fact]) -> Entity {
    entities_of(facts, &[]).remove(0)
}

fn term(name: &str, facts: usize) -> Term {
    Term {
        key: name.to_lowercase(),
        name: name.to_string(),
        aliases: Vec::new(),
        facts,
        distinct_from: Vec::new(),
    }
}

fn invoice_facts() -> Vec<Fact> {
    vec![
        attr("Invoice", "number"),
        attr("Invoice", "total"),
        rel("Invoice", "belongs to", "Customer"),
        with(fact("Customer", "entity"), |f| {
            f.text = "A Customer buys.".into();
        }),
    ]
}

#[test]
fn no_definition_is_asked_of_a_domain_thing_described_three_times() {
    let all = items(&invoice_facts());
    let nd = all
        .iter()
        .find(|i| i.kind == Kind::NoDefinition)
        .expect("a row");
    assert_eq!(nd.title, "Invoice has no definition");
    let edit = nd.edit.as_ref().unwrap();
    assert_eq!(
        edit.definition.as_deref(),
        Some("An Invoice holds number and total and belongs to Customer.")
    );
    // The rest of the entity is kept, so the save does not lose it.
    let fields: Vec<&str> = edit.fields.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(fields, ["number", "total"]);
    assert_eq!(
        edit.relations,
        vec![Relation {
            verb: "belongs to".into(),
            target: "Customer".into()
        }]
    );
    assert_eq!(nd.entity().as_deref(), Some("invoice"));
}

#[test]
fn no_definition_is_not_asked_of_a_defined_thing_a_passing_word_or_what_serves_the_product() {
    assert!(
        kinds(&[
            fact("Customer", "entity"),
            attr("Customer", "a"),
            attr("Customer", "b")
        ])
        .is_empty()
    );
    assert!(kinds(&[attr("Refund", "a"), attr("Refund", "b")]).is_empty());
    assert!(
        kinds(&[
            attr("Billing service", "a"),
            attr("Billing service", "b"),
            attr("Billing service", "c")
        ])
        .is_empty()
    );
}

#[test]
fn no_definition_goes_once_the_definition_is_read() {
    // What the saved section gives once a build reads docs/domain-model.md.
    let mut facts = invoice_facts();
    facts.insert(
        0,
        at_path(
            with(fact("Invoice", "entity"), |f| {
                f.text = "An Invoice asks a customer to pay.".into();
            }),
            "docs/domain-model.md",
        ),
    );
    assert!(kinds(&facts).iter().all(|k| !k.starts_with("nodefinition")));
}

#[test]
fn a_proposed_definition_reads_what_the_documents_say_when_nothing_is_held_or_related() {
    let e = one(&[with(fact("Order", "constraint"), |f| {
        f.text = "An order is never empty.".into();
    })]);
    assert_eq!(definition_from(&e), "An Order: An order is never empty.");
}

#[test]
fn a_one_sided_relation_proposes_the_other_side_on_the_thing_that_never_mentions_the_first() {
    let facts = [
        fact("Invoice", "entity"),
        rel("Invoice", "belongs to", "Customer"),
        with(fact("Customer", "entity"), |f| {
            f.text = "Someone who buys.".into();
        }),
        attr("Customer", "email"),
    ];
    let os: Vec<Item> = items(&facts)
        .into_iter()
        .filter(|i| i.kind == Kind::OneSided)
        .collect();
    assert_eq!(os.len(), 1);
    let edit = os[0].edit.as_ref().unwrap();
    assert_eq!(edit.name, "Customer");
    assert_eq!(edit.definition.as_deref(), Some("Someone who buys."));
    assert_eq!(
        edit.relations,
        vec![Relation {
            verb: "has".into(),
            target: "Invoice".into()
        }]
    );
    assert_eq!(os[0].entity().as_deref(), Some("customer"));
}

#[test]
fn a_one_sided_relation_is_not_asked_when_the_other_side_names_it() {
    let base = || {
        vec![
            fact("Invoice", "entity"),
            rel("Invoice", "belongs to", "Customer"),
            fact("Customer", "entity"),
        ]
    };
    let mut by_relation = base();
    by_relation.push(rel("Customer", "has", "Invoices"));
    assert!(
        kinds(&by_relation)
            .iter()
            .all(|k| !k.starts_with("onesided"))
    );
    let mut in_passing = base();
    in_passing.push(with(fact("Customer", "constraint"), |f| {
        f.text = "A customer pays every invoice.".into();
    }));
    assert!(
        kinds(&in_passing)
            .iter()
            .all(|k| !k.starts_with("onesided"))
    );
}

#[test]
fn a_one_sided_relation_goes_once_the_other_side_is_read() {
    let mut facts = vec![
        fact("Invoice", "entity"),
        rel("Invoice", "owns", "Customer"),
        fact("Customer", "entity"),
    ];
    let item = items(&facts)
        .into_iter()
        .find(|i| i.kind == Kind::OneSided)
        .unwrap();
    let edit = item.edit.unwrap();
    assert_eq!(
        edit.relations,
        vec![Relation {
            verb: "is owned by".into(),
            target: "Invoice".into()
        }]
    );
    facts.push(at_path(
        rel("Customer", "is owned by", "Invoice"),
        "docs/domain-model.md",
    ));
    assert!(kinds(&facts).is_empty());
}

#[test]
fn the_verb_is_turned_around_where_it_is_known_and_reads_has_otherwise() {
    assert_eq!(inverse_verb("Belongs to"), "has");
    assert_eq!(inverse_verb("contains"), "is part of");
    assert_eq!(inverse_verb("has many"), "belongs to");
    assert_eq!(inverse_verb("approves"), "has");
}

#[test]
fn a_thing_only_a_decision_or_a_feature_describes_is_proposed_for_the_model() {
    let facts = [
        at_path(
            with(fact("Invoice", "entity"), |f| {
                f.text = "An invoice is what we bill.".into();
            }),
            "docs/adr/0007-billing.md",
        ),
        at_path(attr("Invoice", "total"), "docs/features/billing.md"),
    ];
    let all = items(&facts);
    assert_eq!(
        all.iter().map(|i| i.kind).collect::<Vec<_>>(),
        [Kind::OnlyAdr]
    );
    assert_eq!(all[0].title, "Invoice is described only in an ADR");
    assert_eq!(
        all[0].edit.as_ref().unwrap().definition.as_deref(),
        Some("An invoice is what we bill.")
    );
}

#[test]
fn only_in_an_adr_is_not_asked_once_a_requirement_or_the_model_describes_it() {
    let adr = |f: Fact| at_path(f, "docs/adr/0007-billing.md");
    assert!(kinds(&[adr(fact("Invoice", "entity")), attr("Invoice", "total")]).is_empty());
    assert!(
        kinds(&[
            adr(fact("Invoice", "entity")),
            at_path(attr("Invoice", "total"), "docs/domain-model.md")
        ])
        .is_empty()
    );
}

#[test]
fn only_in_an_adr_puts_the_sentence_together_when_the_decision_does_not_say_what_it_is() {
    let adr = |f: Fact| at_path(f, "docs/adr/0007-billing.md");
    let facts = [
        adr(attr("Invoice", "total")),
        adr(attr("Invoice", "due")),
        adr(attr("Invoice", "number")),
    ];
    let all = items(&facts);
    // One row for the thing, not one per gap.
    assert_eq!(
        all.iter().map(|i| i.kind).collect::<Vec<_>>(),
        [Kind::OnlyAdr]
    );
    assert_eq!(
        all[0].edit.as_ref().unwrap().definition.as_deref(),
        Some("An Invoice holds total, due and number.")
    );
}

#[test]
fn two_names_come_from_the_glossarys_similar_pairs_the_busier_name_kept() {
    let all = doc_quality(
        &[],
        &[term("Member", 9), term("Membership", 4)],
        &BTreeMap::new(),
    );
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].kind, Kind::TwoNames);
    let pair = all[0].pair.as_ref().unwrap();
    assert_eq!(pair.a.key, "member");
    assert_eq!(pair.b.key, "membership");
    assert_eq!(all[0].key, "tn:member|membership");
    assert!(all[0].entity().is_none());
}

fn at(f: Fact, line: usize) -> Fact {
    with(f, |f| {
        f.line_start = line;
        f.line_end = line + 1;
        f.quote = "q".into();
    })
}

fn revisions() -> BTreeMap<String, String> {
    BTreeMap::from([("docs/prd/x.md".to_string(), "r1".to_string())])
}

fn no_relation(facts: &[Fact], rev: &BTreeMap<String, String>) -> Vec<Item> {
    doc_quality(&entities_of(facts, &[]), &[], rev)
        .into_iter()
        .filter(|i| i.kind == Kind::NoRelation)
        .collect()
}

fn connection_facts() -> Vec<Fact> {
    vec![
        at(
            with(fact("Connection", "entity"), |f| {
                f.text = "A Connection reaches a host.".into();
            }),
            3,
        ),
        at(
            with(fact("Connection health", "entity"), |f| {
                f.text = "Connection health is read from the host.".into();
            }),
            10,
        ),
        at(attr("Connection health", "status"), 12),
    ]
}

#[test]
fn no_relation_proposes_the_sentence_its_name_implies_after_the_passage_that_describes_it() {
    let found = no_relation(&connection_facts(), &revisions());
    let item = &found[0];
    assert_eq!(item.title, "Connection health is related to nothing");
    let s = item.sentence.as_ref().unwrap();
    assert_eq!(s.path, "docs/prd/x.md");
    assert_eq!(s.revision, "r1");
    assert_eq!(s.line, 11);
    assert_eq!(s.sentence, "Connection health belongs to **Connection**.");
    assert_eq!(s.verb, "belongs to");
    assert_eq!(s.target, "Connection");
}

#[test]
fn no_relation_reads_a_head_noun_alone_as_what_it_is_a_kind_of() {
    let facts = [
        at(fact("Grant", "entity"), 1),
        at(fact("Owner grant", "entity"), 5),
        at(attr("Owner grant", "who"), 6),
    ];
    let found = no_relation(&facts, &revisions());
    assert_eq!(
        found[0].sentence.as_ref().unwrap().sentence,
        "Owner grant is a kind of **Grant**."
    );
}

#[test]
fn no_relation_is_not_asked_once_tied_of_a_screen_or_of_an_older_revision() {
    let mut tied = connection_facts();
    tied.push(at(rel("Connection health", "describes", "Connection"), 14));
    assert!(no_relation(&tied, &revisions()).is_empty());
    let screen = [
        at(fact("Connection", "entity"), 3),
        at(fact("Connection list", "entity"), 10),
        at(attr("Connection list", "a"), 11),
    ];
    assert!(no_relation(&screen, &revisions()).is_empty());
    assert!(no_relation(&connection_facts(), &BTreeMap::new()).is_empty());
}

#[test]
fn a_relation_is_stated_the_way_a_document_would() {
    assert_eq!(
        relation_sentence("role grant", " grants ", "Role"),
        "Role grant grants **Role**."
    );
}

#[test]
fn a_layer_is_domain_for_the_subject_system_for_what_serves_it_deployment_for_where_it_runs() {
    assert_eq!(
        layer_of(&one(&[fact("Organization", "entity")])),
        Some(Layer::Domain)
    );
    assert_eq!(
        layer_of(&one(&[fact("IDE session", "entity")])),
        Some(Layer::System)
    );
    assert_eq!(
        layer_of(&one(&[fact("Keycloak realm", "entity")])),
        Some(Layer::Deployment)
    );
    assert_eq!(
        layer_of(&one(&[at_path(
            fact("Stage", "entity"),
            "deploy/PIPELINES.md"
        )])),
        Some(Layer::Deployment)
    );
}

#[test]
fn a_layer_the_extractor_stated_most_wins_over_a_guess_from_the_name() {
    let layered =
        |kind: &str, layer: &str| with(fact("Build", kind), |f| f.layer = Some(layer.to_string()));
    assert_eq!(
        layer_of(&one(&[with(fact("Session", "entity"), |f| {
            f.layer = Some("domain".into());
        })])),
        Some(Layer::Domain)
    );
    assert_eq!(
        layer_of(&one(&[
            layered("entity", "deployment"),
            layered("entity", "system"),
            layered("entity", "deployment"),
            // Only an entity fact states a layer.
            layered("attribute", "system"),
            layered("attribute", "system"),
        ])),
        Some(Layer::Deployment)
    );
}

#[test]
fn no_layer_for_an_identifier_a_passing_word_or_a_kits_template() {
    assert_eq!(layer_of(&one(&[fact("ADR-0007", "entity")])), None);
    assert_eq!(
        layer_of(&one(&[with(fact("ADR-0007", "entity"), |f| {
            f.layer = Some("domain".into());
        })])),
        None
    );
    assert_eq!(layer_of(&one(&[fact("header", "attribute")])), None);
    assert_eq!(
        layer_of(&one(&[at_path(
            fact("Project", "entity"),
            "x/kits/sdlc/artifacts/PRD/template.md"
        )])),
        None
    );
}

#[test]
fn a_card_lists_each_field_once_and_the_draft_starts_from_what_the_model_knows() {
    let e = one(&[
        with(fact("Project", "entity"), |f| {
            f.text = "A project is a unit of work.".into();
        }),
        with(attr("Project", "type"), |f| f.value = "product".into()),
        with(attr("Project", "type"), |f| f.value = "library".into()),
        rel("Project", "belongs to", "Workspace"),
        rel("Project", "belongs to", "workspace"),
    ]);
    assert_eq!(card_fields(&e, 4), ["type"]);
    assert_eq!(
        entity_draft(&e),
        EntityEdit {
            name: "Project".into(),
            definition: Some("A project is a unit of work.".into()),
            fields: vec![Field {
                name: "type".into(),
                meaning: "product".into()
            }],
            relations: vec![Relation {
                verb: "belongs to".into(),
                target: "Workspace".into()
            }],
        }
    );
}

#[test]
fn entities_fold_spellings_and_aliases_and_leave_out_decisions_and_the_need() {
    let facts = [
        fact("Projects", "entity"),
        fact("project", "attribute"),
        fact("Ticket", "attribute"),
        fact("Retired thing", "decision"),
        fact("Slow onboarding", "problem"),
    ];
    let glossary = [Term {
        key: "project".into(),
        name: "Project".into(),
        aliases: vec!["ticket".into()],
        facts: 3,
        distinct_from: Vec::new(),
    }];
    let all = entities_of(&facts, &glossary);
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].name, "Project");
    assert_eq!(all[0].keys, ["project", "ticket"]);
    assert_eq!(all[0].facts.len(), 3);
}

#[test]
fn similar_pairs_are_a_word_and_its_ship_and_a_word_and_its_qualified_form() {
    let pairs = similar_pairs(
        &[
            term("member", 20),
            term("membership", 15),
            term("organization membership", 4),
            term("note", 9),
        ],
        40,
    );
    let keys: Vec<(&str, &str)> = pairs
        .iter()
        .map(|p| (p.a.key.as_str(), p.b.key.as_str()))
        .collect();
    assert_eq!(
        keys,
        [
            ("member", "membership"),
            ("membership", "organization membership")
        ]
    );
    assert!(pairs[0].why.contains("-ship"));
    assert!(similar_pairs(&[term("member", 1), term("membership", 1)], 40).is_empty());
}

#[test]
fn two_things_a_member_kept_apart_are_not_offered_as_one_again() {
    let mut membership = term("membership", 9);
    membership.distinct_from = vec!["member".into()];
    assert!(similar_pairs(&[membership, term("Member", 4)], 40).is_empty());
}
