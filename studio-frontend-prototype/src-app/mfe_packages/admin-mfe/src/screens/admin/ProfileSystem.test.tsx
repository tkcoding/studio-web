import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { service, org, calls } = vi.hoisted(() => ({
  service: {} as Record<string, unknown>,
  org: { value: { id: 'o1', name: 'Acme' } as { id: string; name: string } | null },
  calls: [] as { what: string; arg?: unknown; body?: unknown }[],
}));

vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useOrganization: () => ({ org: org.value, loading: false, failed: false }),
}));
vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
}));

import { ProfileSection } from './ProfileSection';
import { SystemSection } from './SystemSection';

const refused = (status: number, detail: string) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { detail } } });

/** A read: callable with params, or `.fetch()` directly. */
const read = (what: string, value: unknown) => {
  const answer = () => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value));
  const fetch = () => {
    calls.push({ what });
    return answer();
  };
  return Object.assign(
    (arg?: unknown) => {
      calls.push({ what, arg });
      return { fetch: answer };
    },
    { fetch }
  );
};

/** A mutation property: `.fetch(body)`. */
const mutate = (what: string, answer: unknown | ((body: unknown) => unknown) = {}) => ({
  fetch: (body: unknown) => {
    calls.push({ what, body });
    const value = typeof answer === 'function' ? (answer as (b: unknown) => unknown)(body) : answer;
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  },
});

/** A mutation factory taking path params. */
const write = (what: string, answer: unknown = {}) =>
  (...arg: unknown[]) => ({
    fetch: (body: unknown) => {
      calls.push({ what, arg, body });
      return Promise.resolve(answer);
    },
  });

const PROFILE = {
  id: 'p1',
  display_name: 'Ann Person',
  email: 'ann@acme.io',
  avatar_url: 'https://avatars.githubusercontent.com/u/1',
  emails: [{ address: 'ann@acme.io', source: 'sign_in', verified: true, primary: true }],
};

function serve(over: Record<string, unknown> = {}) {
  for (const key of Object.keys(service)) delete service[key];
  Object.assign(service, {
    myProfile: read('myProfile', PROFILE),
    myMemberships: read('myMemberships', {
      items: [
        { org_id: 'o1', role: 'owner', status: 'active', org_name: 'Acme' },
        { org_id: 'o2', role: 'member', status: 'suspended', org_name: 'Beta' },
      ],
    }),
    myLogins: read('myLogins', {
      items: [{ provider: 'keycloak', subject: 'subject-me', verified: true, linked_at_epoch_ms: 1, email: 'ann@acme.io', email_verified: true }],
    }),
    myAliases: read('myAliases', {
      aliases: [{ kind: 'github', external_id: 'ann', confidence: 'confirmed', attributes: true, added_at_epoch_ms: 1 }],
    }),
    getMe: read('getMe', { subject_id: 'subject-me', subject_tenant_id: 'o1' }),
    updateMyProfile: mutate('updateMyProfile', (b: unknown) => ({ ...PROFILE, ...(b as object) })),
    uploadMyAvatar: mutate('uploadMyAvatar', PROFILE),
    deleteMyAvatar: mutate('deleteMyAvatar', PROFILE),
    claimMyAlias: mutate('claimMyAlias', { outcome: 'refused', reason: 'Somebody else proved it', aliases: [] }),
    revokeMyAlias: mutate('revokeMyAlias', { outcome: 'written', aliases: [] }),
    confirmMyAliases: mutate('confirmMyAliases', {
      confirmed: [{ kind: 'github', external_id: 'ann' }],
      already_confirmed: 0,
      skipped_shared: 1,
      refused: [],
    }),
    connectorProviders: read('connectorProviders', {
      items: [
        { provider: 'github', display_name: 'GitHub', category: 'source_code', default_base_url: 'https://api.github.com' },
        { provider: 'kubernetes', display_name: 'Kubernetes', category: 'cluster', default_base_url: '' },
        { provider: 'slack', display_name: 'Slack', category: 'notification', default_base_url: '' },
      ],
    }),
    storedConnections: read('storedConnections', {
      items: [
        { id: 'c1', owner_tenant_id: 'o1', provider: 'github', label: 'Mine', account: 'ann', base_url: '', scope: 'personal', secret_ref: 'r1', created_at_epoch_secs: 0 },
        { id: 'c2', owner_tenant_id: 'o1', provider: 'slack', label: 'Team chat', account: 'bot', base_url: '', scope: 'organization', secret_ref: 'r2', created_at_epoch_secs: 0 },
      ],
    }),
    environments: read('environments', { items: [] }),
    testConnection: write('testConnection', { ok: true, account: 'ann' }),
    connectionRepositories: read('connectionRepositories', { items: [] }),
    presenceOnline: read('presenceOnline', {
      items: [
        { user_id: 'subject-me', display_name: 'Ann Person', tenant_id: 'o1', place: 'system', since_ms: 1, last_seen_ms: 2 },
        { user_id: 'u2', display_name: 'Bob', tenant_id: 'o1', place: 'specs', detail: 'Web', since_ms: 1, last_seen_ms: 3 },
      ],
      total: 2,
      online_ttl_ms: 90_000,
      heartbeat_ms: 30_000,
    }),
    presenceSend: mutate('presenceSend', { delivered: false, waiting: 0 }),
    notifyTargets: read('notifyTargets', { items: [{ id: 'C1', name: 'general', private: false, topic_required: false }] }),
    sendConnectorMessage: write('sendConnectorMessage', { connection_id: 'c2', provider: 'slack', target: 'general' }),
    queueNotification: mutate('queueNotification', { run_id: '1234567890abcdef', poll: '/studio-tasks/v1/runs/1234567890abcdef' }),
    getWorkspaces: read('getWorkspaces', { items: [{ id: 'w1', name: 'Web' }] }),
    gears: read('gears', { gears: [{ name: 'studio-user', capabilities: ['people'], deployment_mode: 'in-process', instances: [{}] }] }),
    oagwUpstreams: read('oagwUpstreams', refused(503, 'oagw is not running')),
    gtsEntities: read('gtsEntities', {
      entities: [
        { gts_id: 'gts.cf.toolkit.authz.permission.v1~cf.studio.people.view.v1', content: { title: 'View people' } },
        { gts_id: 'gts.cf.core.am.tenant_type.v1~', content: { title: 'Tenant type' } },
      ],
    }),
    ...over,
  });
}

