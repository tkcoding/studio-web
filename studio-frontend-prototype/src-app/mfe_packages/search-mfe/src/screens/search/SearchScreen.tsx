/**
 * Search — the overlay behind the header's magnifier (`model/search.ts`).
 *
 * One box over the organization in scope: its workspaces and their projects by
 * name, as the old prototype's path-bar picker searched them, and the files,
 * issues and pull requests its sources hold, from the artifact graph's search.
 * A pick goes there through the shell (a place, or a file into the project's
 * IDE) and the overlay closes; a hit that lives elsewhere opens where it came
 * from. ↑/↓ move, Enter opens, Esc closes (the shell's frame).
 *
 * Every part says what it could not do: no organization yet, workspaces that
 * could not be read, a graph that refused — never an empty list in their place.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import { FRONTX_OVERLAY_DOMAIN, apiRegistry, useSharedProperty } from '@gears-frontx/react';
import {
  AccountsApiService,
  STUDIO_ACTION_ARTIFACT_OPEN,
  STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION,
  STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE,
  closeOverlay,
  errorMessage,
  openPlace,
  refusalText,
  sendToHost,
  useHostChrome,
} from '@constructor-studio/mfe-shared';
import { SearchApiService } from '../../api/SearchApiService';
import { MIN_ARTIFACT_QUERY, artifactHit, matchPlaces, type ArtifactHit, type Place } from '../../model/search';
import { useSearchTranslations } from '../../i18n';
import styles from './SearchScreen.module.css';

const DEBOUNCE_MS = 250;
/** Workspaces whose projects are read; more is a large organization, said as such. */
const WORKSPACES_READ = 40;

const idOf = (value: unknown): string | null =>
  value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
    ? (value as { id: string }).id
    : null;
const nameOf = (value: unknown): string =>
  value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string'
    ? (value as { name: string }).name
    : '';

type PlacesState = { state: 'loading' } | { state: 'ready'; places: Place[]; partial: boolean } | { state: 'failed'; error: string };
type HitsState =
  | { state: 'idle' }
  | { state: 'loading'; query: string }
  | { state: 'ready'; query: string; hits: ArtifactHit[] }
  | { state: 'failed'; query: string; error: string };

type Row = { key: string; place?: Place; hit?: ArtifactHit };

