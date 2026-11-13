import React from 'react';
import { TriangleAlert } from 'lucide-react';
import styles from '../ConnectionListScreen.module.css';

export const LoadFailed: React.FC<{ label: string }> = ({ label }) => (
  <span className={styles.loadFailed} title={label}>
    <TriangleAlert size={12} strokeWidth={1.6} aria-hidden />
    <span className={styles.srOnly}>{label}</span>
  </span>
);

LoadFailed.displayName = 'LoadFailed';
