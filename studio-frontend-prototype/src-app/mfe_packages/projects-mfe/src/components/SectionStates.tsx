// What a project section's table shows before it has rows: the load, and a failed read.

import React from 'react';
import { Button, Skeleton } from '@gears-frontx/ui-kit';
import styles from './SectionStates.module.css';

export const SectionSkeleton: React.FC = () => (
  <div className={styles.block}>
    <Skeleton className={styles.stripSkeleton} />
    <Skeleton className={styles.tableSkeleton} />
  </div>
);

SectionSkeleton.displayName = 'SectionSkeleton';

interface ReadFailedProps {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}

export const ReadFailed: React.FC<ReadFailedProps> = ({ message, retryLabel, onRetry }) => (
  <div className={`${styles.block} ${styles.failed}`}>
    <p className={styles.error} role="alert">
      {message}
    </p>
    <Button variant="outline" size="sm" className={styles.retry} onClick={onRetry}>
      {retryLabel}
    </Button>
  </div>
);

ReadFailed.displayName = 'ReadFailed';
