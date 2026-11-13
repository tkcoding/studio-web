import React from 'react';
import styles from '../ConnectionListScreen.module.css';

export const NoData: React.FC<{ label: string }> = ({ label }) => (
  <span className={styles.noData} title={label}>
    —
  </span>
);

NoData.displayName = 'NoData';