export const SearchScreen: React.FC<{ bridge: ChildMfeBridge }> = ({ bridge }) => {
  const { t, loading } = useSearchTranslations();
  const { containerRef, dataTheme } = useHostChrome();
  const organization = useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION, { bridge });
  const workspace = useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE, { bridge });
  const orgId = idOf(organization);
  const workspaceId = idOf(workspace);
  const [query, setQuery] = useState('');
  const [placesRead, setPlacesRead] = useState<(PlacesState & { org: string }) | null>(null);
  const [hits, setHits] = useState<HitsState>({ state: 'idle' });
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  // The organization's workspaces and their projects, read once per organization.
  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    const accounts = apiRegistry.getService(AccountsApiService);
    void (async (): Promise<PlacesState> => {
      try {
        const workspaces = (await accounts.getWorkspaces({ organizationId: orgId }).fetch())?.items ?? [];
        const read = workspaces.slice(0, WORKSPACES_READ);
        const projects = await Promise.all(
          read.map((w) =>
            accounts
              .getProjects({ parentId: w.id })
              .fetch()
              .then(
                (page) => ({ ok: true as const, items: page?.items ?? [] }),
                () => ({ ok: false as const, items: [] })
              )
          )
        );
        const places: Place[] = workspaces.map((w) => ({
          kind: 'workspace',
          id: w.id,
          name: w.name,
          workspaceId: w.id,
          workspaceName: w.name,
        }));
        read.forEach((w, index) => {
          for (const p of projects[index].items) {
            places.push({ kind: 'project', id: p.id, name: p.name, workspaceId: w.id, workspaceName: w.name });
          }
        });
        const partial = workspaces.length > read.length || projects.some((p) => !p.ok);
        return { state: 'ready', places, partial };
      } catch (e) {
        return { state: 'failed', error: refusalText(e) ?? errorMessage(e) };
      }
    })().then((result) => {
      if (alive) setPlacesRead({ ...result, org: orgId });
    });
    return () => {
      alive = false;
    };
  }, [orgId]);

  const places: PlacesState = useMemo(
    () => (placesRead && placesRead.org === orgId ? placesRead : { state: 'loading' }),
    [placesRead, orgId]
  );

  // The graph, asked once the person stops typing.
  const trimmed = query.trim();
  useEffect(() => {
    if (trimmed.length < MIN_ARTIFACT_QUERY) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      if (!alive) return;
      setHits({ state: 'loading', query: trimmed });
      apiRegistry
        .getService(SearchApiService)
        .artifacts.fetch({ text: trimmed, limit: 20 })
        .then(
          (answer) => {
            if (alive) setHits({ state: 'ready', query: trimmed, hits: (answer?.nodes ?? []).map((n) => artifactHit(n, { workspaceId })) });
          },
          (e: unknown) => {
            if (alive) setHits({ state: 'failed', query: trimmed, error: refusalText(e) ?? errorMessage(e) });
          }
        );
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [trimmed, workspaceId]);

  const matchedPlaces = useMemo(
    () => (places.state === 'ready' ? matchPlaces(trimmed, places.places) : []),
    [places, trimmed]
  );
  const shownHits = hits.state === 'ready' && hits.query === trimmed ? hits.hits : [];
  const rows: Row[] = [
    ...matchedPlaces.map((place) => ({ key: `${place.kind}:${place.id}`, place })),
    ...shownHits.filter((hit) => hit.opens !== 'none').map((hit) => ({ key: `hit:${hit.id}`, hit })),
  ];
  const current = Math.min(active, Math.max(rows.length - 1, 0));

  const close = () => closeOverlay(bridge, bridge.extensionId);

  const open = (row: Row) => {
    if (!orgId) return;
    if (row.place) {
      openPlace(
        bridge,
        row.place.kind === 'project'
          ? { organizationId: orgId, workspaceId: row.place.workspaceId, projectId: row.place.id }
          : { organizationId: orgId, workspaceId: row.place.id },
        FRONTX_OVERLAY_DOMAIN
      );
      close();
      return;
    }
    const hit = row.hit!;
    if (hit.opens === 'editor' && hit.projectId && hit.path) {
      sendToHost(bridge, {
        type: STUDIO_ACTION_ARTIFACT_OPEN,
        target: FRONTX_OVERLAY_DOMAIN,
        payload: { projectId: hit.projectId, artifactId: hit.id, repository: '', path: hit.path, kind: 'file' },
      });
      close();
    } else if (hit.opens === 'project' && hit.projectId && hit.workspaceId) {
      openPlace(bridge, { organizationId: orgId, workspaceId: hit.workspaceId, projectId: hit.projectId }, FRONTX_OVERLAY_DOMAIN);
      close();
    } else if (hit.url) {
      window.open(hit.url, '_blank', 'noopener,noreferrer');
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(current + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(current - 1, 0));
    } else if (e.key === 'Enter' && rows[current]) {
      e.preventDefault();
      open(rows[current]);
    }
  };

  if (loading) return <div ref={containerRef} data-theme={dataTheme} className={styles.screen} />;

  const placeLabel = (place: Place) =>
    place.kind === 'project' ? t('in_workspace', { workspace: place.workspaceName }) : t('kind_workspace');
  const hitAction = (hit: ArtifactHit) =>
    hit.opens === 'editor' ? t('open_editor') : hit.opens === 'project' ? t('open_project') : t('open_link');

  const rowButton = (row: Row, title: string, detail: string, action: string) => {
    const mine = rows.findIndex((candidate) => candidate.key === row.key);
    return (
      <li key={row.key}>
        <button
          type="button"
          className={mine === current ? `${styles.row} ${styles.active}` : styles.row}
          aria-selected={mine === current}
          role="option"
          data-result={row.key}
          onMouseEnter={() => setActive(mine)}
          onClick={() => open(row)}
        >
          <span className={styles.rowTitle}>{title}</span>
          {detail && <span className={styles.rowDetail}>{detail}</span>}
          <span className={styles.rowAction}>{action}</span>
        </button>
      </li>
    );
  };

  return (
    <div ref={containerRef} data-theme={dataTheme} className={styles.screen} onKeyDown={onKeyDown}>
      <input
        ref={input}
        className={styles.input}
        type="search"
        placeholder={orgId ? t('placeholder', { organization: nameOf(organization) }) : t('placeholder_none')}
        aria-label={t('title')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        disabled={!orgId}
      />
      {!orgId ? (
        <p className={styles.note}>{t('no_organization')}</p>
      ) : !trimmed ? (
        <p className={styles.note}>{t('hint')}</p>
      ) : (
        <div role="listbox" aria-label={t('title')} className={styles.results}>
          <section>
            <h3 className={styles.group}>{t('group_places')}</h3>
            {places.state === 'loading' ? (
              <p className={styles.note}>{t('loading')}</p>
            ) : places.state === 'failed' ? (
              <p className={styles.error} role="alert" data-places-failed>
                {t('places_failed', { error: places.error })}
              </p>
            ) : matchedPlaces.length === 0 ? (
              <p className={styles.note} data-no-places>
                {t('no_places')}
              </p>
            ) : (
              <ul className={styles.list}>
                {matchedPlaces.map((place) =>
                  rowButton({ key: `${place.kind}:${place.id}`, place }, place.name, placeLabel(place), t('open_place'))
                )}
              </ul>
            )}
            {places.state === 'ready' && places.partial && (
              <p className={styles.note} data-places-partial>
                {t('places_partial')}
              </p>
            )}
          </section>
          <section>
            <h3 className={styles.group}>{t('group_artifacts')}</h3>
            {trimmed.length < MIN_ARTIFACT_QUERY ? (
              <p className={styles.note}>{t('artifacts_short')}</p>
            ) : hits.state === 'failed' && hits.query === trimmed ? (
              <p className={styles.error} role="alert" data-artifacts-failed>
                {t('artifacts_failed', { error: hits.error })}
              </p>
            ) : hits.state !== 'ready' || hits.query !== trimmed ? (
              <p className={styles.note}>{t('loading')}</p>
            ) : shownHits.filter((hit) => hit.opens !== 'none').length === 0 ? (
              <p className={styles.note} data-no-artifacts>
                {t('no_artifacts')}
              </p>
            ) : (
              <ul className={styles.list}>
                {shownHits
                  .filter((hit) => hit.opens !== 'none')
                  .map((hit) => rowButton({ key: `hit:${hit.id}`, hit }, hit.title, `${t(`kind_${hit.kind}`)}${hit.detail ? ` · ${hit.detail}` : ''}`, hitAction(hit)))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
};

SearchScreen.displayName = 'SearchScreen';