beforeEach(() => {
  calls.length = 0;
  org.value = { id: 'o1', name: 'Acme' };
  serve();
});

describe('Profile', () => {
  it('shows the person, their memberships and where a linked photo comes from', async () => {
    render(<ProfileSection />);
    expect((await screen.findByText('Ann Person')).hasAttribute('data-profile-name')).toBe(true);
    const chips = document.querySelector('[data-profile-memberships]') as HTMLElement;
    await waitFor(() => expect(chips.textContent).toContain('Acme · role_owner'));
    expect(chips.textContent).toContain('Beta · role_member · standing_suspended');
    expect(screen.getByText('prof_photo_linked')).toBeTruthy();
    // A linked picture is not one Studio stores, so there is nothing to remove.
    expect(screen.queryByText('prof_photo_remove')).toBeNull();
  });

  it('renames the person through POST /me', async () => {
    render(<ProfileSection />);
    await screen.findByText('Ann Person');
    fireEvent.click(screen.getByText('prof_rename'));
    fireEvent.change(screen.getByLabelText('prof_your_name'), { target: { value: 'Ann P.' } });
    fireEvent.click(screen.getByText('save'));
    await screen.findByText('Ann P.');
    expect(calls.find((c) => c.what === 'updateMyProfile')?.body).toEqual({ display_name: 'Ann P.' });
  });

  it('refuses a photo the backend would not store, without sending it', async () => {
    render(<ProfileSection />);
    await screen.findByText('Ann Person');
    const input = document.querySelector('[data-profile-photo-input]') as HTMLInputElement;
    const svg = new File(['<svg/>'], 'me.svg', { type: 'image/svg+xml' });
    fireEvent.change(input, { target: { files: [svg] } });
    await screen.findByText('prof_photo_type');
    expect(calls.some((c) => c.what === 'uploadMyAvatar')).toBe(false);
  });

  it('lists sign-ins with this session marked, and accounts with how sure Studio is', async () => {
    render(<ProfileSection />);
    const login = await waitFor(() => {
      const el = document.querySelector('[data-profile-login="keycloak"]');
      if (!el) throw new Error('no login');
      return el as HTMLElement;
    });
    expect(login.textContent).toContain('prof_login_studio');
    await waitFor(() => expect(login.textContent).toContain('prof_this_session'));
    const alias = document.querySelector('[data-profile-alias="github:ann"]') as HTMLElement;
    expect(alias.textContent).toContain('prof_confidence_confirmed');
  });

  it('says why a claim was refused, in the gear words', async () => {
    render(<ProfileSection />);
    await waitFor(() => expect(document.querySelector('[data-profile-claim]')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('prof_account'), { target: { value: 'someone' } });
    fireEvent.submit(document.querySelector('[data-profile-claim]') as HTMLFormElement);
    await screen.findByText('Somebody else proved it');
    expect(calls.find((c) => c.what === 'claimMyAlias')?.body).toEqual({ kind: 'github', external_id: 'someone' });
  });

  it('confirms identities and says what the pass found', async () => {
    render(<ProfileSection />);
    fireEvent.click(await waitFor(() => document.querySelector('[data-profile-confirm]') as HTMLElement));
    const note = await waitFor(() => {
      const el = document.querySelector('[data-profile-note]');
      if (!el) throw new Error('no note');
      return el as HTMLElement;
    });
    expect(note.textContent).toContain('prof_confirmed');
    expect(note.textContent).toContain('prof_skipped_shared');
  });

  it('lists only the person own connections, per active membership', async () => {
    render(<ProfileSection />);
    const own = await waitFor(() => {
      const el = document.querySelector('[data-my-connections="o1"]');
      if (!el) throw new Error('none');
      return el as HTMLElement;
    });
    expect(own.textContent).toBe('prof_connections_in');
    // Beta's membership is suspended: no connections are offered there.
    expect(document.querySelector('[data-my-connections="o2"]')).toBeNull();
    await screen.findByText('Mine');
    expect(screen.queryByText('Team chat')).toBeNull();
  });
});

describe('System', () => {
  it('lists who is here and offers a note to everyone but the caller', async () => {
    render(<SystemSection />);
    const bob = (await screen.findByText('Bob')).closest('tr') as HTMLElement;
    expect(within(bob).getByText('specs')).toBeTruthy();
    expect(bob.querySelector('[data-presence-message]')).toBeTruthy();
    await waitFor(() => {
      const me = document.querySelector('[data-presence="subject-me"]') as HTMLElement;
      expect(me.textContent).toContain('sys_you');
      expect(me.querySelector('[data-presence-message]')).toBeNull();
    });
  });

  it('says a note was not delivered when its reader has left', async () => {
    render(<SystemSection />);
    const bob = (await screen.findByText('Bob')).closest('tr') as HTMLElement;
    fireEvent.click(bob.querySelector('[data-presence-message]') as HTMLElement);
    fireEvent.change(screen.getByLabelText('sys_note_placeholder'), { target: { value: 'Lunch?' } });
    fireEvent.click(document.querySelector('[data-presence-send]') as HTMLElement);
    await screen.findByText('sys_note_not_delivered');
    expect(calls.find((c) => c.what === 'presenceSend')?.body).toEqual({ to_user_id: 'u2', text: 'Lunch?' });
    // Not delivered: the note stays open with its text, for another try.
    expect(document.querySelector('[data-presence-note]')).toBeTruthy();
  });

  it('queues a test notification through a chat connection to the picked channel', async () => {
    render(<SystemSection />);
    await waitFor(() => expect(document.querySelector('[data-notify-chat]')).toBeTruthy());
    await waitFor(() => expect(document.querySelector('[data-notify-target]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-notify-chat] [data-notify-example="run"]') as HTMLElement);
    fireEvent.click(document.querySelector('[data-notify-queue]') as HTMLElement);
    await waitFor(() => expect(document.querySelector('[data-notify-result]')?.textContent).toBe('sys_queued'));
    expect(calls.find((c) => c.what === 'queueNotification')?.body).toMatchObject({
      connection_id: 'c2',
      tenant_id: 'o1',
      target: 'C1',
      title: 'sys_example_run_title',
      text: 'sys_example_run_text',
    });
  });

  it('sends to the IDE of a picked workspace with its level', async () => {
    render(<SystemSection />);
    const editor = await waitFor(() => document.querySelector('[data-notify-editor]') as HTMLElement);
    await waitFor(() => expect(within(editor).getByText('Web')).toBeTruthy());
    fireEvent.change(editor.querySelector('[data-notify-workspace]') as HTMLElement, { target: { value: 'w1' } });
    fireEvent.change(within(editor).getByPlaceholderText('sys_field_text_hint'), { target: { value: 'Hello IDE' } });
    fireEvent.click(editor.querySelector('[data-notify-editor-send]') as HTMLElement);
    await waitFor(() => expect(document.querySelector('[data-notify-editor-result]')).toBeTruthy());
    expect(calls.find((c) => c.what === 'queueNotification')?.body).toEqual({
      workspace_id: 'w1',
      tenant_id: 'o1',
      level: 'warn',
      text: 'Hello IDE',
    });
  });

  it('says there is no chat connection, and still offers the IDE', async () => {
    serve({ storedConnections: read('storedConnections', { items: [] }) });
    render(<SystemSection />);
    await waitFor(() => expect(document.querySelector('[data-notify-no-chat]')).toBeTruthy());
    expect(document.querySelector('[data-notify-editor]')).toBeTruthy();
  });

  it('shows the raw state: permissions, gears as a table with JSON behind a toggle, and a failed read in its gear words', async () => {
    render(<SystemSection />);
    await waitFor(() =>
      expect(
        document.querySelector('[data-permission="gts.cf.toolkit.authz.permission.v1~cf.studio.people.view.v1"]')
      ).toBeTruthy()
    );
    expect(document.querySelector('[data-gear="studio-user"]')).toBeTruthy();
    fireEvent.click(document.querySelector('[data-system-json="gears"]') as HTMLElement);
    expect(document.querySelector('[data-system-json-body="gears"]')?.textContent).toContain('"studio-user"');
    const upstreams = document.querySelector('[data-system-raw="upstreams"]') as HTMLElement;
    await waitFor(() => expect(upstreams.textContent).toContain('oagw is not running'));
    expect(document.querySelector('[data-entity="gts.cf.core.am.tenant_type.v1~"]')?.textContent).toContain('sys_kind_type');
  });

  it('hides a raw section on its toggle', async () => {
    render(<SystemSection />);
    await waitFor(() => expect(document.querySelector('[data-system-raw="gears"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-system-toggle="gears"]') as HTMLElement);
    expect(document.querySelector('[data-system-raw="gears"]')).toBeNull();
  });
});
