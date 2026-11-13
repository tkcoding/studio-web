import React from 'react';
import { useProjectCreateText } from '../i18n';

export const SelectionNote: React.FC<{ count: number; atCap: boolean }> = ({ count, atCap }) => {
  const t = useProjectCreateText();

  if (count === 0) return <>{t('selected_none')}</>;
  if (atCap) return <>{t('selected_max', { n: count })}</>;
  return <>{t.count('selected', count)}</>;
};

SelectionNote.displayName = 'SelectionNote';
