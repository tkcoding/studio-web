# search-mfe

Search, the shell's overlay behind the header's magnifier (`/search`).

- One box over the organization in scope: its workspaces and their projects by
  name (the old prototype's path-bar picker searched them so), matched in the
  browser (`src/model/search.ts`), and the files, issues and pull requests its
  sources hold, from `POST /cf/studio-artifact-ingest/v1/search`.
- A workspace or project opens through the shell's `place.open` action; a file
  of a project in the workspace on screen opens in the project's IDE through
  the artifact request; a file elsewhere opens its project; anything else opens
  where it came from. ↑/↓, Enter; Esc is the overlay frame's.
- Every part says what it could not read rather than showing nothing.
