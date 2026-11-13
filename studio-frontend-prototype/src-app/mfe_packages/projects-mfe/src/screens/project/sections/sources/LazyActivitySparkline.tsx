/**
 * The week's sparkline, loaded when a Sources table first draws one.
 *
 * It is the only Recharts user in projects-mfe, and imported directly it put
 * Recharts into the chunk every project screen loads — Overview, Specs and
 * Settings included. Behind `React.lazy` it is a chunk of its own (the
 * build's `__frontx_lazy` rewrite keeps it in the MFE's realm, ADR-0022).
 *
 * Until it arrives the cell keeps the chart's box and its accessible name, so
 * the row neither jumps nor reads differently.
 */

import React, { Suspense } from 'react';
import type { ActivitySparklineProps } from './ActivitySparkline';
import styles from './ActivitySparkline.module.css';

const ActivitySparkline = React.lazy(() =>
  import('./ActivitySparkline').then((module) => ({ default: module.ActivitySparkline }))
);

export const LazyActivitySparkline: React.FC<ActivitySparklineProps> = (props) => (
  <Suspense fallback={<span role="img" aria-label={props.label} className={styles.chart} data-sparkline-pending />}>
    <ActivitySparkline {...props} />
  </Suspense>
);

LazyActivitySparkline.displayName = 'LazyActivitySparkline';
