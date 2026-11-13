import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivitySparkline } from './ActivitySparkline';
import { stubResizeObserver } from '@frontx-test-utils/stubResizeObserver';

/** A week of pull requests as bars on the table's shared scale (#688). */

// jsdom lays nothing out: the chart's container is given its 96×24, and the chart a place, by hand.
const placed = { top: 100, left: 40 };

beforeEach(() => {
  Object.assign(placed, { top: 100, left: 40 });
  stubResizeObserver();
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    if (this.hasAttribute('data-chart')) {
      const { top, left } = placed;
      return { x: left, y: top, top, left, width: 96, height: 24, right: left + 96, bottom: top + 24 } as DOMRect;
    }
    if (!this.classList.contains('recharts-responsive-container')) return measure.call(this);
    return { x: 0, y: 0, top: 0, left: 0, width: 96, height: 24, right: 96, bottom: 24 } as DOMRect;
  });
});

const dayLabel = (back: number) => (back === 0 ? 'Today' : `${back} days ago`);

function sparkline(days: number[], max = 3, container?: HTMLElement) {
  return render(
    <ActivitySparkline
      days={days}
      max={max}
      series="Pull requests"
      label={`Pull requests per day: ${days.join(', ')}`}
      dayLabel={dayLabel}
      container={container}
    />
  );
}

/** Points at the last bar, as a pointer coming over the chart does. */
function hoverToday(view: ReturnType<typeof render>) {
  const chart = view.container.querySelector('[data-chart]') as HTMLElement;
  fireEvent.pointerEnter(chart);
  fireEvent.mouseMove(view.container.querySelector('.recharts-wrapper') as HTMLElement, {
    clientX: 94,
    clientY: 12,
  });
  return chart;
}

const bars = (container: HTMLElement) =>
  [...container.querySelectorAll('.recharts-bar-rectangle path')] as SVGPathElement[];
const heightOf = (bar: SVGPathElement) => Number(bar.getAttribute('height'));

describe('ActivitySparkline', () => {
  it('draws a quiet week as 7 grey ticks', () => {
    const { container } = sparkline([0, 0, 0, 0, 0, 0, 0]);

    expect(bars(container)).toHaveLength(7);
    for (const bar of bars(container)) {
      expect(bar.getAttribute('fill')).toBe('var(--border)');
      expect(heightOf(bar)).toBe(1);
    }
  });

  it('paints the days with pull requests in the series colour', () => {
    const { container } = sparkline([0, 2, 0, 0, 0, 0, 1]);

    expect(bars(container).map((bar) => bar.getAttribute('fill'))).toEqual([
      'var(--border)',
      'var(--color-prs)',
      'var(--border)',
      'var(--border)',
      'var(--border)',
      'var(--border)',
      'var(--color-prs)',
    ]);
  });

  it('draws a count against the shared scale, not its own week', () => {
    const own = sparkline([0, 0, 0, 3, 0, 0, 0], 3);
    const shared = sparkline([0, 0, 0, 3, 0, 0, 0], 6);

    expect(heightOf(bars(shared.container)[3]) * 2).toBe(heightOf(bars(own.container)[3]));
  });

  it('is one image, named by its daily counts, and no Tab stop', () => {
    const { container } = sparkline([0, 1, 0, 0, 2, 0, 0]);

    expect(screen.getByRole('img', { name: 'Pull requests per day: 0, 1, 0, 0, 2, 0, 0' })).toBeTruthy();
    expect(container.querySelector('[tabindex]:not([tabindex="-1"])')).toBeNull();
  });

  it('heads the last bar\'s tooltip Today, with its count', async () => {
    const { container } = sparkline([0, 0, 0, 0, 0, 0, 2]);
    const surface = container.querySelector('.recharts-wrapper') as HTMLElement;

    fireEvent.mouseMove(surface, { clientX: 94, clientY: 12 });

    await waitFor(() => expect(screen.getByText('Today')).toBeTruthy());
    expect(screen.getByText('Pull requests')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  describe('with a container to open its tooltip in', () => {
    const layerIn = (root: HTMLElement) => root.firstElementChild as HTMLElement;

    it('opens it there, out of the table that would clip it', async () => {
      const root = document.body.appendChild(document.createElement('div'));
      const chart = hoverToday(sparkline([0, 0, 0, 0, 0, 0, 2], 3, root));

      await waitFor(() => expect(within(root).getByText('Today')).toBeTruthy());
      expect(chart.contains(within(root).getByText('Today'))).toBe(false);
      root.remove();
    });

    it('opens it under a chart in the top half of the window', () => {
      const root = document.body.appendChild(document.createElement('div'));
      hoverToday(sparkline([0, 0, 0, 0, 0, 0, 2], 3, root));

      expect(layerIn(root).style.top).toBe('124px');
      expect(layerIn(root).style.left).toBe('40px');
      expect(layerIn(root).style.bottom).toBe('');
      root.remove();
    });

    it('opens it over a chart in the bottom half', () => {
      Object.assign(placed, { top: window.innerHeight - 100 });
      const root = document.body.appendChild(document.createElement('div'));
      hoverToday(sparkline([0, 0, 0, 0, 0, 0, 2], 3, root));

      expect(layerIn(root).style.bottom).toBe('100px');
      expect(layerIn(root).style.top).toBe('');
      root.remove();
    });
  });
});
