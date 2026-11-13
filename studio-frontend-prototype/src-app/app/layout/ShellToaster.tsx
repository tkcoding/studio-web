/** MFEs ask for a toast through the notify action (notifyAction.ts). */

import React from 'react';
import { Toaster } from '@gears-frontx/ui-kit/toast';
import { useShellText } from '@/app/i18n/shellTranslations';

export const ShellToaster: React.FC = () => {
  const t = useShellText();
  return <Toaster limit={2} closeLabel={t('toast_close')} label={t('toast_region')} />;
};

ShellToaster.displayName = 'ShellToaster';
