import React from 'react';
import styles from '../ProjectListScreen.module.css';

/**
 * Muted placeholder for a cell with nothing to show. The label says which kind
 * of nothing, as a title rather than text, so the cell stays one dash wide.
 */
export const NoData: React.FC<{ label: string }> = ({ label }) => (
  <span className={styles.noData} title={label}>
    —
  </span>
);

NoData.displayName = 'NoData';
