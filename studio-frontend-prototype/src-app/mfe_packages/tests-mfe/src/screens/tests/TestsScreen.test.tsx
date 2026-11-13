import { render, screen, waitFor } from '@testing-library/react';
import {
  FRONTX_SHARED_PROPERTY_LANGUAGE,
  FRONTX_SHARED_PROPERTY_THEME,
} from '@gears-frontx/react';
import { createMfeBridgeFixture } from '@frontx-test-utils/createMfeBridgeFixture';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { translations, service, scope } = vi.hoisted(() => ({
  translations: vi.fn(),
  scope: { project: 'p1' as string | null, workspace: { id: 'w1' } as { id: string } | null },
  service: {} as Record<string, unknown>,
}));

vi.mock('../../i18n', () => ({ useTestsTranslations: translations }));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
  useSharedProperty: (id: string) => (id.includes('context.project.') ? scope.project : scope.workspace),
}));

import { TestsScreen } from './TestsScreen';

const query = (value: unknown) => () => ({ fetch: () => Promise.resolve(value) });
const NOW = new Date().toISOString();

function bridge() {
  return createMfeBridgeFixture({
    domainId: 'd',
    instanceId: 'i',
    initialProperties: { [FRONTX_SHARED_PROPERTY_THEME]: 'default', [FRONTX_SHARED_PROPERTY_LANGUAGE]: 'en' },
  }).bridge;
}

describe('TestsScreen', () => {
  beforeEach(() => {
    translations.mockReturnValue({
      t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
      loading: false,
    });
    scope.project = 'p1';
    Object.assign(service, {
      ciRuns: query({
        total: 1,
        latest_completed: 'r1',
        items: [
          {
            id: 'r1',
            repo: 'n1',
            workflow: 'CI',
            workflow_path: null,
            title: 'Fix it',
            event: 'push',
            branch: 'main',
            sha: 'abcdef1234',
            status: 'completed',
            conclusion: 'failure',
            url: null,
            number: 1,
            created_at: NOW,
            updated_at: NOW,
            jobs: [
              {
                name: 'test',
                status: 'completed',
                conclusion: 'failure',
                failed_step: 'cargo test',
                started_at: NOW,
                completed_at: NOW,
                duration_seconds: 60,
                url: null,
              },
            ],
          },
        ],
      }),
      repositories: query({ nodes: [{ type_id: 'repo', instance_id: 'n1', value: { full_path: 'acme/app' } }] }),
      openPullRequests: query({ items: [], total: 0 }),
      pullRequestChecks: { fetch: () => Promise.resolve({ items: [], total: 0, pulls: 0, reached: true }) },
      declaredCapabilities: query({ items: [{ key: 'auth' }], total: 1 }),
      capabilities: query({ items: [{ key: 'auth', label: 'Auth', terms: [] }] }),
      conformance: {
        fetch: () => Promise.resolve({ repo: 'acme/app', total: 1, items: [{ capability: 'auth', status: 'missing' }] }),
      },
    });
  });

  afterEach(() => vi.clearAllMocks());

  it('says the mainline is red, names the failed job, and counts spec ↔ code', async () => {
    render(<TestsScreen bridge={bridge()} />);
    expect(await screen.findByText('mainline_red')).toBeTruthy();
    expect(screen.getAllByText(/test → cargo test/).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText(/spec_covered/)).toBeTruthy());
    expect(screen.getByText(/"implemented":0,"functional":1/)).toBeTruthy();
  });

  it('asks for a project when none is open', () => {
    scope.project = null;
    render(<TestsScreen bridge={bridge()} />);
    expect(screen.getByText('no_project')).toBeTruthy();
  });
});
