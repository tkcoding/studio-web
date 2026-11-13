import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog, NameDialog } from './dialogs';

const labels = { cancel: 'Cancel', close: 'Close' };

afterEach(cleanup);

describe('ConfirmDialog', () => {
  it('closes once the write succeeds', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn(() => Promise.resolve());
    render(<ConfirmDialog open title="Delete?" body="Gone." confirmLabel="Delete" labels={labels} onConfirm={onConfirm} onClose={onClose} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Delete'));
    });
    expect(onConfirm).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("stays open with the gear's refusal", async () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete?"
        body="Gone."
        confirmLabel="Delete"
        labels={labels}
        onConfirm={() => Promise.reject(new Error('still has projects'))}
        onClose={onClose}
      />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Delete'));
    });
    expect(screen.getByRole('alert').textContent).toBe('still has projects');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('NameDialog', () => {
  const dialog = (onSave: (n: string) => Promise<unknown>, onClose = vi.fn()) =>
    render(
      <NameDialog
        open
        title="Rename"
        fieldLabel="Name"
        initial="Old"
        saveLabel="Save"
        savingLabel="Saving…"
        labels={labels}
        onSave={onSave}
        onClose={onClose}
      />
    );

  it('saves a changed, trimmed name', async () => {
    const onSave = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();
    dialog(onSave, onClose);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  New  ' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });
    expect(onSave).toHaveBeenCalledWith('New');
    expect(onClose).toHaveBeenCalled();
  });

  it('just closes on an unchanged name', async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    dialog(onSave, onClose);
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the name and shows the gear's refusal", async () => {
    const onClose = vi.fn();
    dialog(() => Promise.reject(new Error('name taken')), onClose);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Taken' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });
    expect(screen.getByRole('alert').textContent).toBe('name taken');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Taken');
    expect(onClose).not.toHaveBeenCalled();
  });
});
