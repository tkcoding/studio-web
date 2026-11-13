/**
 * The project's phase (the built-in Project lifecycle kit, ADR-0068 §7): a
 * chip with the phase, and the moves its lifecycle declares from there as
 * buttons. Shown only where the kit applies to the project — the field
 * exists in the organization's model only then (ADR-0067 §6) — so a project
 * whose organization uninstalled it shows nothing here. The server moves the
 * phase only along a declared transition and words its refusal.
 */

import { useEffect, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import { Badge, Button } from '@gears-frontx/ui-kit';
import { errorMessage } from '@constructor-studio/mfe-shared';
import { ProjectPhaseApiService, type ProjectPhase } from '../../../../api/ProjectStatusApiService';
import type { useOverviewSectionTranslations } from '../../../../i18n';
import styles from './OverviewSection.module.css';

type Text = ReturnType<typeof useOverviewSectionTranslations>['t'];

export function PhaseChip({ projectId, t }: { projectId: string; t: Text }) {
  const [phase, setPhase] = useState<ProjectPhase | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiRegistry
      .getService(ProjectPhaseApiService)
      .phase({ projectId })
      .fetch({ staleTime: 0 })
      .then(
        (p) => alive && setPhase(p),
        () => alive && setPhase(null)
      );
    return () => {
      alive = false;
    };
  }, [projectId]);

  if (!phase || !phase.installed) return null;

  const move = async (to: string) => {
    setBusy(true);
    setProblem(null);
    try {
      setPhase(await apiRegistry.getService(ProjectPhaseApiService).setPhase(projectId).fetch({ phase: to }));
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.phase} data-project-phase={phase.phase ?? 'none'}>
      <span className={styles.muted}>{t('phase_label')}</span>{' '}
      <Badge variant={phase.phase ? 'info' : 'outline'}>{phase.phase ? t(`phase_${phase.phase}`) : t('phase_none')}</Badge>
      {phase.phase_since && (
        <span className={styles.muted}> {t('phase_since', { date: phase.phase_since.slice(0, 10) })}</span>
      )}{' '}
      {phase.next.map((m) => (
        <Button
          key={`${m.transition}:${m.to}`}
          variant="ghost"
          size="sm"
          disabled={busy}
          data-phase-move={m.to}
          onClick={() => void move(m.to)}
        >
          {t('phase_move', { phase: t(`phase_${m.to}`) })}
        </Button>
      ))}
      {problem && (
        <p role="alert" className={styles.error}>
          {problem}
        </p>
      )}
    </div>
  );
}
