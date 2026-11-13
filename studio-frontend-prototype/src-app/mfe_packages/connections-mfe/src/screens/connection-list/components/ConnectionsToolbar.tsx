import React from 'react';
import { Search } from 'lucide-react';
import { Button, Input, Skeleton } from '@gears-frontx/ui-kit';
import { useConnectionListText } from '../../../i18n';
import { useMfeBridge } from '@gears-frontx/react';
import { openConnectDialog } from '../../../actions/connectActions';
import styles from '../ConnectionListScreen.module.css';

interface ConnectionsToolbarProps {
  query: string;
  onQueryChange: (query: string) => void;
  busy: boolean;
}

export const ConnectionsToolbar: React.FC<ConnectionsToolbarProps> = ({
  query,
  onQueryChange,
  busy,
}) => {
  const t = useConnectionListText();
  const bridge = useMfeBridge();

  return (
    <div className={styles.toolbar} role="toolbar" aria-label={t('toolbar_label')}>
      <h2 className={styles.title}>
        {busy ? <Skeleton className={styles.titleSkeleton} /> : t('title')}
      </h2>

      <div className={styles.controls}>
        <Input
          className={styles.search}
          type="search"
          value={query}
          icon={<Search size={16} strokeWidth={1.3} />}
          placeholder={t('search_placeholder')}
          onChange={(event) => onQueryChange(event.target.value)}
          aria-label={t('search_placeholder')}
        />
        <Button size="sm" onClick={() => openConnectDialog(bridge)}>
          {t('connect_source')}
        </Button>
      </div>
    </div>
  );
};

ConnectionsToolbar.displayName = 'ConnectionsToolbar';
