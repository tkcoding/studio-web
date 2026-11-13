/**
 * What is inside one kit, before anyone installs it (ADR-0068 §3, §8): the
 * sections of its manifest, each said once — the screens it puts on which
 * level, the types it adds to the Studio domain model, its rules and functions, the
 * services it deploys, what it adds to the Inbox, its MCP tools, the
 * permissions an administrator approves, and the files it writes into a
 * project. An empty section says "nothing", so a kit that brings only files
 * reads as one.
 */

import React from 'react';
import { Badge, Button, Skeleton } from '@gears-frontx/ui-kit';
import type { CatalogKit, KitContents, KitDetail } from '../../api/KitsApiService';
import type { useHomeTranslations } from '../../i18n';
import styles from './HomeScreen.module.css';

type Text = ReturnType<typeof useHomeTranslations>['t'];

/** The card's one line: how much of each kind the kit brings. */
export function contentsSummary(c: KitContents, t: Text): string {
  const parts: string[] = [];
  const add = (n: number, key: string) => n > 0 && parts.push(t(key, { count: n }));
  add(c.screens.length, 'sum_screens');
  add(c.types.length, 'sum_types');
  add(c.rules.length + c.functions.length, 'sum_handlers');
  add(c.services.length, 'sum_services');
  add(c.inbox.length, 'sum_inbox');
  add(c.mcp_tools.length, 'sum_tools');
  add(c.material.length, 'sum_material');
  add(c.kinds.length, 'sum_kinds');
  return parts.join(' · ');
}

function Section({ title, hint, empty, children }: { title: string; hint: string; empty: boolean; children: React.ReactNode }) {
  return (
    <section className={styles.detailSection}>
      <h4 className={styles.detailTitle} title={hint}>
        {title}
      </h4>
      <p className={styles.detailHint}>{hint}</p>
      {empty ? <p className={styles.detailEmpty}>—</p> : children}
    </section>
  );
}

function Named({ items }: { items: { name: string; note?: string | null; tag?: string }[] }) {
  return (
    <ul className={styles.detailList}>
      {items.map((i) => (
        <li key={i.name}>
          <code>{i.name}</code>
          {i.tag && (
            <>
              {' '}
              <Badge variant="secondary">{i.tag}</Badge>
            </>
          )}
          {i.note && <span className={styles.detailNote}> — {i.note}</span>}
        </li>
      ))}
    </ul>
  );
}

