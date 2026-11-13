# A project and the product it makes

What a project is in Studio, what its product is, how the two are linked, and
how Studio shows the distance between the product the documents describe and
the product the repositories hold.

Status: proposal, 2026-10-13. It builds on
[the domain model read from a project's documents](project-domain-model.md) and
on [ADR-0037](adr/0037-one-model-for-a-project.md), which already names the
chain a project is made of: document → capability → gear → product.

## Why this exists

A project is an effort with a goal. The repositories attached to it are where
that effort happens, and what they hold, built and deployed, is the product.
The product is the result of the project, not a container above it. A
project that continues the work on the same repositories is the next project
over the same sources, not a second project inside one product.

Studio already knows both halves, but not as one picture:

- **The product described**: the project's documents. The
  [domain model](project-domain-model.md) reads its entities, requirements,
  constraints and decisions, and finds where the documents disagree.
- **The product made**: the project's repositories (`sources[]` of
  `project.config`), the gears composed in `product.gdl` and resolved by the
  Gearbox engine ([studio-product](design/studio-product.md)), the deployments.
- **The work between them**: issues, pull requests and commits, which the
  artifact sync already reads ([studio-artifact-ingest](design/studio-artifact-ingest.md)).

What nobody sees is how far the product made is from the product described,
and which work closes which part of that distance. This note makes that
distance the project's state.

## Principles

**The project is the unit, the product is its result.** The hierarchy stays
organization → workspace → project. Nothing new is placed above a project. What
the project produces is read from what is attached to it.

**Documents are the truth for intent.** Goals, scope, requirements, the domain
model, risks and decisions are read from the documents as written
(`cpt-studio-principle-spec-mapping-as-written`). A PRD's template already has
Goals, Risks and Open Questions sections; a project that writes them gets them
read, and a project that does not is offered to write them, never asked to
restructure what it has. When a person adds a goal or a risk in the portal,
it is written into the project's document (a Studio document, or a commit to
the PRD through the project's connection), so there is still one truth and no
second store of intent.

**The repositories are the truth for the result.** What the product is comes
from the checkout, `product.gdl` and the deployments, never from a status
somebody typed.

**State is derived, not reported.** A project's state is the open
disagreements inside its documents, the distance between documents and
product, and the work in flight against both. A person can add a note to it,
but there is no status field to keep up to date.

**One mechanism, nothing tuned to a project.** As with the domain model, no
rule, prompt or path names a product, a repository or a domain term.

## What a project holds

