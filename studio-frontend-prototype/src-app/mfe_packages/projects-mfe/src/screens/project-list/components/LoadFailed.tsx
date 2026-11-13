import React from 'react';
import { TriangleAlert } from 'lucide-react';
import styles from '../ProjectListScreen.module.css';

/**
 * A cell whose value could not be read — as opposed to a cell whose value is
 * absent, which is `NoData`.
 */
export const LoadFailed: React.FC<{ label: string }> = ({ label }) => (
  <span className={styles.loadFailed} title={label}>
    <TriangleAlert size={12} strokeWidth={1.6} aria-hidden />
    <span className={styles.srOnly}>{label}</span>
  </span>
);

LoadFailed.displayName = 'LoadFailed';