export function KitDetailView({
  kit,
  detail,
  failed,
  controls,
  onBack,
  t,
}: {
  kit: CatalogKit;
  detail: KitDetail | null;
  /** The detail could not be read: this Studio's backend predates it, or it refused. */
  failed: boolean;
  /** The installer's badges and buttons, as on the card. */
  controls: React.ReactNode;
  onBack: () => void;
  t: Text;
}) {
  const c = detail?.contents;
  return (
    <article className={styles.detail} data-kit-detail={kit.slug}>
      <Button variant="ghost" size="sm" onClick={onBack}>
        ← {t('back')}
      </Button>
      <header className={styles.detailHeader}>
        <h3 className={styles.title}>{kit.name}</h3>
        <p className={styles.description}>{kit.description}</p>
        <dl className={styles.facts}>
          <dt>{t('publisher')}</dt>
          <dd>{kit.publisher}</dd>
          <dt>{t('version')}</dt>
          <dd>
            <code>{kit.default_version}</code>
          </dd>
          {kit.levels && kit.levels.length > 0 && (
            <>
              <dt>{t('levels')}</dt>
              <dd>{kit.levels.join(', ')}</dd>
            </>
          )}
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
          <dt>{t('described_by')}</dt>
          <dd>{detail?.manifest ?? (detail ? t('described_unknown') : '…')}</dd>
          {detail?.origin && (
            <>
              <dt>{t('origin_from')}</dt>
              <dd data-kit-origin>
                <code>
                  {detail.origin.repository}
                  {detail.origin.path ? `/${detail.origin.path}` : ''}
                </code>{' '}
                {t('origin_ref', { ref: detail.origin.git_ref ?? t('origin_default_branch') })}
              </dd>
              <dt>{t('origin_commit')}</dt>
              <dd>
                <code title={detail.origin.commit}>{detail.origin.commit.slice(0, 12)}</code>
                {' · '}
                {t('origin_added', { at: (detail.origin.refreshed_at ?? detail.origin.added_at).slice(0, 10) })}
              </dd>
            </>
          )}
        </dl>
        {controls}
      </header>

      {failed ? (
        <p className={styles.note}>{t('contents_unavailable')}</p>
      ) : !c ? (
        <Skeleton className={styles.skeletonLine} />
      ) : (
        <div className={styles.detailGrid}>
          <Section title={t('sec_screens')} hint={t('sec_screens_hint')} empty={c.screens.length === 0}>
            <ul className={styles.detailList}>
              {c.screens.map((s) => (
                <li key={`${s.level}:${s.label}:${s.slot ?? ''}`}>
                  <Badge variant="info">{s.level}</Badge> <b>{s.label}</b>{' '}
                  <span className={styles.detailNote}>
                    {s.kind === 'section' ? t('screen_section', { slot: s.slot ?? '' }) : t('screen_tab')}
                    {s.route ? ` · ${s.route}` : ` · ${t('screen_not_here')}`}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title={t('sec_types')} hint={t('sec_types_hint')} empty={c.types.length === 0}>
            <Named items={c.types.map((x) => ({ name: x.name, note: x.description ?? x.gts }))} />
          </Section>
          <Section
            title={t('sec_handlers')}
            hint={t('sec_handlers_hint')}
            empty={c.rules.length + c.functions.length === 0}
          >
            <Named
              items={[
                ...c.rules.map((r) => ({ name: r.name, note: r.description, tag: t('rule') })),
                ...c.functions.map((f) => ({ name: f.name, note: f.description, tag: f.runtime })),
              ]}
            />
          </Section>
          <Section title={t('sec_services')} hint={t('sec_services_hint')} empty={c.services.length === 0}>
            <Named items={c.services.map((x) => ({ name: x.name, note: x.description }))} />
          </Section>
          <Section title={t('sec_inbox')} hint={t('sec_inbox_hint')} empty={c.inbox.length === 0}>
            <Named items={c.inbox.map((x) => ({ name: x.id, note: x.label }))} />
          </Section>
          <Section title={t('sec_tools')} hint={t('sec_tools_hint')} empty={c.mcp_tools.length === 0}>
            <Named items={c.mcp_tools.map((x) => ({ name: x.name, note: x.description }))} />
          </Section>
          <Section
            title={t('sec_permissions')}
            hint={t('sec_permissions_hint')}
            empty={c.permissions.reads.length + c.permissions.writes.length + c.permissions.listens.length === 0}
          >
            <dl className={styles.facts}>
              {(['reads', 'writes', 'listens'] as const).map(
                (k) =>
                  c.permissions[k].length > 0 && (
                    <React.Fragment key={k}>
                      <dt>{t(`perm_${k}`)}</dt>
                      <dd>
                        {c.permissions[k].map((p) => (
                          <div key={p}>
                            <code>{p}</code>
                          </div>
                        ))}
                      </dd>
                    </React.Fragment>
                  )
              )}
            </dl>
          </Section>
          <Section title={t('sec_material')} hint={t('sec_material_hint')} empty={c.material.length === 0}>
            <Named items={c.material.map((x) => ({ name: x.path, note: x.description }))} />
          </Section>
          <Section title={t('sec_kinds')} hint={t('sec_kinds_hint')} empty={c.kinds.length + c.docs.length === 0}>
            <div className={styles.badges}>
              {c.kinds.map((k) => (
                <Badge key={k} variant="secondary">
                  {k}
                </Badge>
              ))}
            </div>
            {c.docs.length > 0 && <Named items={c.docs.map((d) => ({ name: d }))} />}
          </Section>
        </div>
      )}
    </article>
  );
}
