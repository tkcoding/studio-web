import React, { useEffect, useRef, useState } from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import {
  apiRegistry,
  useApiQuery,
  useSharedProperty,
  FRONTX_SHARED_PROPERTY_THEME,
  FRONTX_SHARED_PROPERTY_LANGUAGE,
} from '@gears-frontx/react';
import { Badge, Button, Empty, EmptyDescription, Skeleton } from '@gears-frontx/ui-kit';
import {
  STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION,
  STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT,
} from '@constructor-studio/mfe-shared';
import { KitsApiService, type CatalogKit, type InstalledKits, type KitDetail } from '../../api/KitsApiService';
import { KitDetailView, contentsSummary } from './KitDetailView';
import { AddFromRepository } from './AddFromRepository';
import { IdeKits } from './IdeKits';
import { useHomeTranslations } from '../../i18n';
import styles from './HomeScreen.module.css';


const RTL_LANGUAGES = ['ar', 'he', 'fa', 'ur'];

/**
 * A host theme is a full palette, not a light/dark bit, so it bridges to the
 * kit's two scopes by explicit enumeration. `dracula` therefore lands in the
 * kit's dark greys, not Dracula's purples — a stated residual limitation.
 * The screen root always carries data-theme so the kit's
 * prefers-color-scheme fallback cannot leak through.
 */
const DARK_HOST_THEMES = ['dark', 'dracula', 'dracula-large'];

function toKitTheme(hostTheme: string): 'dark' | 'light' {
  return DARK_HOST_THEMES.includes(hostTheme) ? 'dark' : 'light';
}

function readBridgeProperty(bridge: ChildMfeBridge, property: string, fallback: string): string {
  const current = bridge.getProperty(property);
  return current && typeof current.value === 'string' ? current.value : fallback;
}

/**
 * Props for the HomeScreen component.
 */
interface HomeScreenProps {
  bridge: ChildMfeBridge;
}

/**
 * Platform › Kits: the kit library and the installer (ADR-0068 §4–5,
 * ADR-0069 §4). Every kit of the catalogue, and for each whether it is a base
 * kit (the platform's, for every organization) and whether the organization in
 * view installed it for itself. A platform administrator makes a kit a base
 * kit or takes it back; an organization administrator installs one for the
 * organization. The gear refuses what the person may not do, and the card
 * says why.
 */
/**
 * Which level the screen was opened on: each level installs from its own
 * context (ADR-0069 §4) — the platform its base kits, an organization kits for
 * itself, a project kits for itself. One entry, three extensions in mfe.json;
 * the extension the shell mounted says which.
 */
export type KitScope = 'platform' | 'organization' | 'project';

