import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STUDIO_SHARED_PROPERTY_SCREENS_AVAILABLE } from '@constructor-studio/mfe-shared';
import type { Inbox, InboxItem } from '../../inbox/types';

const { inbox, mark, requestWorkspace, service, shared } = vi.hoisted(() => {
  const inbox = vi.fn();
  const mark = vi.fn();
  // One instance, as the registry gives: a new one per render would read again on every render.
  const service = {
    inbox: (q: unknown) => ({ fetch: () => inbox(q) }),
    mark: { fetch: (body: unknown) => mark(body) },
  };
  return { inbox, mark, requestWorkspace: vi.fn(), service, shared: { value: {} as Record<string, unknown> } };
});

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
  useMfeBridge: () => null,
  useSharedProperty: (id: string) => shared.value[id] ?? null,
}));
vi.mock('../../actions/workspaceActions', () => ({ requestWorkspace }));

import { InboxGroup } from './InboxGroup';

const t = Object.assign(
  (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
  { count: (key: string, count: number) => `${key} ${count}` }
);

const review: InboxItem = {
  key: 'review:r1',
  source: 'review-requests',
  workspace_id: 'w1',
  workspace_name: 'Main',
  title: 'Billing spec',
  url: null,
  due_at: '2026-11-01T00:00:00Z',
  overdue: true,
  record: { id: 'r1', title: 'Billing spec', requested_by_name: 'Ann' },
};

const pull: InboxItem = {
  key: 'pr:p1@2026-11-09',
  source: 'pull-requests',
  workspace_id: 'w1',
  workspace_name: 'Main',
  title: 'Fix login',
  url: 'https://example.test/acme/web/pull/42',
  due_at: null,
  overdue: false,
  record: {
    id: 'p1',
    repo: 'acme/web',
    number: 42,
    title: 'Fix login',
    waiting: 'review',
    days_open: 3,
    days_since_update: 9,
  },
};

const page = (items: InboxItem[], extra: Partial<Inbox> = {}): Inbox => ({
  items,
  total: items.length,
  other: 0,
  unread: [],
  ...extra,
});

const status = (code: number) => Object.assign(new Error(`HTTP ${code}`), { response: { status: code } });

const phaseWaiting: InboxItem = {
  key: 'kit:project-lifecycle/phase-waiting:obj-1@00ff',
  source: 'kit:project-lifecycle/phase-waiting',
  workspace_id: 'w1',
  workspace_name: 'Main',
  title: 'Atlas waits in its discovery phase',
  url: null,
  due_at: null,
  overdue: false,
  record: { id: 'obj-1', value: { name: 'Atlas', phase: 'discovery' } },
  kit: { slug: 'project-lifecycle', name: 'Project lifecycle', version: '0.1.0' },
};

describe('InboxGroup', () => {
  beforeEach(() => {
    inbox.mockReset();
    mark.mockReset();
    requestWorkspace.mockReset();
    mark.mockResolvedValue({});
    shared.value = {};
  });

  it("offers no way into a kit's tab where that kit is not installed, and keeps Done and Snooze", async () => {
    shared.value = {
      [STUDIO_SHARED_PROPERTY_SCREENS_AVAILABLE]: { routes: ['/organization/overview'], kits: ['project-issues'] },
    };
    inbox.mockResolvedValue(page([phaseWaiting]));
    render(<InboxGroup organizationId="o1" workspaces={1} t={t as never} />);
    expect(await screen.findByText('Atlas waits in its discovery phase')).toBeTruthy();
    expect(document.querySelector('[data-inbox-kit="project-lifecycle"]')?.getAttribute('data-kit-absent')).toBe('true');
    expect(screen.queryByRole('button', { name: 'inbox_open_project' })).toBeNull();
    expect(screen.getByRole('button', { name: 'inbox_done' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'inbox_snooze' })).toBeTruthy();
  });

  it("opens a kit's item where its kit is installed", async () => {
    shared.value = {
      [STUDIO_SHARED_PROPERTY_SCREENS_AVAILABLE]: { routes: [], kits: ['project-lifecycle'] },
    };
    inbox.mockResolvedValue(page([phaseWaiting]));
    render(<InboxGroup organizationId="o1" workspaces={1} t={t as never} />);
    fireEvent.click(await screen.findByRole('button', { name: 'inbox_open_project' }));
    expect(requestWorkspace).toHaveBeenCalledWith(null, { id: 'w1', name: 'Main' }, 'o1');
  });

  it('offers no workspace to open for an item that names none', async () => {
    inbox.mockResolvedValue(page([{ ...phaseWaiting, workspace_id: '', workspace_name: '' }]));
    render(<InboxGroup organizationId="o1" workspaces={1} t={t as never} />);
    await screen.findByText('Atlas waits in its discovery phase');
    expect(screen.queryByRole('button', { name: 'inbox_open_project' })).toBeNull();
  });

  it('shows only the source asked for and tells the screen which sources there are', async () => {
    inbox.mockResolvedValue(page([review, pull, phaseWaiting]));
    const onSources = vi.fn();
    render(<InboxGroup organizationId="o1" workspaces={1} t={t as never} only="pull-requests" onSources={onSources} />);
    expect(await screen.findByText('Fix login')).toBeTruthy();
    expect(screen.queryByText('Billing spec')).toBeNull();
    expect(screen.queryByText('Atlas waits in its discovery phase')).toBeNull();
    expect(onSources).toHaveBeenLastCalledWith([
      { source: 'review-requests', kit: null, count: 1 },
      { source: 'pull-requests', kit: null, count: 1 },
      { source: 'kit:project-lifecycle/phase-waiting', kit: phaseWaiting.kit, count: 1 },
    ]);
  });

  it('reads again when the screen asks, and links to the whole Inbox from the Overview', async () => {
    inbox.mockResolvedValue(page([review]));
    const onOpenInbox = vi.fn();
    const view = render(<InboxGroup organizationId="o1" workspaces={1} t={t as never} onOpenInbox={onOpenInbox} />);
    await screen.findByText('Billing spec');
    expect(inbox).toHaveBeenCalledTimes(1);
    view.rerender(<InboxGroup organizationId="o1" workspaces={1} t={t as never} onOpenInbox={onOpenInbox} reloadKey={1} />);
    await waitFor(() => expect(inbox).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'inbox_open_all' }));
    expect(onOpenInbox).toHaveBeenCalled();
  });

  it("shows a kit's item with its title and the kit's name, and marks it like any other", async () => {
    inbox.mockResolvedValue(page([phaseWaiting]));
    render(<InboxGroup organizationId="o1" workspaces={1} t={t as never} />);
    expect(await screen.findByText('Atlas waits in its discovery phase')).toBeTruthy();
    const badge = document.querySelector('[data-inbox-kit="project-lifecycle"]');
    expect(badge?.textContent).toBe('Project lifecycle');
    fireEvent.click(screen.getByRole('button', { name: 'inbox_done' }));
    await waitFor(() =>
      expect(mark).toHaveBeenCalledWith(expect.objectContaining({ item_key: phaseWaiting.key, state: 'done' }))
    );
  });

  it('draws what the server says waits, and counts it', async () => {
    inbox.mockResolvedValue(page([review, pull]));
    const onCount = vi.fn();
    render(<InboxGroup organizationId="o1" workspaces={1} t={t} onCount={onCount} />);
    expect(screen.getByText('inbox_reading')).toBeTruthy();
    expect(await screen.findByText('Billing spec')).toBeTruthy();
    expect(inbox).toHaveBeenCalledWith({ view: 'open', offset: 0, limit: 200 });
    expect(onCount).toHaveBeenLastCalledWith(2);
    expect(screen.getByText('inbox_overdue')).toBeTruthy();
    // The pull request in the prototype's words for it.
    expect(screen.getByText('your review')).toBeTruthy();
    expect(screen.getByText(/acme\/web#42, Main · open 3 days · quiet for 9 days/)).toBeTruthy();
    expect(screen.getByText('inbox_quiet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'inbox_open_pull' }).getAttribute('href')).toBe(pull.url);
    // A review opens its workspace.
    fireEvent.click(screen.getByRole('button', { name: 'inbox_open_project' }));
    expect(requestWorkspace).toHaveBeenCalledWith(null, { id: 'w1', name: 'Main' }, 'o1');
  });

  it('marks an item done and hides it at once', async () => {
    inbox.mockResolvedValue(page([review, pull]));
    const onCount = vi.fn();
    render(<InboxGroup organizationId="o1" workspaces={1} t={t} onCount={onCount} />);
    await screen.findByText('Billing spec');
    fireEvent.click(screen.getAllByRole('button', { name: 'inbox_done' })[0]);
    expect(mark).toHaveBeenCalledWith({ item_key: 'review:r1', state: 'done', until: null });
    await waitFor(() => expect(screen.queryByText('Billing spec')).toBeNull());
    expect(onCount).toHaveBeenLastCalledWith(1);
    expect(screen.getByText(/inbox_hidden 1/)).toBeTruthy();
  });

  it('snoozes for a day', async () => {
    inbox.mockResolvedValue(page([review]));
    render(<InboxGroup organizationId="o1" workspaces={1} t={t} />);
    await screen.findByText('Billing spec');
    fireEvent.click(screen.getByRole('button', { name: 'inbox_snooze' }));
    const body = mark.mock.calls[0][0] as { state: string; until: string };
    expect(body.state).toBe('snoozed');
    expect(Date.parse(body.until) - Date.now()).toBeGreaterThan(23 * 3_600_000);
  });

  it('shows the hidden ones and unmarks them all', async () => {
    inbox.mockImplementation(({ view }: { view: string }) =>
      Promise.resolve(view === 'hidden' ? page([review], { other: 0 }) : page([], { other: 1 }))
    );
    render(<InboxGroup organizationId="o1" workspaces={1} t={t} />);
    expect(await screen.findByText('inbox_nothing_new 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'inbox_show_them' }));
    expect(await screen.findByText('Billing spec')).toBeTruthy();
    expect(inbox).toHaveBeenCalledWith({ view: 'hidden', offset: 0, limit: 200 });
    fireEvent.click(screen.getByRole('button', { name: 'inbox_unmark_all' }));
    await waitFor(() => expect(mark).toHaveBeenCalledWith({ item_key: 'review:r1', state: 'open', until: null }));
  });

  it('names the sources it could not read rather than saying nothing waits', async () => {
    inbox.mockResolvedValue(page([], { unread: ['pull-requests in Main: 502'] }));
    render(<InboxGroup organizationId="o1" workspaces={1} t={t} />);
    expect(await screen.findByText(/inbox_nothing_read .*pull-requests in Main: 502/)).toBeTruthy();
    expect(screen.queryByText('inbox_nothing')).toBeNull();
  });

  it('says plainly when nothing waits', async () => {
    inbox.mockResolvedValue(page([]));
    render(<InboxGroup organizationId="o1" workspaces={2} t={t} />);
    expect(await screen.findByText('inbox_nothing')).toBeTruthy();
    expect(screen.getByText(/confirm your GitHub account on your Profile/)).toBeTruthy();
  });

  it('shows a 503 as the Inbox being unavailable, not as an empty one', async () => {
    inbox.mockRejectedValue(status(503));
    render(<InboxGroup organizationId="o1" workspaces={1} t={t} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('inbox_unavailable');
    expect(screen.queryByText('inbox_nothing')).toBeNull();
  });
});

describe('InboxGroup: a kit’s endpoint sources beside the shell’s own (constructor-research)', () => {
  // The server reads constructor-research's two endpoint sources
  // (`kind: "endpoint"` in its kit.json) as the caller and lists their rows
  // with the shell's own, keyed `kit:<slug>/<id>:<row>@<stamp>`.
  const research = { slug: 'constructor-research', name: 'Constructor Research', version: '0.9.0' };
  const deployFailed: InboxItem = {
    key: 'kit:constructor-research/deploy-failed:d1@2026-11-10',
    source: 'kit:constructor-research/deploy-failed',
    workspace_id: 'w1',
    workspace_name: 'Main',
    title: 'Shop: the deploy failed',
    url: 'https://research.example.test/apps/shop/deploys/d1',
    due_at: null,
    overdue: true,
    record: { id: 'd1', title: 'Shop: the deploy failed' },
    kit: research,
  };
  const signIn: InboxItem = {
    key: 'kit:constructor-research/sign-in-expires:me@2026-11-12',
    source: 'kit:constructor-research/sign-in-expires',
    workspace_id: '',
    workspace_name: '',
    title: 'Your Constructor Research sign-in runs out tomorrow',
    url: null,
    due_at: '2026-11-12T09:00:00Z',
    overdue: false,
    record: { id: 'me' },
    kit: research,
  };
  const everything = page([review, deployFailed, pull, signIn]);
  const installed = (kits: string[]) => {
    shared.value = { [STUDIO_SHARED_PROPERTY_SCREENS_AVAILABLE]: { routes: ['/constructor-research'], kits } };
  };
  const rowOf = (title: string) => screen.getByText(title).closest('li') as HTMLElement;

  beforeEach(() => {
    inbox.mockReset();
    mark.mockReset();
    mark.mockResolvedValue({});
  });

  it('lists the kit’s rows in the server’s order with the shell’s, each source counted once', async () => {
    installed(['constructor-research']);
    inbox.mockResolvedValue(everything);
    const onSources = vi.fn();
    const onCount = vi.fn();
    render(<InboxGroup organizationId="o1" workspaces={1} t={t as never} onSources={onSources} onCount={onCount} />);
    await screen.findByText('Shop: the deploy failed');
    const kinds = [...document.querySelectorAll('li[data-attention]')].map((li) => li.getAttribute('data-attention'));
    expect(kinds).toEqual([
      'review',
      'kit:constructor-research/deploy-failed',
      'pull',
      'kit:constructor-research/sign-in-expires',
    ]);
    expect(onCount).toHaveBeenLastCalledWith(4);
    expect(onSources).toHaveBeenLastCalledWith([
      { source: 'review-requests', kit: null, count: 1 },
      { source: 'kit:constructor-research/deploy-failed', kit: research, count: 1 },
      { source: 'pull-requests', kit: null, count: 1 },
      { source: 'kit:constructor-research/sign-in-expires', kit: research, count: 1 },
    ]);
  });

  it('opens a failed deploy at its own page and offers no workspace for a sign-in that names none', async () => {
    installed(['constructor-research']);
    inbox.mockResolvedValue(everything);
    render(<InboxGroup organizationId="o1" workspaces={1} t={t as never} />);
    await screen.findByText('Shop: the deploy failed');
    const deploy = rowOf('Shop: the deploy failed');
    expect(deploy.querySelector('a')?.getAttribute('href')).toBe(deployFailed.url);
    expect(deploy.querySelector('[data-inbox-kit="constructor-research"]')?.hasAttribute('data-kit-absent')).toBe(false);
    const sign = rowOf('Your Constructor Research sign-in runs out tomorrow');
    expect(sign.querySelector('a')).toBeNull();
    expect(sign.textContent).not.toContain('inbox_open_project');
    expect(sign.textContent).toContain('inbox_done');
  });

  it('keeps the rows of an uninstalled kit, marked absent, with Done and Snooze but no way in', async () => {
    installed(['project-issues']);
    inbox.mockResolvedValue(everything);
    render(<InboxGroup organizationId="o1" workspaces={1} t={t as never} />);
    await screen.findByText('Shop: the deploy failed');
    const deploy = rowOf('Shop: the deploy failed');
    expect(deploy.querySelector('[data-inbox-kit="constructor-research"]')?.getAttribute('data-kit-absent')).toBe('true');
    expect(deploy.querySelector('a')).toBeNull();
    expect(deploy.textContent).toContain('inbox_done');
    expect(deploy.textContent).toContain('inbox_snooze');
    // The shell's own sources are not the kit's: their way in stays.
    expect(rowOf('Fix login').querySelector('a')?.getAttribute('href')).toBe(pull.url);
  });

  it('marks a kit’s row done under its own key', async () => {
    installed(['constructor-research']);
    inbox.mockResolvedValue(everything);
    render(<InboxGroup organizationId="o1" workspaces={1} t={t as never} />);
    await screen.findByText('Shop: the deploy failed');
    const done = [...rowOf('Shop: the deploy failed').querySelectorAll('button')].find((b) => b.textContent === 'inbox_done')!;
    fireEvent.click(done);
    await waitFor(() =>
      expect(mark).toHaveBeenCalledWith({ item_key: deployFailed.key, state: 'done', until: null })
    );
  });

  it('names a kit source the server could not read beside the rows it could', async () => {
    installed(['constructor-research']);
    inbox.mockResolvedValue(
      page([review, deployFailed], { unread: ['kit:constructor-research/sign-in-expires: 502'] })
    );
    render(<InboxGroup organizationId="o1" workspaces={1} t={t as never} />);
    await screen.findByText('Shop: the deploy failed');
    expect(document.querySelector('[data-inbox-unread]')?.textContent).toContain(
      'kit:constructor-research/sign-in-expires: 502'
    );
  });
});
