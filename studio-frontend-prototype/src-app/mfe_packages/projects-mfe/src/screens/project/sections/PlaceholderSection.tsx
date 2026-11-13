import React from 'react';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle, Skeleton } from '@gears-frontx/ui-kit';
import styles from './PlaceholderSection.module.css';

export const PlaceholderSection: React.FC<{ title: string; note: string }> = ({ title, note }) => (
  <Empty className={styles.empty}>
    <EmptyHeader>
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription>{note}</EmptyDescription>
    </EmptyHeader>
  </Empty>
);

PlaceholderSection.displayName = 'PlaceholderSection';

export const PlaceholderSkeleton: React.FC = () => (
  <div className={styles.skeleton}>
    <Skeleton className={styles.skeletonBlock} />
    <Skeleton className={styles.skeletonBlock} />
  </div>
);

PlaceholderSkeleton.displayName = 'PlaceholderSkeleton';
