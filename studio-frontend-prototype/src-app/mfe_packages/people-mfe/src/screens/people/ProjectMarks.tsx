/**
 * A person's projects as marks: one project with the person's role on it
 * (`ProjectChip`), a row of them (`ProjectStackCell`) and what the marks mean
 * (`ProjectLegend`) — the prototype's `people-org.tsx`, carried over.
 */

import {
  initials,
  type AccessModel,
  type PersonProject,
  type ScreenText,
} from '@constructor-studio/mfe-shared';
import { FEED_DAYS, INSIGHT_DAYS } from './useOrgActivity';
import { activityWords } from './words';
import styles from './PeopleScreen.module.css';

export function PersonPhoto({ name, url, large }: { name: string; url?: string; large?: boolean }) {
  const cls = `${styles.photo}${large ? ` ${styles.photoLarge}` : ''}`;
  return url ? (
    <img className={cls} src={url} alt="" />
  ) : (
    <span className={cls} aria-hidden>
      {initials(name)}
    </span>
  );
}

function ProjectChip({
  row,
  model,
  t,
  onOpen,
}: {
  row: PersonProject;
  model: AccessModel;
  t: ScreenText;
  onOpen: () => void;
}) {
  const active = row.intensity > 0;
  const role = row.access?.roleName ?? t('no_role');
  const what = activityWords(row.activity, t);
  const title = [
    row.project.name,
    row.project.workspaceName,
    model === 'roles'
      ? row.access
        ? t('chip_can_access', { role })
        : t('chip_no_grant')
      : t('chip_tenant_role', { role }),
    active ? t('chip_active', { what }) : t('chip_no_activity'),
  ].join('\n');
  return (
    <button
      type="button"
      className={`${styles.proj} ${active ? styles.projActive : styles.projAccess} ${styles[`i${row.intensity}`]}`}
      title={title}
      aria-label={t('chip_label', {
        project: row.project.name,
        state: active ? t('chip_state_active', { what }) : t('chip_state_access'),
        role,
      })}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      data-person-project={row.project.id}
    >
      <span className={styles.projMark} aria-hidden>
        {initials(row.project.name)}
      </span>
      <span className={styles.projName}>{row.project.name}</span>
      {row.access && <span className={styles.projRole}>{row.access.roleName}</span>}
    </button>
  );
}

/** The "Projects" cell: the projects that matter for this person, then "+N". */
export function ProjectStackCell({
  stack,
  model,
  projectCount,
  hasHandle,
  loading,
  t,
  onOpen,
  onMore,
}: {
  stack: { shown: PersonProject[]; more: number; total: number };
  model: AccessModel;
  projectCount: number;
  hasHandle: boolean;
  loading: boolean;
  t: ScreenText;
  onOpen: (p: PersonProject) => void;
  onMore: () => void;
}) {
  if (stack.total === 0) {
    if (loading) return <span className={styles.muted}>{t('stack_reading')}</span>;
    return (
      <span className={styles.muted} data-people-none>
        {model === 'roles' ? t('stack_no_project') : t('stack_tenant_none', { count: projectCount })}
        {!hasHandle && <span> · {t('stack_no_handle')}</span>}
      </span>
    );
  }
  return (
    <div className={styles.stack}>
      {stack.shown.map((r) => (
        <ProjectChip key={r.project.id} row={r} model={model} t={t} onOpen={() => onOpen(r)} />
      ))}
      {stack.more > 0 && (
        <button
          type="button"
          className={styles.more}
          onClick={(e) => {
            e.stopPropagation();
            onMore();
          }}
          title={t('stack_more_title')}
        >
          +{stack.more}
        </button>
      )}
      {model === 'tenant' && (
        <span className={styles.muted} title={t('stack_of_title')}>
          {t('stack_of', { count: projectCount })}
        </span>
      )}
    </div>
  );
}

/** What the marks mean: "can access" against "active in". */
export function ProjectLegend({ model, t }: { model: AccessModel; t: ScreenText }) {
  return (
    <div className={styles.legend} data-people-legend>
      {model === 'roles' ? (
        <>
          <span className={styles.legendItem}>
            <span className={`${styles.swatch} ${styles.projAccess}`} /> {t('legend_access')}
          </span>
          <span className={styles.legendItem}>
            <span className={`${styles.swatch} ${styles.projActive}`} /> {t('legend_active')}
          </span>
        </>
      ) : (
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.projActive}`} /> {t('legend_active_tenant')}
        </span>
      )}
      <span className={styles.legendItem} aria-label={t('legend_scale')}>
        {t('legend_less')}
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={`${styles.cellSwatch} ${styles[`i${i}`]}`} />
        ))}
        {t('legend_more')}
      </span>
      <details className={styles.about}>
        <summary>{t('legend_about')}</summary>
        <p>{t('legend_about_access')}</p>
        <p>{t('legend_about_active', { feed: FEED_DAYS, insight: INSIGHT_DAYS })}</p>
      </details>
    </div>
  );
}
