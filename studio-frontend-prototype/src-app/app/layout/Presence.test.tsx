import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/app/i18n/shellTranslations', () => import('@frontx-test-utils/shellText'));

import { PresenceNotes } from './Presence';

describe('PresenceNotes', () => {
  afterEach(cleanup);

  it('renders nothing while nobody wrote', () => {
    const { container } = render(<PresenceNotes notes={[]} onDismiss={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows who wrote, when and what, and dismisses one on its button', () => {
    const onDismiss = vi.fn();
    render(
      <PresenceNotes
        now={10 * 60_000}
        onDismiss={onDismiss}
        notes={[
          { id: 'n1', from_user_id: 'u2', from_display_name: 'Bob', text: 'Lunch?', sent_ms: 5 * 60_000 },
          { id: 'n2', from_user_id: 'u3', text: 'Ping', sent_ms: 10 * 60_000 },
        ]}
      />
    );
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('Lunch?')).toBeTruthy();
    expect(screen.getByText('5m ago')).toBeTruthy();
    // A sender who gave no name reads as their id.
    expect(screen.getByText('u3')).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText('Dismiss')[0]);
    expect(onDismiss).toHaveBeenCalledWith('n1');
  });
});