export function scopeOf(extensionId: string | undefined): KitScope {
  if (extensionId?.endsWith('.screens.organization.v1')) return 'organization';
  if (extensionId?.endsWith('.screens.project.v1')) return 'project';
  return 'platform';
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ bridge }) => {
  const scope = scopeOf(bridge.extensionId);
  const containerRef = useRef<HTMLDivElement>(null);
  // Initial value read directly from the bridge's lazy useState initializer (runs once,
  // synchronously, during the first render) instead of via setState in a mount effect —
  // this avoids an extra render and the set-state-in-effect anti-pattern. The effect
  // below only subscribes for subsequent property changes.
  const [theme, setTheme] = useState<string>(() =>
    readBridgeProperty(bridge, FRONTX_SHARED_PROPERTY_THEME, 'default')
  );
  const [language, setLanguage] = useState<string>(() =>
    readBridgeProperty(bridge, FRONTX_SHARED_PROPERTY_LANGUAGE, 'en')
  );
  // The lazy initializers above run only on mount; if the host swaps the bridge
  // instance, re-read its current properties during render ("adjusting state
  // during render") — the subscription effect only delivers future changes.
  const [prevBridge, setPrevBridge] = useState(bridge);
  if (prevBridge !== bridge) {
    setPrevBridge(bridge);
    setTheme(readBridgeProperty(bridge, FRONTX_SHARED_PROPERTY_THEME, 'default'));
    setLanguage(readBridgeProperty(bridge, FRONTX_SHARED_PROPERTY_LANGUAGE, 'en'));
  }

  const { t, loading } = useHomeTranslations();
  const api = apiRegistry.getService(KitsApiService);
  const catalog = useApiQuery(api.catalog);
  /** The organization's own kits (its shelf), each with where it came from. */
  const [shelf, setShelf] = useState<KitDetail[]>([]);
  const [adding, setAdding] = useState(false);
  const library: CatalogKit[] = catalog.data?.items ?? [];
  const kits: CatalogKit[] = [
    ...library,
    ...shelf.map((d) => d.kit).filter((k) => !library.some((l) => l.slug === k.slug)),
  ];
  const organization = useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION, { bridge }) as
    | { id: string; name: string }
    | null
    | undefined;
  const orgId = organization?.id ?? null;
  const publishedProject = useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT, { bridge });
  const projectId = scope === 'project' && typeof publishedProject === 'string' && publishedProject ? publishedProject : null;
  const [installed, setInstalled] = useState<InstalledKits | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ slug: string; text: string } | null>(null);
  /** What is inside each kit, read once per catalogue: null = could not be read. */
  const [details, setDetails] = useState<Record<string, KitDetail | null>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const slugs = library.map((k) => k.slug).join(',');
  const detailOf = (slug: string): KitDetail | null =>
    shelf.find((d) => d.kit.slug === slug) ?? details[slug] ?? null;
  const onShelf = (slug: string) => shelf.some((d) => d.kit.slug === slug);

  useEffect(() => {
    if (!slugs) return;
    let alive = true;
    void Promise.all(
      slugs.split(',').map((slug) =>
        api
          .describe({ slug })
          .fetch()
          .then(
            (d) => [slug, d] as const,
            () => [slug, null] as const
          )
      )
    ).then((pairs) => alive && setDetails(Object.fromEntries(pairs)));
    return () => {
      alive = false;
    };
  }, [api, slugs]);

  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    api
      .installed(projectId ? { projectId } : { organizationId: orgId })
      .fetch({ staleTime: 0 })
      .then(
        (r) => alive && setInstalled(r),
        () => alive && setInstalled(null)
      );
    return () => {
      alive = false;
    };
  }, [api, orgId, projectId, tick]);

  // The organization's own kits: an organization's or a project's Kits tab.
  useEffect(() => {
    if (!orgId || scope === 'platform') return;
    let alive = true;
    api
      .shelf({ organizationId: orgId })
      .fetch({ staleTime: 0 })
      .then(
        (r) => alive && setShelf(r.items ?? []),
        () => alive && setShelf([])
      );
    return () => {
      alive = false;
    };
  }, [api, orgId, scope, tick]);

  const act = async (slug: string, run: () => Promise<unknown>) => {
    setBusy(slug);
    setProblem(null);
    try {
      await run();
    } catch (e) {
      setProblem({ slug, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
      setTick((n) => n + 1);
    }
  };

  useEffect(() => {
    const themeUnsubscribe = bridge.subscribeToProperty(
      FRONTX_SHARED_PROPERTY_THEME,
      (property) => {
        if (typeof property.value === 'string') {
          setTheme(property.value);
        }
      }
    );

    const languageUnsubscribe = bridge.subscribeToProperty(
      FRONTX_SHARED_PROPERTY_LANGUAGE,
      (property) => {
        if (typeof property.value === 'string') {
          setLanguage(property.value);
        }
      }
    );

    return () => {
      themeUnsubscribe();
      languageUnsubscribe();
    };
  }, [bridge]);

  // Keep the Shadow DOM host's text direction in sync with the active language.
  // An effect keyed by `language` (rather than logic inside the subscription
  // callback) also covers the initial language, which never fires a callback.
  useEffect(() => {
    const rootNode = containerRef.current?.getRootNode();
    if (rootNode && 'host' in rootNode) {
      (rootNode.host as HTMLElement).dir = RTL_LANGUAGES.includes(language) ? 'rtl' : 'ltr';
    }
  }, [language]);

  const controlsFor = (kit: CatalogKit) => (
    <KitControls
      scope={scope}
      kit={kit}
      installed={installed}
      organization={organization ?? null}
      busy={busy === kit.slug}
      problem={problem?.slug === kit.slug ? problem.text : null}
      t={t}
      onMakeBase={() => void act(kit.slug, () => api.installBase(kit.slug).fetch({}))}
      onRemoveBase={() => void act(kit.slug, () => api.removeBase(kit.slug).fetch(undefined))}
      onInstall={(org) => void act(kit.slug, () => api.installForOrganization(kit.slug, org).fetch({}))}
      onRemove={(org) => void act(kit.slug, () => api.removeFromOrganization(kit.slug, org).fetch(undefined))}
      onInstallProject={() =>
        projectId && void act(kit.slug, () => api.installForProject(kit.slug, projectId).fetch({}))
      }
      onRemoveProject={() =>
        projectId && void act(kit.slug, () => api.removeFromProject(kit.slug, projectId).fetch(undefined))
      }
      shelfKit={onShelf(kit.slug)}
      onRefreshShelf={() => orgId && void act(kit.slug, () => api.refreshShelfKit(kit.slug, orgId).fetch({}))}
      onRemoveShelf={() => orgId && void act(kit.slug, () => api.removeShelfKit(kit.slug, orgId).fetch(undefined))}
    />
  );
  const open = selected ? kits.find((k) => k.slug === selected) : undefined;
  // A project lists only what may be installed in a project.
  const shown = scope === 'project' ? kits.filter((k) => !k.levels || k.levels.includes('project')) : kits;

  // Show skeleton while translations are loading
  if (loading) {
    return (
      <div ref={containerRef} className={styles.screen} data-theme={toKitTheme(theme)}>
        <Skeleton className={styles.skeletonTitle} />
        <Skeleton className={styles.skeletonLine} />
      </div>
    );
  }

  return (
    <div ref={containerRef} className={styles.screen} data-theme={toKitTheme(theme)}>
      <h2 className={styles.title}>{t('title')}</h2>
      <p className={styles.description}>{t(`description_${scope}`)}</p>
      {scope === 'organization' && orgId && !open && (
        adding ? (
          <AddFromRepository
            organizationId={orgId}
            t={t}
            onCancel={() => setAdding(false)}
            onAdded={(kit) => {
              setAdding(false);
              setSelected(kit.kit.slug);
              setTick((n) => n + 1);
            }}
          />
        ) : (
          <div className={styles.actions}>
            <Button size="sm" variant="outline" data-add-kit onClick={() => setAdding(true)}>
              {t('add_open')}
            </Button>
          </div>
        )
      )}
      {catalog.isLoading ? (
        <Skeleton className={styles.skeletonLine} />
      ) : catalog.isError ? (
        <p role="alert" className={styles.error}>
          {t('loading_failed', { error: String(catalog.error) })}
        </p>
      ) : open ? (
        <KitDetailView
          kit={open}
          detail={detailOf(open.slug)}
          failed={!onShelf(open.slug) && open.slug in details && details[open.slug] === null}
          controls={controlsFor(open)}
          onBack={() => setSelected(null)}
          t={t}
        />
      ) : shown.length === 0 ? (
        <Empty className={styles.empty}>
          <EmptyDescription>{t('empty')}</EmptyDescription>
        </Empty>
      ) : (
        <ul className={styles.grid}>
          {shown.map((kit) => (
            <li key={kit.slug} className={styles.card} data-kit={kit.slug}>
              <h3 className={styles.cardTitle}>
                <button type="button" className={styles.cardLink} onClick={() => setSelected(kit.slug)}>
                  {kit.name}
                </button>
              </h3>
              <p className={styles.cardText}>{kit.description}</p>
              <dl className={styles.facts}>
                <dt>{t('publisher')}</dt>
                <dd>{kit.publisher}</dd>
                <dt>{t('version')}</dt>
                <dd>{kit.default_version}</dd>
                {kit.repository_url && (
                  <>
                    <dt>{t('repository')}</dt>
                    <dd>
                      <a href={kit.repository_url} target="_blank" rel="noreferrer">
                        {kit.repository_url.replace('https://', '')}
                      </a>
                    </dd>
                  </>
                )}
                {kit.levels && kit.levels.length > 0 && (
                  <>
                    <dt>{t('levels')}</dt>
                    <dd>{kit.levels.join(', ')}</dd>
                  </>
                )}
              </dl>
              {detailOf(kit.slug) && (
                <p className={styles.summary} data-kit-summary>
                  {contentsSummary(detailOf(kit.slug)!.contents, t) || t('sum_nothing')}
                </p>
              )}
              <button type="button" className={styles.inside} onClick={() => setSelected(kit.slug)}>
                {t('inside')}
              </button>
              {controlsFor(kit)}
            </li>
          ))}
        </ul>
      )}
      {/* What the project's IDE has: the official kits `cfs` writes into its checkouts. */}
      {scope === 'project' && projectId && !open && <IdeKits projectId={projectId} t={t} />}
    </div>
  );
};

HomeScreen.displayName = 'HomeScreen';

type Text = ReturnType<typeof useHomeTranslations>['t'];

/** What one kit is here, and what this level may do with it. */
function KitControls({
  scope,
  kit,
  installed,
  organization,
  busy,
  problem,
  t,
  onMakeBase,
  onRemoveBase,
  onInstall,
  onRemove,
  onInstallProject,
  onRemoveProject,
  shelfKit,
  onRefreshShelf,
  onRemoveShelf,
}: {
  scope: KitScope;
  kit: CatalogKit;
  installed: InstalledKits | null;
  organization: { id: string; name: string } | null;
  busy: boolean;
  problem: string | null;
  t: Text;
  onMakeBase: () => void;
  onRemoveBase: () => void;
  onInstall: (organizationId: string) => void;
  onRemove: (organizationId: string) => void;
  onInstallProject: () => void;
  onRemoveProject: () => void;
  /** The kit is on the organization's own shelf. */
  shelfKit: boolean;
  onRefreshShelf: () => void;
  onRemoveShelf: () => void;
}) {
  const base = installed?.base.find((k) => k.kit_slug === kit.slug);
  const own = installed?.organization.find((k) => k.kit_slug === kit.slug);
  const mine = installed?.project?.find((k) => k.kit_slug === kit.slug);
  const name = organization?.name ?? '';
  return (
    <>
      <div className={styles.badges}>
        {kit.shelf && <Badge variant="secondary">{t('shelf_' + kit.shelf)}</Badge>}
        {base && (
          <Badge variant="success" dot>
            {base.by_default ? t('base_default') : t('base')}
          </Badge>
        )}
        {own && (
          <Badge variant="info" dot>
            {t('installed_for', { organization: name })}
          </Badge>
        )}
        {mine && (
          <Badge variant="info" dot>
            {t('installed_project')}
          </Badge>
        )}
        {installed && !base && !own && !mine && <Badge variant="outline">{t('not_installed')}</Badge>}
      </div>
      {installed && (
        <div className={styles.actions}>
          {scope === 'platform' &&
            (base ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={onRemoveBase}>
                {t('remove_base')}
              </Button>
            ) : (
              <Button size="sm" disabled={busy} onClick={onMakeBase}>
                {t('make_base')}
              </Button>
            ))}
          {scope === 'organization' &&
            organization &&
            (own ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => onRemove(organization.id)}>
                {t('remove_from', { organization: name })}
              </Button>
            ) : base ? (
              <span className={styles.note}>{t('from_platform')}</span>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => onInstall(organization.id)}>
                {t('install_for', { organization: name })}
              </Button>
            ))}
          {scope === 'organization' && shelfKit && (
            <>
              <Button variant="ghost" size="sm" disabled={busy} data-shelf-refresh onClick={onRefreshShelf}>
                {t('shelf_refresh')}
              </Button>
              {!own && (
                <Button variant="ghost" size="sm" disabled={busy} data-shelf-remove onClick={onRemoveShelf}>
                  {t('shelf_remove')}
                </Button>
              )}
            </>
          )}
          {scope === 'project' &&
            (mine ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={onRemoveProject}>
                {t('remove_project')}
              </Button>
            ) : base || own ? (
              <span className={styles.note}>{base ? t('from_platform') : t('from_organization')}</span>
            ) : (
              <Button size="sm" disabled={busy} onClick={onInstallProject}>
                {t('install_project')}
              </Button>
            ))}
        </div>
      )}
      {problem && (
        <p role="alert" className={styles.error}>
          {problem}
        </p>
      )}
    </>
  );
}
