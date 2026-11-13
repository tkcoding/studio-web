/**
 * Admin › Objects — the prototype's `ObjectTypes` (`object-types.tsx`)
 * carried over (ADR-0069): every type the graph holds for this organization,
 * and which of them are components. Tick one and it becomes a component (the
 * Components page lists its nodes); untick it and it leaves. The nodes are
 * untouched either way: a mark is an opinion about a type.
 *
 * The counts come after the table, and a count nothing took stays a dash —
 * never a zero.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gears-frontx/ui-kit';
import { useOrganization, type OrganizationRef } from '@constructor-studio/mfe-shared';
import { AdminApiService } from '../../api/AdminApiService';
import type { CatalogType, TypeCount } from '../../api/types';
import { COMPANION_TYPES, LENSES, byComponentThenId, familyOf, inLens, shortName, titleize, type Lens } from '../../model/objects';
import { ErrorLine, Header, errText, useAdmin } from './common';
import styles from './Admin.module.css';

export function ObjectsSection() {
  const { t } = useAdmin();
  const { org, loading } = useOrganization();
  if (loading) return <p className={styles.muted}>{t('reading')}</p>;
  if (!org) return <p className={styles.muted}>{t('no_org')}</p>;
  return <Objects key={org.id} org={org} />;
}

function Objects({ org }: { org: OrganizationRef }) {
  const { t, language } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const [types, setTypes] = useState<CatalogType[] | null>(null);
  // `gts_id -> title`, from the types-registry: the catalogue of meaning (ADR-0013).
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [objectCounts, setObjectCounts] = useState<Record<string, TypeCount> | null>(null);
  const [lens, setLens] = useState<Lens>('all');
  const [query, setQuery] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .catalogTypes({ orgId: org.id })
      .fetch({ staleTime: 0 })
      .then(
        ({ types: list }) => live && setTypes(list ?? []),
        (e: unknown) => {
          if (!live) return;
          setErr(errText(e));
          setTypes([]);
        }
      );
    return () => {
      live = false;
    };
  }, [api, org.id, tick]);

  useEffect(() => {
    let live = true;
    api
      .typeCounts({ orgId: org.id })
      .fetch({ staleTime: 0 })
      .then(
        ({ counts }) => {
          if (!live) return;
          const next: Record<string, TypeCount> = {};
          for (const c of counts ?? []) next[c.leaf_id] = c;
          setObjectCounts(next);
        },
        // A count that cannot be taken leaves the column blank: zero would be a claim nothing checked.
        () => live && setObjectCounts(null)
      );
    return () => {
      live = false;
    };
  }, [api, org.id]);

  useEffect(() => {
    let live = true;
    api.gtsTypeTitles.fetch({ staleTime: 0 }).then(
      ({ entities }) => {
        if (!live) return;
        const next: Record<string, string> = {};
        for (const e of entities ?? []) {
          const title = e.content?.title?.trim();
          if (title) next[e.gts_id] = title;
        }
        setTitles(next);
      },
      // A registry that will not answer costs the names, not the page.
      () => live && setTitles({})
    );
    return () => {
      live = false;
    };
  }, [api]);

  const nameOf = useCallback(
    (ct: CatalogType) => titles[ct.leaf_id] ?? titles[ct.type_id] ?? titleize(shortName(ct.leaf_id)),
    [titles]
  );

  const toggle = async (ct: CatalogType) => {
    setBusy(ct.leaf_id);
    setErr(null);
    try {
      await api.setTypeComponent(org.id, ct.leaf_id).fetch({ component: !ct.component });
      // The server prunes a mark that agrees with what the tenant inherits: read it back.
      setTick((n) => n + 1);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (types ?? [])
      .filter((ct) => inLens(ct, lens))
      .filter((ct) => !q || ct.leaf_id.toLowerCase().includes(q) || nameOf(ct).toLowerCase().includes(q))
      .sort(byComponentThenId);
  }, [types, lens, query, nameOf]);

  const counts = useMemo(() => {
    const all = types ?? [];
    return Object.fromEntries(LENSES.map((l) => [l, all.filter((ct) => inLens(ct, l)).length])) as Record<Lens, number>;
  }, [types]);

  return (
    <>
      <Header
        title={t('objects_title')}
        status={
          types !== null && (
            <>
              <span className={styles.sub}>{t.count('objects_types', counts.all)}</span>
              <Badge variant={counts.components > 0 ? 'success' : 'secondary'}>
                {t.count('objects_components', counts.components)}
              </Badge>
            </>
          )
        }
        info={
          <>
            <p>{t('objects_about')}</p>
            <p>{t('objects_about_counts')}</p>
          </>
        }
      />

      <div className={styles.toolbar}>
        <div className={styles.lenses}>
          {LENSES.map((l) => (
            <Button
              key={l}
              size="sm"
              variant={lens === l ? 'secondary' : 'ghost'}
              aria-pressed={lens === l}
              onClick={() => setLens(l)}
              data-objects-lens={l}
            >
              {t(`objects_lens_${l}`)} <span className={styles.sub}>{counts[l]}</span>
            </Button>
          ))}
        </div>
        <Input
          className={styles.search}
          value={query}
          placeholder={t('objects_search')}
          aria-label={t('objects_search')}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {err && <ErrorLine>{err}</ErrorLine>}

      <Card data-objects>
        <CardContent className={styles.cardBody}>
          {types === null ? (
            <p className={styles.muted}>{t('objects_reading')}</p>
          ) : visible.length === 0 ? (
            counts.all === 0 ? (
              <div>
                <p className={styles.name}>{t('objects_empty')}</p>
                <p className={styles.muted}>{t('objects_empty_hint')}</p>
              </div>
            ) : (
              <p className={styles.muted}>{t('objects_no_match')}</p>
            )
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('objects_col_component')}</TableHead>
                  <TableHead>{t('objects_col_type')}</TableHead>
                  <TableHead className={styles.num}>{t('objects_col_objects')}</TableHead>
                  <TableHead>{t('objects_col_namespace')}</TableHead>
                  <TableHead>{t('objects_col_page')}</TableHead>
                  <TableHead>{t('objects_col_id')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((ct) => {
                  const companion = COMPANION_TYPES.has(ct.leaf_id);
                  const count = objectCounts?.[ct.leaf_id];
                  return (
                    <TableRow key={ct.leaf_id} data-object-type={ct.leaf_id}>
                      <TableCell>
                        <Checkbox
                          checked={ct.component}
                          // An abstract type is a family: never instantiated, so a page of it would stay empty.
                          disabled={ct.is_abstract || companion || busy === ct.leaf_id}
                          title={companion ? t('objects_companion') : undefined}
                          onCheckedChange={() => void toggle(ct)}
                          aria-label={t('objects_treat_as_component', { name: nameOf(ct) })}
                        />
                      </TableCell>
                      <TableCell>
                        <span className={styles.name}>{nameOf(ct)}</span>{' '}
                        {ct.is_abstract && <Badge variant="secondary">{t('objects_family')}</Badge>}{' '}
                        {!ct.type_id && (
                          <Badge variant="warning" title={t('objects_no_nodes_hint')}>
                            {t('objects_no_nodes')}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className={styles.num}>
                        {!objectCounts || !count ? (
                          <span className={styles.sub}>—</span>
                        ) : count.count === 0 ? (
                          <span className={styles.sub}>0</span>
                        ) : (
                          <span title={count.capped ? t('objects_capped', { count: count.count }) : undefined}>
                            {count.count.toLocaleString(language)}
                            {count.capped && '+'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className={styles.sub}>{familyOf(ct.leaf_id)}</TableCell>
                      <TableCell>
                        <Badge variant={ct.schema === 'tenant' ? 'info' : 'secondary'}>
                          {t(`objects_schema_${ct.schema}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <code className={`${styles.mono} ${styles.sub}`}>{ct.leaf_id}</code>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
