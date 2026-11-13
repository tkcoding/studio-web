# people-mfe — Organization › People

The prototype's People page (`people.tsx` in `mode="org"`, `people-org.tsx`),
carried over (ADR-0069). A screen of the shell, not a kit.

- `src/screens/people/PeopleScreen.tsx` — the list (search, sort by name or
  last seen), the layout toggle, the invite dialog.
- `src/screens/people/PeopleMatrix.tsx` — everyone × every project.
- `src/screens/people/PersonPanel.tsx` — one person: contact, projects and
  roles, pull requests and reviews, Insight, recent activity.
- `src/screens/people/useOrgActivity.ts` — where each person works, read
  best-effort from every source; what could not be read is named.
- The model (members, the access config, "can access" and "active in") is
  shared with team-mfe: `@constructor-studio/mfe-shared`'s `people/`.

A project mark opens that project's Team (team-mfe) through the shell:
workspace selected, project opened, then `screen.open` of `/projects/team`.

The joins here (members × identities × every project's pull requests, feed,
desktops × Insight) run in the browser, a request per project and per person;
they are a backend candidate: one route that answers "who works where" for a
person and an agent alike.
