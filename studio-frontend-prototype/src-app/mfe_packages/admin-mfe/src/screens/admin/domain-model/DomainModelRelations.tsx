/**
 * A type's relations and its GTS ids, as the prototype's Domain model drew
 * them (`Relations`, `LinkList`, `GtsIds` in
 * `studio-frontend-poc/src/domain-model-admin.tsx`): a small map of the type
 * among the types it is tied to — what it points at on the right, what points
 * at it on the left, a dashed line for a relation a base declares — and the
 * same as two lists. Choosing a type opens it.
 */

import { useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@gears-frontx/ui-kit';
import { linksOf, originOf, type Link } from '../../../model/domain-origin';
import type { DomainModel } from '../../../model/domain-runtime';
import { useAdmin } from '../common';
import styles from '../Admin.module.css';
import own from './DomainModel.module.css';

export function Relations({
  model,
  id,
  counts,
  onPick,
}: {
  model: DomainModel;
  id: string;
  counts: Record<string, number> | null;
  onPick: (id: string) => void;
}) {
  const { t } = useAdmin();
  const { out, in: into } = useMemo(() => linksOf(model, id), [model, id]);
  const name = (x: string) => model.byId.get(x)?.name ?? x;
  if (out.length === 0 && into.length === 0) {
    return (
      <section className={own.relations} data-dm-relations>
        <h4 className={own.h4}>{t('dm_relations')}</h4>
        <p className={styles.muted}>{t('dm_no_relations')}</p>
      </section>
    );
  }
  // One node per neighbour, around the type: what it points at on the
  // right half, what points at it on the left.
  const right = [...new Map(out.map((l) => [l.other, l])).values()];
  const left = [
    ...new Map(into.filter((l) => !right.some((r) => r.other === l.other)).map((l) => [l.other, l])).values(),
  ];
  const rows = Math.max(right.length, left.length, 1);
  const H = Math.max(160, rows * 28 + 24);
  const W = 720;
  const cx = W / 2;
  const cy = H / 2;
  const y = (i: number, n: number) => (n === 1 ? cy : 20 + (i * (H - 40)) / (n - 1));
  const node = (x: string, at: number, yy: number, anchor: 'start' | 'end') => {
    const entity = model.byId.get(x);
    const origin = entity ? originOf(model, entity).key : 'earlier';
    return (
      <g
        key={`${anchor}-${x}`}
        className={own.node}
        onClick={() => onPick(x)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onPick(x);
        }}
        role="button"
        tabIndex={0}
        data-dm-node={x}
      >
        <title>{counts ? t.count('dm_node_objects', counts[x] ?? 0, { name: name(x) }) : name(x)}</title>
        <circle cx={at} cy={yy} r={5} className={own[`fill_${origin}`]} />
        <text x={anchor === 'start' ? at + 9 : at - 9} y={yy + 4} textAnchor={anchor}>
          {name(x)}
        </text>
      </g>
    );
  };
  const edge = (l: Link, x: number, yy: number, outward: boolean) => (
    <path
      key={`e-${outward}-${l.other}-${l.name}`}
      d={`M${cx},${cy} C${(cx + x) / 2},${cy} ${(cx + x) / 2},${yy} ${x},${yy}`}
      className={`${own.edge} ${outward ? '' : own.edgeIn} ${l.inherited ? own.edgeInherited : ''}`}
      markerEnd={outward ? 'url(#dm-arrow)' : undefined}
      markerStart={outward ? undefined : 'url(#dm-arrow-back)'}
    />
  );
  return (
    <section className={own.relations} data-dm-relations>
      <h4 className={own.h4}>{t('dm_relations')}</h4>
      <p className={styles.muted}>{t('dm_relations_hint', { name: name(id) })}</p>
      <div className={own.svgWrap}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          className={own.svg}
          role="img"
          aria-label={t('dm_relations_of', { name: name(id) })}
        >
          <defs>
            <marker id="dm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" className={own.arrowhead} />
            </marker>
            <marker id="dm-arrow-back" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M10,0 L0,5 L10,10 z" className={own.arrowhead} />
            </marker>
          </defs>
          {right.map((l, i) => edge(l, W - 200, y(i, right.length), true))}
          {left.map((l, i) => edge(l, 200, y(i, left.length), false))}
          {right.map((l, i) => node(l.other, W - 200, y(i, right.length), 'start'))}
          {left.map((l, i) => node(l.other, 200, y(i, left.length), 'end'))}
          <g className={own.center}>
            <rect x={cx - 70} y={cy - 16} width={140} height={32} rx={8} />
            <text x={cx} y={cy + 5} textAnchor="middle">
              {name(id)}
            </text>
          </g>
        </svg>
      </div>
      <div className={own.linkLists}>
        <LinkList title={t('dm_points_at', { name: name(id) })} links={out} model={model} onPick={onPick} />
        <LinkList title={t('dm_pointed_at', { name: name(id) })} links={into} model={model} onPick={onPick} />
      </div>
    </section>
  );
}

function LinkList({
  title,
  links,
  model,
  onPick,
}: {
  title: string;
  links: Link[];
  model: DomainModel;
  onPick: (id: string) => void;
}) {
  const { t } = useAdmin();
  return (
    <div>
      <div className={own.listTitle}>
        {title} ({links.length})
      </div>
      {links.length === 0 ? (
        <p className={styles.muted}>—</p>
      ) : (
        <ul className={own.links}>
          {links.map((l) => (
            <li key={`${l.name}-${l.other}`}>
              <code className={styles.mono}>{l.name}</code>{' '}
              <span className={styles.sub}>{l.label !== l.name ? l.label : ''}</span>{' '}
              <button type="button" className={own.linkButton} onClick={() => onPick(l.other)}>
                {model.byId.get(l.other)?.name ?? l.other}
              </button>
              {l.kind && (
                <span className={styles.sub} title={model.gts.relations[l.kind]?.type}>
                  {' '}
                  · {l.kind}
                </span>
              )}
              {l.inherited && <span className={styles.sub}> · {t('dm_inherited')}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The GTS ids the type and the edge kinds of its relations are registered
 *  under, as the server reports them: ours, and the one graph-storage keeps. */
export function GtsIds({ model, id }: { model: DomainModel; id: string }) {
  const { t } = useAdmin();
  const type = model.gts.types[id];
  const kinds = useMemo(() => {
    const { out, in: into } = linksOf(model, id);
    return [...new Set([...out, ...into].map((l) => l.kind).filter((k): k is string => !!k))].sort();
  }, [model, id]);
  if (!type) return null;
  return (
    <details className={own.gts} data-dm-gts>
      <summary>
        GTS <code className={styles.mono}>{type.type}</code>
      </summary>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('dm_gts_registered_as')}</TableHead>
            <TableHead>{t('dm_gts_type')}</TableHead>
            <TableHead>{t('dm_gts_stored_as')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>{t('dm_gts_node_type')}</TableCell>
            <TableCell>
              <code className={styles.mono}>{type.type}</code>
            </TableCell>
            <TableCell>
              <code className={`${styles.mono} ${styles.sub}`}>{type.stored_as}</code>
            </TableCell>
          </TableRow>
          {kinds.map((k) => {
            const edge = model.gts.relations[k];
            return (
              <TableRow key={k}>
                <TableCell>{t('dm_gts_edge_type', { kind: k })}</TableCell>
                <TableCell>{edge ? <code className={styles.mono}>{edge.type}</code> : '—'}</TableCell>
                <TableCell>{edge ? <code className={`${styles.mono} ${styles.sub}`}>{edge.stored_as}</code> : ''}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </details>
  );
}
