import React from 'react';
import { createPortal } from 'react-dom';
import { Bar, BarChart, Rectangle, XAxis, YAxis, type BarShapeProps } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@gears-frontx/ui-kit';
import styles from './ActivitySparkline.module.css';

// `.chart` in ActivitySparkline.module.css, until Recharts measures it.
const SIZE = { width: 96, height: 24 };
const NO_MARGIN = { top: 0, right: 0, bottom: 0, left: 0 };
const ESCAPE = { x: true, y: true };

export interface ActivitySparklineProps {
  days: readonly number[];
  max: number;
  series: string;
  label: string;
  dayLabel: (daysBack: number) => string;
  container?: HTMLElement | null;
}

const barShape = (props: BarShapeProps) => (
  <Rectangle {...props} fill={props.payload?.prs === 0 ? 'var(--border)' : 'var(--color-prs)'} />
);

/** Under the chart in the window's top half, over it in the bottom half. */
function tooltipPlace(chart: DOMRect): React.CSSProperties {
  return chart.top < window.innerHeight / 2
    ? { top: chart.bottom, left: chart.left }
    : { bottom: window.innerHeight - chart.top, left: chart.left };
}

export const ActivitySparkline: React.FC<ActivitySparklineProps> = ({
  days,
  max,
  series,
  label,
  dayLabel,
  container,
}) => {
  const [place, setPlace] = React.useState<React.CSSProperties | null>(null);
  const [layer, setLayer] = React.useState<HTMLDivElement | null>(null);
  const config = React.useMemo<ChartConfig>(
    () => ({ prs: { label: series, color: 'var(--primary)' } }),
    [series]
  );
  const data = days.map((prs, index) => ({ day: dayLabel(days.length - 1 - index), prs }));
  const placeTooltip = (event: React.PointerEvent<HTMLDivElement>) =>
    setPlace(tooltipPlace(event.currentTarget.getBoundingClientRect()));

  return (
    <>
      <ChartContainer
        config={config}
        initialDimension={SIZE}
        className={styles.chart}
        role="img"
        aria-label={label}
        onPointerEnter={placeTooltip}
      >
        <BarChart data={data} margin={NO_MARGIN} barSize={4} accessibilityLayer={false}>
          <XAxis dataKey="day" hide />
          <YAxis domain={[0, max]} hide />
          <ChartTooltip
            cursor={false}
            allowEscapeViewBox={ESCAPE}
            portal={layer}
            content={
              <ChartTooltipContent
                formatter={(value) => (
                  <span className={styles.tooltipRow}>
                    <span className={styles.tooltipName}>{series}</span>
                    <span className={styles.tooltipValue}>{String(value)}</span>
                  </span>
                )}
              />
            }
          />
          <Bar
            dataKey="prs"
            radius={[2, 2, 0, 0]}
            minPointSize={1}
            isAnimationActive={false}
            shape={barShape}
          />
        </BarChart>
      </ChartContainer>
      {container &&
        place &&
        createPortal(<div ref={setLayer} className={styles.tooltipLayer} style={place} />, container)}
    </>
  );
};

ActivitySparkline.displayName = 'ActivitySparkline';
