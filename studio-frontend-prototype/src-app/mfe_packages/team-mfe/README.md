# team-mfe — the Team kit

Project › Team, carried over from the prototype (`people.tsx` in
`mode="team"`, ADR-0069). The screen of the built-in kit `project-team`
(ADR-0068 §7), a base kit until a platform administrator removes it
(ADR-0069 §4).

- `src/screens/team/TeamScreen.tsx` — the team: this project's member grants
  and the organization-wide ones, a role per person, add (a dialog), change
  the role, remove (asked first); under tenant access, the screen says there
  is no per-project team and leads to Admin › Access.
- The model (members, the access config, grants) is shared with people-mfe:
  `@constructor-studio/mfe-shared`'s `people/`.

What it calls:

- reads: `GET /studio-user/v1/organizations/{org_id}/members` (falling back
  to `GET /studio-user/v1/me/colleagues` without `people.view`),
  `GET /studio-organizations/v1/access-catalogue`, account management's
  access-config tenant metadata and the project tenant (its name);
- writes: the access config, `PUT` on account management's tenant metadata
  of the organization — the whole document, as the prototype wrote it.

The write replaces the whole access config: two people editing grants at once
overwrite each other. A grant route (add/remove/re-role one grant, with the
same PDP checks) is a backend candidate.
