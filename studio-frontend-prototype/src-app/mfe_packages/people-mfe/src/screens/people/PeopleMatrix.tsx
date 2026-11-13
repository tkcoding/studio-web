/** Everyone × every project at once — the prototype's `PeopleMatrix` (`people-org.tsx`). */

import {
  initials,
  matrixColumns,
  roleAbbr,
  type AccessModel,
  type Intensity,
  type OrgProject,
  type PersonProject,
  type PersonRow,
  type ScreenText,
} from '@constructor-studio/mfe-shared';
import { PersonPhoto } from './ProjectMarks';
import { activityWords } from './words';
import styles from './PeopleScreen.module.css';

export function PeopleMatrix({
  people,
  projects,
  model,
  t,
  rowsOf,
  onCell,
  onPerson,
}: {
  people: readonly PersonRow[];
  projects: readonly OrgProject[];
  model: AccessModel;
  t: ScreenText;
  rowsOf: (personId: string) => PersonProject[];
  onCell: (project: OrgProject) => void;
  onPerson: (p: PersonRow) => void;
}) {
  const groups = matrixColumns(projects);
  if (!projects.length)
    return (
      <div className={styles.empty} data-people-matrix-empty>
        <strong>{t('matrix_empty_title')}</strong>
        <span className={styles.muted}>{t('matrix_empty_body')}</span>
      </div>
    );
  return (
    <div className={styles.matrixWrap} data-people-matrix>
      <table className={styles.matrix}>
        <thead>
          <tr>
            <th rowSpan={2} className={styles.mxCorner}>
              {t('col_person')}
            </th>
            {groups.map((g) => (
              <th key={g.id} colSpan={g.projects.length} className={styles.mxWs} scope="colgroup">
                {g.name}
              </th>
            ))}
          </tr>
          <tr>
            {groups.flatMap((g) =>
              g.projects.map((p, i) => (
                <th key={p.id} scope="col" className={`${styles.mxProj}${i === 0 ? ` ${styles.wsFirst}` : ''}`} title={p.name}>
                  <span className={styles.projMark} aria-hidden>
                    {initials(p.name)}
                  </span>
                  <span className={styles.mxProjName}>{p.name}</span>
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {people.map((person) => {
            const byProject = new Map(rowsOf(person.id).map((r) => [r.project.id, r]));
            return (
              <tr key={person.id}>
                <th scope="row" className={styles.mxPerson}>
                  <button type="button" className={styles.mxPersonBtn} onClick={() => onPerson(person)}>
                    <PersonPhoto name={person.name} url={person.avatarUrl} />
                    <span>{person.name}</span>
                  </button>
                </th>
                {groups.flatMap((g) =>
                  g.projects.map((p, i) => {
                    const r = byProject.get(p.id);
                    const intensity: Intensity = r?.intensity ?? 0;
                    const granted = model === 'roles' ? !!r?.access : true;
                    const role = r?.access?.roleName ?? '';
                    const what = activityWords(r?.activity, t);
                    const label = t('matrix_cell', {
                      person: person.name,
                      project: p.name,
                      access: granted
                        ? model === 'roles'
                          ? role
                          : t('matrix_access_tenant', { role })
                        : t('no_role'),
                      activity: intensity ? what : t('chip_no_activity'),
                    });
                    return (
                      <td key={p.id} className={i === 0 ? styles.wsFirst : undefined}>
                        <button
                          type="button"
                          className={`${styles.mxCell} ${styles[`i${intensity}`]}${granted && model === 'roles' ? ` ${styles.granted}` : ''}`}
                          title={`${label}\n${t('matrix_open', { project: p.name })}`}
                          aria-label={label}
                          onClick={() => onCell(p)}
                          data-matrix-cell={`${person.id}:${p.id}`}
                        >
                          {model === 'roles' ? (granted ? roleAbbr(role) : '') : intensity ? roleAbbr(role) : ''}
                        </button>
                      </td>
                    );
                  })
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
