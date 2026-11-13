import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

/** The pins in the top bar: where the prototype's rail kept them. */

const { mockEventBus } = vi.hoisted(() => ({ mockEventBus: { emit: vi.fn() } }));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  eventBus: mockEventBus,
}));
vi.mock('@/app/i18n/shellTranslations', () => import('@frontx-test-utils/shellText'));

import { PinsMenu } from './PinsMenu';
import { PINS_KEY, type Pin } from '@/app/pins/pins';
import { resetPinsForTests } from '@/app/pins/usePins';

const specs: Pin = {
  route: { token: 'projects', org: 'o1', workspace: 'w1', project: 'p1', section: 'specs' },
  label: 'Specs',
  where: ['Acme', 'Work', 'Atlas'],
};
const people: Pin = { route: { token: 'people', org: 'o1' }, label: 'People', where: ['Acme'] };

function withPins(pins: Pin[]) {
  localStorage.setItem(PINS_KEY, JSON.stringify(pins));
  resetPinsForTests();
}

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Pinned' }));

describe('PinsMenu', () => {
  beforeEach(() => withPins([]));

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.removeItem(PINS_KEY);
    resetPinsForTests();
  });

  it('says how to pin while nothing is pinned', () => {
    render(<PinsMenu />);
    open();
    expect(screen.getByText('Nothing pinned yet.')).toBeTruthy();
  });

  it('lists the pins in the order they were pinned, with where each one is', () => {
    withPins([specs, people]);
    render(<PinsMenu />);
    open();
    const rows = Array.from(document.querySelectorAll('[data-pin]'));
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Acme / Work / Atlas'),
      expect.stringContaining('People'),
    ]);
  });

  it('opens a pin at the address it keeps', () => {
    withPins([specs]);
    render(<PinsMenu />);
    open();
    fireEvent.click(screen.getByText('Specs'));
    expect(mockEventBus.emit).toHaveBeenCalledWith('app/pins/open', { route: specs.route });
  });

  it('unpins without opening', () => {
    withPins([specs, people]);
    render(<PinsMenu />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Unpin Specs' }));
    expect(mockEventBus.emit).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(PINS_KEY)!)).toEqual([people]);
  });
});
