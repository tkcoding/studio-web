# studio-user

The canonical user: who a person *is*, independently of how they signed in.

The design — why the gear exists, the person and what binds to it, the alias,
invitation and last-owner rules, the REST surface, the interfaces it publishes
to other gears and the tables — is
[`docs/design/studio-user.md`](../../../docs/design/studio-user.md). This
README is what you need to work in the directory.

## In the assembly

- Gear `studio-user`, capabilities `[rest, db]`, deps `account_management`.
- Config section `gears.studio-user`: database `studio_users`, and
  - `platform_admins` — sign-in subjects that get a membership of the platform
    root at every start; an entry may hold several, comma-separated, and empty
    entries are dropped. With none, the gear warns at boot: nothing else makes
    a platform administrator.
  - `on_first_login` — `{organization, role}` a new person joins on first
    sight; `role` defaults to `member`, and `owner` is refused.
  - `service_account` — Studio's service identity (`subject`, `display_name`,
    `email`); a blank subject means the fixed
    `00000000-0000-4000-8000-00000000057d`.
- **No database configured → the gear stands down**: it publishes no
  interfaces and its routes answer 503 rather than failing the boot, like
  [`../credstore_pg`](../credstore_pg).
- The IdP proof channel and verified addresses come from
  [`../identity_directory`](../identity_directory); without it, brokered
  logins confirm nothing and invitations cannot be accepted.

- The person's Inbox ([`inbox.rs`](inbox.rs)): `GET /studio-user/v1/me/inbox`
  — review requests waiting for the caller's verdict and pull requests whose
  next step is theirs, across their workspaces, overdue first, with the
  caller's `me/inbox-marks` applied (`?view=hidden` lists what the marks
  hide). Items are never stored: each is read from its source route as the
  caller on every call (ADR-0068 §6), and each names its `source`
  (`review-requests`, `pull-requests`). Kits add sources: the Inbox reads
  `GET /studio-kits/v1/inbox-sources` and runs each kit's domain query as the
  caller (`"$me"` = their subject id) through `POST
  /studio-domain-model/v1/query`; those items are `kit:<slug>/<id>` with a
  `kit` (`{slug, name, version}`), after the shell's own
  (docs/design/studio-kits.md §3.11). MCP tools `inbox` and `inbox_mark` ([`mcp.rs`](mcp.rs)).
  The ordering and the marks are unit tests in `inbox_tests.rs`, ported from
  the portal's.

## Working here

- The rules live in `alias_policy.rs`, `invitations.rs` and `leaving.rs`, with
  no I/O, so they are stated as unit tests there. Change a rule there, not in a
  route.
- Every change to a membership — written, deleted, merged — calls
  `memberships_changed()`, which bumps the generation the PDP's cache watches.
  A new path that skips it leaves the PDP answering from a stale organization
  list.
- A DTO name is global across the assembly's OpenAPI registry, which is why the
  membership DTO is `OrgMembershipDto`: a second `MembershipDto` panics the boot.
- This gear is the only owner of person and membership (ADR-0040). Another
  gear asks through a trait exported from `mod.rs`, never through `service` or
  `store`, and never keeps a copy. The owner grant in the access config is
  written by `sync_owner_grant` and nowhere else; a new path that records a
  membership calls it, and every grant it writes names the person id.
- Grant matching uses `grant_keys_of` (person id, then every login). The login
  arm is the migration seam for grants written before ADR-0040; it can go once
  `POST /grants/backfill` has run everywhere.
- `grants_tests.rs` covers the grant projection on Postgres with an in-memory
  account-management; like `store_tests.rs` it needs Docker
  (`cargo test user_profile`).