| Block | Read from | Today |
|---|---|---|
| Goal and result | the PRD's goals; the product it names | goals not extracted |
| Scope | in/out of scope, "out of this release" | read as `deferred` facts |
| Requirements | requirement ids and requirement facts | extracted (`requirement`) |
| Domain model | entities, attributes, relations, lifecycles | extracted, contradictions judged |
| Architecture and technical context | designs, ADRs, `product.gdl`, gears | ADRs as `decision` facts; product in studio-product |
| Team | project members, the people on its pull requests | members with project-scoped roles; PRs on people |
| Plan | roadmap items, milestones | roadmap in studio-reports, not linked to a project's requirements |
| Work and statuses | issues and pull requests of the project's repositories | synced, not linked to requirements |
| Risks and decisions | the PRD's Risks and Open Questions, ADRs | decisions extracted; risks and questions not |
| State | derived, see [The project card](#the-project-card) | none |
| Quality and delivery | findings, deployments | findings per document; no per-requirement view |
| Budget | — | out of v1 |

## The links

The value of v1 is not the objects, which mostly exist, but the links between
them:

```
goal ─▶ requirement ─▶ capability ─▶ gear ─▶ part of the product
              │                                     ▲
              └────────▶ work (issue, pull request) ┘
```

| Link | How it is made | Kept as |
|---|---|---|
| goal → requirement | the requirement's text or traceability cites the goal; else a model proposes it and a member decides | a fact relation in the domain model |
| requirement → capability → gear | the spec-to-gears mapping and its decisions ([studio-spec-mapping](design/studio-spec-mapping.md)) | `mapping_decision`, gaining `decides_for` and `about` edges (ADR-0037, steps 3 and 5) |
| gear → product | the gear is in the project's `product.gdl` | `project_product` `includes` edges (ADR-0037, step 9) |
| work → requirement | an issue, pull request or commit names a requirement id (built, below), or a model proposes one from its title and a member decides | read on every call for now; an edge from the `issue` or `pull_request` node once links are decided |
| work → part of the product | the paths a pull request changes fall inside a gear's crate | an edge from the `pull_request` node to the gear |

Every link either comes mechanically from what is written, or is proposed and
decided by a member with the same ✓/✗ the domain model uses. A decided link
holds until either end changes.

**Work → requirement, the mechanical half: built.** `GET
/studio-documents/v1/project-domain-model/work?project_id=` takes every identifier the
documents define with an `**ID**:` label (requirements, components,
decisions), and the synced issues, pull requests and commits, through
`artifact_ingest::port::ProjectWork` (three indexed reads in scope), and links
the work whose title, text or commit message names an identifier as a whole
token. Heading anchors are not identifiers here: `how-it-works` turns up in any
URL. Nothing is stored, so a link appears and goes with the text. The Domain
model tab shows them under **Work**, with how much work names nothing. A
project whose requirements carry no labelled identifier gets no links; the
proposed links, for work that names nothing, are the model's half and still to
come.

## Documents against the product

The domain model compares documents with each other. The next step compares
them with what the repositories hold, at two depths.

**Capabilities against the crates: built.** studio-spec-mapping already
compared a project's capabilities with the crates its code depends on
(`POST /conformance`, shown in the Components tab). `GET
/studio-spec-mapping/v1/findings?project_id=` reads the same comparison on
the server and answers it as findings on the documents that ask, with the
requirement or front matter that asks. It needs no model and no key. The Domain
model tab shows them under **Against the code**.

| Rule | When | Severity |
|---|---|---|
| `product.missing` | a capability the documents need, not non-functional, and no component the code depends on (or the project's own gear) fills it | `high` when a confirmed document declares it, `medium` when it is only read from requirements' words |
| `product.decided_not_built` | the newest decision on a gear for a capability is a confirmation, its document has not changed since, and the code does not depend on the gear | `high`; it says what the code depends on instead, and replaces `product.missing` for that capability |

The code is the project's gear repository or its first GitHub source with
Cargo manifests, as `/conformance` reads it, and the gears the project's
repositories declare. `product.gdl` is not read: it says what the product is
meant to be made of, which is intent, and ADR-0037 leaves open whether it or
the `project_product` node is its truth.

**Entities and values against the code: next.** The same pipeline as the
domain model: candidates without a model, a model judging each one with both
sides in view, findings on the document side, ✓/✗ by members.

| Rule | Candidate (no model) | Judged |
|---|---|---|
| `code.entity_missing` | an `active` entity whose name and aliases match no identifier in the project's code | yes: the passage and the closest identifiers |
| `code.value` | an `active` attribute, cardinality, lifecycle or limit, and the code definitions of its entity | yes: the passage against the code excerpt |

**Finding the code for an entity.** An identifier index over the checkout's
source files, built without a model: identifiers split on case and
underscores, folded, and matched against an entity's name and aliases. It is
generic: it knows identifiers, not languages. The judge sees the best few
definitions; an entity with no hit is a `code.entity_missing` candidate, and
the judge decides whether the product calls it something else.

**Findings land on the document.** The document is where intent is stated, so a
finding is anchored there, and the code side goes into `related` with its path
and lines. Each finding says which side looks wrong: the document describes
what was never built, or the code drifted from a decision still in force. When
it cannot tell, it names the decision someone has to take, as a contradiction
does.

**Only facts in force.** `deferred`, `proposed` and `superseded` facts raise no
`code.*` candidate: a planned entity missing from the code is the plan, not a
problem.

## The project's words

Every link above starts by matching a word in a document to something else: an
entity to an identifier, a requirement to a capability, a passage to a fact.
The fewer meanings a word has, the fewer of those matches are wrong.
[ASD-STE100](https://www.asd-ste100.org/) (Simplified Technical English,
Issue 9, 2025) is the standard that writes this down for technical documents:
one word, one part of speech, one meaning; the organization's own technical
names and verbs beside a dictionary of general words; a short list of writing
rules. Studio takes the principle and the rules that can be stated in its own
words, not the standard.

**What is not taken.** The dictionary and the text of the rules are ASD's
copyright, so Studio neither ships them nor claims conformance (the name is a
trademark). An organization that holds the standard can add its approved words
as its own data, read the same way as the project's glossary below.

**The glossary is decided, not detected: built.** The domain model already
tried `term.synonym_drift` and dropped it: every candidate in calibration was a
deliberate rename between layers ([project-domain-model](project-domain-model.md#the-rule-catalogue)).
So the glossary is not a rule that flags two names. It is the per-project alias
table that page listed as later work, made from what the build already has, with
no model and no key (`documents/spec_model/glossary.rs`):

- every subject of the facts is one entry, its spellings folded as the rules
  fold them (case, articles, a plural `s`), named by the spelling the documents
  use most; a subject only ever a decision is not an entry;
- a member names an entry the way the project says it, or makes it an alias of
  another entry when the documents call one thing by two names, and can split
  it out again (`GET /studio-documents/v1/project-domain-model/glossary`, `POST
  …/glossary/decisions`, the Domain model tab's **Glossary** view);
- an alias is one level deep: an alias of an entry the documents no longer
  name, or of an entry that is an alias itself, holds nothing, so undoing one
  merge never moves a third entry.

The facts have no aliases of their own (the extractor gives a subject, not its
other names), so the entries a member merges are the only aliases there are.

The glossary is then input, not output:

- built: the rules read the facts through it, so the facts about an alias are
  facts about its entry, and two documents that disagree about one thing under
  two names become a candidate; a candidate's fingerprint is unchanged, since it
  rests on the passages, not the subject;
- built: the Entities view shows an entry under its chosen name, with its
  aliases' facts, and follows a relation that names an alias;
- `code.entity_missing` will match an entity's identifiers through its aliases,
  so a deliberate rename between the documents and the code is not a finding;
- `formula.mismatch` gets the table of what each quantity is called in each
  layer, which it waited for;
- the spec-to-gears mapping can read requirements with one name per entity.

A drift rule may come back later, scoped to what the glossary decides: an alias a
member split off, used again with the entity's meaning.

**Writing rules are advice in the editor, not findings: built.**
`constraint.vague` raised nothing that survived review, so the writing rules do
not join the project's findings or its state. They are hints in the IDE's
document editor, without a model (`theia/product-ext/src/browser/writing-hints.js`),
on the sentences that state a requirement (shall, must, should, "is required
to"); descriptions, headings and code are left alone:

| Hint | When |
|---|---|
| `writing.long_sentence` | a requirement longer than 20 words |
| `writing.two_requirements` | one sentence with two requirement verbs ("must retry and must give up"); the second is marked |
| `writing.no_actor` | a passive requirement that names no actor ("shall be stored", with no "by …") |

Each is a dotted underline whose tooltip says why, drawn as a decoration, so
nothing reaches the file. They are on unless the project turns them off on the
Project page (`writingHints: false` in `.studio/settings.json`), and they never
block a sync, a share or a merge: specs are read as written. They show in the
documents mode's editor, the one the portal opens a document in and the
Quality rail lives in; the workbench's Markdown editor has none.

Not built: `writing.long_noun` (a run of more than three nouns), because telling
a noun from a verb needs a part-of-speech reading and a guess underlines
ordinary prose; and the same rules in the instructions of the assistant that
writes documents in a session.

## The project card

One block at the top of the project page, every line derived and linked to
where it comes from:

- **Goal**: the PRD's goals, or an invitation to write them.
- **Product**: the gears in `product.gdl`, the last deployment.
- **Conformance**: open contradictions in the documents, open
  documents-against-product findings, requirements with no gear.
- **Work**: open pull requests and issues against the requirements, and whom
  they wait on.
- **Risks and open questions**: the top ones from the documents, and
  `deferred` facts nobody has scheduled.

## Order of work

Each step is useful alone.

1. **Goals, risks and open questions as facts.** The extractor gains the kinds
   `goal`, `risk` and `question`; the Domain model tab and the card show them.
2. **`product.*` rules.** Built: `GET /studio-spec-mapping/v1/findings` and
   the tab's Against the code view.
3. **The project's glossary**, proposed from the merged entities and decided
   by members; no model, no key. Built. Then **the identifier index and
   `code.*` rules** through it, on the builder's key, as the domain model's
   build is.
   The writing hints (built) and the assistant's instructions are independent of both.
4. **Work links.** Issues and pull requests to requirements and gears, proposed
   and decided. The mechanical half (work that names an identifier) is built.
5. **The project card.**
6. **Writing intent from the portal.** Adding a goal or a risk writes it into the
   project's document.

## Open questions

1. Does the artifact sync record the paths a pull request changes? Work →
   part of the product needs them.
2. Where does a goal entered in the portal go when the project has no PRD:
   a new Studio document of type PRD, or a file committed to the first source?
3. A repository attached to two projects is two sets of artifact nodes (ADR-0037,
   open question 5). Should a later project over the same repositories reuse
   the earlier one's extractions? The extractions are kept per document
   revision, so reuse would cost a key change, not a new reading.
4. Which deployment is "the product" when a project has several environments?

## Not in v1

Budget and cost; plans with dates beyond what roadmap items already hold;
quality metrics per requirement beyond the findings.
